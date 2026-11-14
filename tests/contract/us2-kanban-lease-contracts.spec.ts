import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHubApp } from "@factory-arena/hub-server";
import { describe, expect, it } from "vitest";

describe("US2 Contract Tests: Kanban Tickets, Blackboard Artifacts & HTTP 409 Lease Conflict (T024)", () => {
  it("grants non-overlapping file_lock leases (200) and rejects overlapping globs with HTTP 409", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arena-us2-contract-"));
    const hub = createHubApp({ stateDir: dir });

    try {
      const empA = hub.core.roster.registerOrRebindSession({
        employee_code: "EMP-A",
        display_name: "Agent A",
        department: "backend",
        job_title: "Engineer A",
        transport_type: "mcp_bridge",
      });
      const empB = hub.core.roster.registerOrRebindSession({
        employee_code: "EMP-B",
        display_name: "Agent B",
        department: "backend",
        job_title: "Engineer B",
        transport_type: "mcp_bridge",
      });

      const tRes = await hub.app.request("/api/v1/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Refactor protocol schemas",
          priority: "p1_high",
          repo_root_path: "/tmp/demo-repo",
        }),
      });
      expect(tRes.status).toBe(201);
      const ticket = await tRes.json();

      const grantRes = await hub.app.request(`/api/v1/rooms/room-1/beads/${ticket.id}/lease`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participant_id: empA.id,
          isolation_mode: "file_lock",
          repo_root_path: "/tmp/demo-repo",
          locked_globs: ["packages/protocol/**"],
        }),
      });
      expect(grantRes.status).toBe(200);

      // Overlapping glob from empB on same repo must return 409 Conflict
      const conflictRes = await hub.app.request(`/api/v1/rooms/room-1/beads/${ticket.id}/lease`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participant_id: empB.id,
          isolation_mode: "file_lock",
          repo_root_path: "/tmp/demo-repo",
          locked_globs: ["packages/protocol/src/ledger-events.ts"],
        }),
      });
      expect(conflictRes.status).toBe(409);

      // Artifact publish + read roundtrip via MCP
      const pubOut = hub.mcpAdapter.invokeTool("arena_publish_artifact", {
        room_id: "room-1",
        author_id: empA.id,
        kind: "code_diff",
        title: "Protocol diff",
        content: "+ export const NEW_FIELD = true;\n".repeat(100),
        compact_digest: "Added NEW_FIELD to protocol package",
      }) as { pointer: string; artifact: { id: string } };
      expect(pubOut.pointer).toMatch(/^artifact:\/\/art_/);

      const readRes = await hub.app.request(`/api/v1/artifacts/${pubOut.artifact.id}`);
      expect(readRes.status).toBe(200);
    } finally {
      hub.core.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
