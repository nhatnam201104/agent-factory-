import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  A2ARemoteAdapter,
  ACPBridgeAdapter,
  APIKeyAdapter,
  CLIPtyAdapter,
  MCPBridgeAdapter,
} from "@factory-arena/adapters";
import {
  ArenaClientError,
  type ArenaCoreContainer,
  BudgetExceededError,
  createArenaCore,
} from "@factory-arena/core";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { createCommandRoutes } from "./routes/commands.js";
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
  ".svg": "image/svg+xml",
};

const LOOPBACK_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export function isTrustedLoopbackOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return LOOPBACK_ORIGIN_RE.test(origin.trim());
}

/** Treat unset, empty and whitespace-only tokens alike, so `FACTORY_ARENA_API_TOKEN=` never disables auth. */
function nonEmptyToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Browser origins allowed to call the hub: loopback dev servers, plus the hub's own origin so
 * the bundled UI keeps working when the hub is bound to a LAN address.
 */
function isTrustedRequestOrigin(origin: string, requestUrl: string): boolean {
  if (isTrustedLoopbackOrigin(origin)) return true;
  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

function isLoopbackBindHost(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return clean === "127.0.0.1" || clean === "localhost" || clean === "::1";
}

function matchesSessionToken(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const normalized = provided.replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(normalized, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

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
  apiToken?: string;
  close: () => Promise<void>;
}

export function createHubApp(options: {
  stateDir: string;
  hubBaseUrl?: string;
  staticUiDir?: string;
  seedDemoOffice?: boolean;
  apiToken?: string;
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
      capabilities: ["propose", "critique", "vote", "read_repo", "edit_worktree", "moderate"],
    });
    const fe = core.roster.registerOrRebindSession({
      session_fingerprint: "acp_editor:vscode:VSC-FE-02",
      employee_code: "VSC-FE-02",
      display_name: "VSCode Session #1",
      department: "frontend",
      job_title: "3D Office & UI Engineer",
      transport_type: "acp_editor",
      capabilities: ["propose", "critique", "vote", "edit_worktree", "run_tests"],
    });
    const be = core.roster.registerOrRebindSession({
      session_fingerprint: "mcp_bridge:cursor:CUR-BE-03",
      employee_code: "CUR-BE-03",
      display_name: "Cursor Session #2",
      department: "backend",
      job_title: "SQLite WAL & Lease Engineer",
      transport_type: "mcp_bridge",
      capabilities: ["propose", "critique", "vote", "edit_worktree"],
    });
    const sec = core.roster.registerOrRebindSession({
      session_fingerprint: "api_key:vault:API-SEC-04",
      employee_code: "API-SEC-04",
      display_name: "SecCritic API",
      department: "security_qa",
      job_title: "Red-Team Security Auditor",
      transport_type: "api_key",
      capabilities: ["propose", "critique", "vote", "read_repo"],
    });

    core.roster.reportDeskActivity({
      employeeId: lead.id,
      avatarPose: "typing_code",
      contextFillPct: 24,
      lastToolCallSummary: "coordinating sprint backlog & council gate",
    });
    core.roster.reportDeskActivity({
      employeeId: fe.id,
      avatarPose: "typing_code",
      contextFillPct: 31,
      lastToolCallSummary: "rendering Three.js employee desks at 60fps",
    });
    const t1 = core.kanban.createTicket({
      title: "Triển khai Council State Machine 4 bước chống Groupthink",
      priority: "p0_critical",
      kanban_column: "in_progress",
      assignee_session_id: lead.id,
      acceptance_criteria: ["Sealed Round 1", "Anonymized Proposal A..N"],
    });
    const t2 = core.kanban.createTicket({
      parent_ticket_id: t1.id,
      title: "Đồng bộ 3D Avatar với MCP/ACP Heartbeat",
      priority: "p1_high",
      kanban_column: "in_progress",
      assignee_session_id: fe.id,
    });
    const t3 = core.kanban.createTicket({
      parent_ticket_id: t1.id,
      title: "Kiểm tra khóa FileLease & Migration SQLite WAL",
      priority: "p1_high",
      kanban_column: "blocked",
      assignee_session_id: be.id,
    });
    core.kanban.createTicket({
      title: "Kiểm toán AES-256-GCM Credential Vault",
      priority: "p1_high",
      kanban_column: "assigned",
      assignee_session_id: sec.id,
    });
    core.blackboard.publishArtifact({
      ticketId: t1.id,
      authorSessionId: lead.id,
      kind: "code_diff",
      title: "Diff: Council 4-stage sealed Round-1 query filter",
      content:
        "--- a/council.ts\n+++ b/council.ts\n@@ -1,3 +1,6 @@\n+visibility_state = 'sealed'\n",
      compactDigest: "+28/-4 lines in packages/core/src/engine/council.ts",
    });
    core.roster.reportDeskActivity({
      employeeId: be.id,
      avatarPose: "hand_raised",
      contextFillPct: 42,
      ticketId: t3.id,
      permissionPrompt: "Xin quyền thực thi migration SQLite WAL trên nhánh wt/TSK-103",
    });
    void t2;
  }

  const effectiveApiToken =
    nonEmptyToken(options.apiToken) ?? nonEmptyToken(process.env.FACTORY_ARENA_API_TOKEN);

  const app = new Hono();
  app.use(
    "*",
    cors({
      origin: (origin) => (isTrustedLoopbackOrigin(origin) ? origin : null),
      allowHeaders: ["Content-Type", "Authorization", "X-Arena-Session-Token"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  const guardMutatingAndApiSurface = async (c: any, next: () => Promise<void>) => {
    const origin = c.req.header("origin");
    const secFetchSite = c.req.header("sec-fetch-site");
    if ((origin && !isTrustedRequestOrigin(origin, c.req.url)) || secFetchSite === "cross-site") {
      return c.json(
        { error: "Cross-origin browser requests to Factory Arena Hub are prohibited" },
        403,
      );
    }

    if (effectiveApiToken) {
      const candidate =
        c.req.header("x-arena-session-token") ?? c.req.header("authorization") ?? undefined;
      if (!matchesSessionToken(candidate, effectiveApiToken)) {
        return c.json(
          { error: "Unauthorized: valid LocalSessionToken or Bearer token required" },
          401,
        );
      }
    }

    await next();
  };

  app.use("/api/*", guardMutatingAndApiSurface);
  app.use("/mcp", guardMutatingAndApiSurface);
  app.use("/acp", guardMutatingAndApiSurface);

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: "Validation failed", issues: err.issues }, 400);
    }
    if (err instanceof ArenaClientError) {
      return c.json({ error: err.message }, err.status);
    }
    if (err instanceof BudgetExceededError) {
      return c.json({ error: err.message, budget: err.details }, 402);
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
  app.route(
    "/api/v1",
    createCommandRoutes({
      core,
      mcpAdapter,
      acpAdapter,
      apiKeyAdapter,
      cliPtyAdapter,
      a2aAdapter,
    }),
  );
  app.route("/api/v1", createTicketsAndArtifactsRoutes(core));
  app.route("/api/v1", createRoomsRoutes(core));
  app.route("/api/v1", createGatesRoutes(core));

  if (options.staticUiDir && existsSync(options.staticUiDir)) {
    const rootDir = resolve(options.staticUiDir);
    app.get("*", (c) => {
      const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
      const candidate = resolve(join(rootDir, `.${reqPath}`));
      const rel = relative(rootDir, candidate);
      const insideRoot = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      if (insideRoot && existsSync(candidate) && statSync(candidate).isFile()) {
        const ext = extname(candidate);
        return new Response(readFileSync(candidate), {
          headers: { "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream" },
        });
      }
      const indexHtml = join(rootDir, "index.html");
      if (existsSync(indexHtml) && statSync(indexHtml).isFile()) {
        return new Response(readFileSync(indexHtml), {
          headers: { "content-type": "text/html; charset=utf-8" },
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
    a2aAdapter,
    apiToken: effectiveApiToken,
  };
}

/**
 * Session token the hub enforces: explicit option, then env var, and a random one whenever the
 * hub is reachable beyond loopback. Blank values never count, so an empty
 * `FACTORY_ARENA_API_TOKEN=` cannot switch authentication off on a LAN bind.
 */
export function resolveHubApiToken(
  hostname: string,
  explicitToken: string | undefined,
  envToken: string | undefined,
): string | undefined {
  return (
    nonEmptyToken(explicitToken) ??
    nonEmptyToken(envToken) ??
    (isLoopbackBindHost(hostname) ? undefined : randomBytes(24).toString("hex"))
  );
}

export async function startHubServer(options: {
  port?: number;
  hostname?: string;
  stateDir: string;
  staticUiDir?: string;
  seedDemoOffice?: boolean;
  apiToken?: string;
}): Promise<RunningHubInstance> {
  const hostname = options.hostname ?? "127.0.0.1";
  const requestedPort = options.port ?? 4747;
  const resolvedApiToken = resolveHubApiToken(
    hostname,
    options.apiToken,
    process.env.FACTORY_ARENA_API_TOKEN,
  );

  const hub = createHubApp({
    stateDir: options.stateDir,
    hubBaseUrl: `http://${hostname}:${requestedPort || 4747}`,
    staticUiDir: options.staticUiDir,
    seedDemoOffice: options.seedDemoOffice,
    apiToken: resolvedApiToken,
  });

  return await new Promise<RunningHubInstance>((resolvePromise) => {
    const server = serve(
      {
        fetch: hub.app.fetch,
        hostname,
        port: requestedPort,
      },
      (info) => {
        const httpServer = server as unknown as HttpServer;
        const wsHandle = attachRealtimeWebSocket(httpServer, hub.core, resolvedApiToken);
        const baseUrl = `http://${hostname}:${info.port}`;
        resolvePromise({
          ...hub,
          port: info.port,
          baseUrl,
          close: async () => {
            wsHandle.close();
            await new Promise<void>((res) => server.close(() => res()));
            hub.core.close();
          },
        });
      },
    );
  });
}
