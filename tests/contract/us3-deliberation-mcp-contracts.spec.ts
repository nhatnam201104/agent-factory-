import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MCPBridgeAdapter } from "@factory-arena/adapters";
import { createArenaCore } from "@factory-arena/core";
import { ARENA_MCP_TOOL_NAMES, MCPSubmitCritiqueInputSchema } from "@factory-arena/protocol";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const MANIFEST_PATH = join(REPO_ROOT, "specs/001-multi-agent-arena/contracts/mcp-arena-tools.json");

describe("US3 Contract Tests: War-Room Deliberation MCP Manifest & Evidence Enforcement (T032)", () => {
  it("matches every manifest tool in mcp-arena-tools.json and rejects high/critical critiques without evidence_ref", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      tools: Array<{ name: string }>;
    };
    const manifestNames = manifest.tools.map((t) => t.name);
    for (const expected of manifestNames) {
      expect(ARENA_MCP_TOOL_NAMES).toContain(expected);
    }

    // Missing evidence_ref on critical finding MUST fail validation
    expect(() =>
      MCPSubmitCritiqueInputSchema.parse({
        room_id: "room_1",
        round_id: "rnd_1",
        reviewer_id: "emp_1",
        target_anonymous_alias: "Proposal A",
        rubric_scores: { correctness: 7, security: 4, maintainability: 8, feasibility: 8 },
        findings: [
          {
            severity: "critical",
            category: "security",
            claim: "SQL injection risk",
          },
        ],
      }),
    ).toThrow(/evidence_ref/);

    // Valid when evidence_ref is supplied
    const valid = MCPSubmitCritiqueInputSchema.parse({
      room_id: "room_1",
      round_id: "rnd_1",
      reviewer_id: "emp_1",
      target_anonymous_alias: "Proposal A",
      rubric_scores: { correctness: 7, security: 4, maintainability: 8, feasibility: 8 },
      findings: [
        {
          severity: "critical",
          category: "security",
          claim: "SQL injection risk",
          evidence_ref: "src/db.ts:52",
        },
      ],
    });
    expect(valid.findings[0].evidence_ref).toBe("src/db.ts:52");

    // Verify JSON-RPC tools/list returns complete MCP inputSchema objects for every tool
    const dir = mkdtempSync(join(tmpdir(), "arena-us3-mcp-schema-"));
    const core = createArenaCore({ stateDir: dir });
    try {
      const adapter = new MCPBridgeAdapter(core);
      const rpcRes = adapter.handleJsonRpc({
        jsonrpc: "2.0",
        id: "tools-1",
        method: "tools/list",
      });
      const returnedTools = (
        rpcRes.result as {
          tools: Array<{
            name: string;
            description: string;
            inputSchema?: {
              type?: string;
              required?: string[];
              properties?: Record<string, unknown>;
            };
          }>;
        }
      ).tools;

      for (const expected of manifestNames) {
        const found = returnedTools.find((t) => t.name === expected);
        expect(found).toBeDefined();
        expect(found?.inputSchema?.type).toBe("object");
        expect(Object.keys(found?.inputSchema?.properties ?? {}).length).toBeGreaterThan(0);
      }
      for (const tool of returnedTools) {
        expect(tool.inputSchema?.type).toBe("object");
        expect(Array.isArray(tool.inputSchema?.required)).toBe(true);
      }
    } finally {
      core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
