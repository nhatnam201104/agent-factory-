import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHubApp } from "@factory-arena/hub-server";
import { describe, expect, it } from "vitest";

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
        transport_type: "mcp_bridge"
      });
      const ide2 = hub.core.roster.registerOrRebindSession({
        session_fingerprint: "mcp_bridge:/workspace/feat-b:IDE-WIN-2",
        employee_code: "IDE-WIN-2",
        display_name: "Cursor Tab #2",
        department: "backend",
        job_title: "Backend Engineer",
        transport_type: "mcp_bridge"
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
        transport_type: "mcp_bridge"
      });
      expect(ide1Reloaded.id).toBe(ide1.id);
      expect(ide1Reloaded.desk_slot_id).toBe(ide1.desk_slot_id);
      expect(hub.core.roster.listEmployees()).toHaveLength(2);

      // Trigger hand-raise permission request and resolve via HTTP API as Director
      const { permissionRequest } = hub.core.roster.reportDeskActivity({
        employeeId: ide2.id,
        avatarPose: "typing_code",
        permissionPrompt: "Execute git push origin feat-b?"
      });
      expect(permissionRequest).toBeDefined();

      const res = await hub.app.request(
        `/api/v1/permissions/${permissionRequest!.id}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "allowed", resolved_by: "director_ui" })
        }
      );
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
});
