import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHubApp } from "@factory-arena/hub-server";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
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
        readFileSync(join(CONTRACTS_DIR, "a2a-agent-card.schema.json"), "utf8")
      );
      const validateCard = ajv.compile(agentCardSchema);

      const cardRes = await hub.app.request("/.well-known/agent.json");
      expect(cardRes.status).toBe(200);
      const cardJson = await cardRes.json();
      expect(validateCard(cardJson)).toBe(true);

      const oas = YAML.parse(
        readFileSync(join(CONTRACTS_DIR, "arena-http-api.openapi.yaml"), "utf8")
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
              job_title: "UI Developer"
            }
          }
        })
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
              permission_prompt: "Allow running playwright install?"
            }
          }
        })
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
});
