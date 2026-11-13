import { existsSync, readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  A2ARemoteAdapter,
  ACPBridgeAdapter,
  APIKeyAdapter,
  CLIPtyAdapter,
  MCPBridgeAdapter
} from "@factory-arena/adapters";
import { type ArenaCoreContainer, createArenaCore } from "@factory-arena/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { createGatesRoutes } from "./routes/gates.js";
import { createParticipantsRoutes } from "./routes/participants.js";
import { createRoomsRoutes } from "./routes/rooms.js";
import { createTicketsAndArtifactsRoutes } from "./routes/tickets.js";
import { createVaultRoutes } from "./routes/vault.js";
import { attachRealtimeWebSocket } from "./ws/realtime-stream.js";

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export interface RunningHubInstance {
  app: Hono;
  core: ArenaCoreContainer;
  mcpAdapter: MCPBridgeAdapter;
  acpAdapter: ACPBridgeAdapter;
  apiKeyAdapter: APIKeyAdapter;
  cliPtyAdapter: CLIPtyAdapter;
  a2aAdapter: A2ARemoteAdapter;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export function createHubApp(options: {
  stateDir: string;
  hubBaseUrl?: string;
  staticUiDir?: string;
  seedDemoOffice?: boolean;
}) {
  const core = createArenaCore({ stateDir: options.stateDir });
  const mcpAdapter = new MCPBridgeAdapter(core);
  const acpAdapter = new ACPBridgeAdapter(core);
  const apiKeyAdapter = new APIKeyAdapter(core.vault, core.budget);
  const cliPtyAdapter = new CLIPtyAdapter(core);
  const a2aAdapter = new A2ARemoteAdapter(options.hubBaseUrl ?? "http://127.0.0.1:4747");

  if (options.seedDemoOffice && core.roster.listEmployees().length === 0) {
    const lead = core.roster.registerOrRebindSession({
      session_fingerprint: "mcp_bridge:local:MSW-01",
      employee_code: "MSW-01",
      display_name: "MSW Lead",
      department: "leadership",
      job_title: "Tech Lead & Council Moderator",
      transport_type: "mcp_bridge",
      capabilities: ["propose", "critique", "vote", "read_repo", "edit_worktree", "moderate"]
    });
    const fe = core.roster.registerOrRebindSession({
      session_fingerprint: "acp_editor:vscode:VSC-FE-02",
      employee_code: "VSC-FE-02",
      display_name: "VSCode Session #1",
      department: "frontend",
      job_title: "3D Office & UI Engineer",
      transport_type: "acp_editor",
      capabilities: ["propose", "critique", "vote", "edit_worktree", "run_tests"]
    });
    const be = core.roster.registerOrRebindSession({
      session_fingerprint: "mcp_bridge:cursor:CUR-BE-03",
      employee_code: "CUR-BE-03",
      display_name: "Cursor Session #2",
      department: "backend",
      job_title: "SQLite WAL & Lease Engineer",
      transport_type: "mcp_bridge",
      capabilities: ["propose", "critique", "vote", "edit_worktree"]
    });
    const sec = core.roster.registerOrRebindSession({
      session_fingerprint: "api_key:vault:API-SEC-04",
      employee_code: "API-SEC-04",
      display_name: "SecCritic API",
      department: "security_qa",
      job_title: "Red-Team Security Auditor",
      transport_type: "api_key",
      capabilities: ["propose", "critique", "vote", "read_repo"]
    });

    core.roster.reportDeskActivity({
      employeeId: lead.id,
      avatarPose: "typing_code",
      contextFillPct: 24,
      lastToolCallSummary: "coordinating sprint backlog & council gate"
    });
    core.roster.reportDeskActivity({
      employeeId: fe.id,
      avatarPose: "typing_code",
      contextFillPct: 31,
      lastToolCallSummary: "rendering Three.js employee desks at 60fps"
    });
    const t1 = core.kanban.createTicket({
      title: "Triển khai Council State Machine 4 bước chống Groupthink",
      priority: "p0_critical",
      kanban_column: "in_progress",
      assignee_session_id: lead.id,
      acceptance_criteria: ["Sealed Round 1", "Anonymized Proposal A..N"]
    });
    const t2 = core.kanban.createTicket({
      title: "Đồng bộ 3D Avatar với MCP/ACP Heartbeat",
      priority: "p1_high",
      kanban_column: "in_progress",
      assignee_session_id: fe.id
    });
    const t3 = core.kanban.createTicket({
      title: "Kiểm tra khóa FileLease & Migration SQLite WAL",
      priority: "p1_high",
      kanban_column: "blocked",
      assignee_session_id: be.id
    });
    core.kanban.createTicket({
      title: "Kiểm toán AES-256-GCM Credential Vault",
      priority: "p1_high",
      kanban_column: "assigned",
      assignee_session_id: sec.id
    });
    core.roster.reportDeskActivity({
      employeeId: be.id,
      avatarPose: "hand_raised",
      contextFillPct: 42,
      ticketId: t3.id,
      permissionPrompt: "Xin quyền thực thi migration SQLite WAL trên nhánh wt/TSK-103"
    });
    void t1;
    void t2;
  }

  const app = new Hono();
  app.use("*", cors());

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: "Validation failed", issues: err.issues }, 400);
    }
    return c.json({ error: err.message || "Internal server error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true, service: "factory-arena-hub" }));
  app.get("/.well-known/agent.json", (c) => c.json(a2aAdapter.buildHubAgentCard()));

  app.post("/mcp", async (c) => {
    const req = await c.req.json();
    return c.json(mcpAdapter.handleJsonRpc(req));
  });

  app.post("/acp", async (c) => {
    const req = await c.req.json();
    return c.json(acpAdapter.handleAcpMessage(req));
  });

  app.route("/api/v1/vault", createVaultRoutes(core));
  app.route("/api/v1", createParticipantsRoutes(core));
  app.route("/api/v1", createTicketsAndArtifactsRoutes(core));
  app.route("/api/v1", createRoomsRoutes(core));
  app.route("/api/v1", createGatesRoutes(core));

  if (options.staticUiDir && existsSync(options.staticUiDir)) {
    const rootDir = resolve(options.staticUiDir);
    app.get("*", (c) => {
      const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
      const candidate = resolve(join(rootDir, `.${reqPath}`));
      if (candidate.startsWith(rootDir) && existsSync(candidate)) {
        const ext = extname(candidate);
        return new Response(readFileSync(candidate), {
          headers: { "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream" }
        });
      }
      const indexHtml = join(rootDir, "index.html");
      if (existsSync(indexHtml)) {
        return new Response(readFileSync(indexHtml), {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
      return c.notFound();
    });
  }

  return {
    app,
    core,
    mcpAdapter,
    acpAdapter,
    apiKeyAdapter,
    cliPtyAdapter,
    a2aAdapter
  };
}

export async function startHubServer(options: {
  port?: number;
  hostname?: string;
  stateDir: string;
  staticUiDir?: string;
  seedDemoOffice?: boolean;
}): Promise<RunningHubInstance> {
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 4747;
  const hub = createHubApp({
    stateDir: options.stateDir,
    hubBaseUrl: `http://${hostname}:${requestedPort || 4747}`,
    staticUiDir: options.staticUiDir,
    seedDemoOffice: options.seedDemoOffice
  });

  return await new Promise<RunningHubInstance>((resolvePromise) => {
    const server = serve(
      {
        fetch: hub.app.fetch,
        hostname,
        port: requestedPort
      },
      (info) => {
        const httpServer = server as unknown as HttpServer;
        const wsHandle = attachRealtimeWebSocket(httpServer, hub.core);
        const baseUrl = `http://${hostname}:${info.port}`;
        resolvePromise({
          ...hub,
          port: info.port,
          baseUrl,
          close: async () => {
            wsHandle.close();
            await new Promise<void>((res) => server.close(() => res()));
            hub.core.close();
          }
        });
      }
    );
  });
}
