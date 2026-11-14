import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PassThrough } from "node:stream";
import { createHubApp } from "@factory-arena/hub-server";
import { describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/index.js";

describe("US1 Integration: 1:1 SessionEmployee Rebinding, Separate IDE Desks & Hand-Raise Approval (T014)", () => {
  it("maps 2 concurrent IDE sessions to 2 distinct desks, rebinds on IDE reload, and resolves hand-raise permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us1-int-"));
    const hub = createHubApp({ stateDir: dir });

    try {
      const ide1 = hub.core.roster.registerOrRebindSession({
        session_fingerprint: "mcp_bridge:/workspace/feat-a:IDE-WIN-1",
        employee_code: "IDE-WIN-1",
        display_name: "Cursor Tab #1",
        department: "backend",
        job_title: "Backend Engineer",
        transport_type: "mcp_bridge",
      });
      const ide2 = hub.core.roster.registerOrRebindSession({
        session_fingerprint: "mcp_bridge:/workspace/feat-b:IDE-WIN-2",
        employee_code: "IDE-WIN-2",
        display_name: "Cursor Tab #2",
        department: "backend",
        job_title: "Backend Engineer",
        transport_type: "mcp_bridge",
      });

      expect(ide1.id).not.toBe(ide2.id);
      expect(ide1.desk_slot_id).not.toBe(ide2.desk_slot_id);

      // Simulate IDE Window #1 reload with identical session_fingerprint -> must rebind same employee & desk
      const ide1Reloaded = hub.core.roster.registerOrRebindSession({
        session_fingerprint: "mcp_bridge:/workspace/feat-a:IDE-WIN-1",
        employee_code: "IDE-WIN-1",
        display_name: "Cursor Tab #1 (Reloaded)",
        department: "backend",
        job_title: "Backend Engineer",
        transport_type: "mcp_bridge",
      });
      expect(ide1Reloaded.id).toBe(ide1.id);
      expect(ide1Reloaded.desk_slot_id).toBe(ide1.desk_slot_id);
      expect(hub.core.roster.listEmployees()).toHaveLength(2);

      // Trigger hand-raise permission request and resolve via HTTP API as Director
      const { permissionRequest } = hub.core.roster.reportDeskActivity({
        employeeId: ide2.id,
        avatarPose: "typing_code",
        permissionPrompt: "Execute git push origin feat-b?",
      });
      expect(permissionRequest).toBeDefined();
      if (!permissionRequest) {
        throw new Error("Expected permissionRequest to be created on hand-raise");
      }

      const res = await hub.app.request(`/api/v1/permissions/${permissionRequest.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allowed", resolved_by: "director_ui" }),
      });
      expect(res.status).toBe(200);
      const resolvedJson = await res.json();
      expect(resolvedJson.permission.status).toBe("allowed");
      expect(resolvedJson.employee.avatar_pose).toBe("typing_code");
      expect(hub.core.roster.listPendingPermissions()).toHaveLength(0);
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("proxies MCP JSON-RPC over stdio via factory-arena mcp-stdio to the Hub /mcp endpoint (T049)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us1-stdio-"));
    const hub = createHubApp({ stateDir: dir });

    try {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      let rawOut = "";
      stdout.setEncoding("utf8");
      stdout.on("data", (chunk: string) => {
        rawOut += chunk;
      });

      const cliPromise = runCli(
        ["mcp-stdio", "--hub-url", "http://127.0.0.1:4747", "--state-dir", dir],
        {
          stdin,
          stdout,
          fetchImpl: async (url, init) => hub.app.request(String(url), init),
        },
      );

      stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
      );
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "arena_checkin_desk",
            arguments: {
              session_fingerprint: "mcp_bridge:/stdio-ide:STDIO-01",
              employee_code: "STDIO-01",
              display_name: "Cursor Stdio Proxy",
              department: "devops",
              job_title: "Stdio MCP Engineer",
            },
          },
        })}\n`,
      );
      stdin.end();

      const exitCode = await cliPromise;
      expect(exitCode).toBe(0);

      const responses = rawOut
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      expect(responses).toHaveLength(2);
      expect(responses[0].id).toBe(1);
      expect(responses[0].result.serverInfo.name).toBe("factory-arena-mcp");
      expect(responses[1].id).toBe(2);
      expect(responses[1].result.structuredContent.employee_code).toBe("STDIO-01");
      expect(hub.core.roster.getEmployeeById("STDIO-01")?.desk_slot_id).toBe("DESK-OPS-1");
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prevents split-brain local DB writes when mcp-stdio Hub is unreachable and blocks sibling-prefix path traversal", async () => {
    const parent = mkdtempSync(join(tmpdir(), "arena-us1-boundary-"));
    const stateDir = join(parent, "unused-local-state");
    const repoDir = join(parent, "repo");
    const siblingSecretDir = join(parent, `${basename(repoDir)}-secrets`);
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(siblingSecretDir, { recursive: true });
    writeFileSync(join(repoDir, "index.ts"), "export const ok = 1;\n", "utf8");
    writeFileSync(join(siblingSecretDir, "leak.txt"), "TOP_SECRET_VALUE\n", "utf8");

    const hubStateDir = join(parent, "hub-state");
    const hub = createHubApp({ stateDir: hubStateDir });

    try {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      let rawOut = "";
      stdout.setEncoding("utf8");
      stdout.on("data", (chunk: string) => {
        rawOut += chunk;
      });

      const cliPromise = runCli(
        ["mcp-stdio", "--hub-url", "http://127.0.0.1:4747", "--state-dir", stateDir],
        {
          stdin,
          stdout,
          fetchImpl: async () => new Response("Service Unavailable", { status: 503 }),
        },
      );

      stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "tools/call",
          params: {
            name: "arena_checkin_desk",
            arguments: {
              session_fingerprint: "mcp_bridge:/stdio:FAIL-01",
              employee_code: "FAIL-01",
              department: "backend",
              job_title: "Backend",
            },
          },
        })}\n`,
      );
      stdin.end();

      await cliPromise;
      const errResp = JSON.parse(rawOut.trim());
      expect(errResp.error.code).toBe(-32001);
      expect(existsSync(join(stateDir, "arena.db"))).toBe(false);

      // Sibling-prefix traversal ../repo-secrets/leak.txt MUST throw
      expect(() =>
        hub.apiKeyAdapter.readRepoExcerpt(repoDir, `../${basename(siblingSecretDir)}/leak.txt`),
      ).toThrow(/Path traversal/);
      expect(hub.apiKeyAdapter.readRepoExcerpt(repoDir, "index.ts")).toContain(
        "export const ok = 1;",
      );
    } finally {
      hub.core.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
