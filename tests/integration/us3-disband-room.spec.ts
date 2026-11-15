import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHubApp } from "@factory-arena/hub-server";
import { describe, expect, it } from "vitest";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "arena-disband-"));
  const hub = createHubApp({ stateDir: dir });
  const register = (code: string) =>
    hub.core.roster.registerOrRebindSession({
      employee_code: code,
      display_name: code,
      department: "backend",
      job_title: "Engineer",
      transport_type: "mcp_bridge",
      model_identifier: "test-model",
    });
  const [a, b] = [register("DISBAND-A"), register("DISBAND-B")];
  const { room } = hub.core.council.createRoom({
    title: "Disband me",
    problemStatement: "Any topic",
    protocolMode: "council",
    participantIds: [a.id, b.id],
    moderatorId: a.id,
  });
  const cleanup = () => {
    hub.core.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { hub, a, b, room, cleanup };
}

describe("Director disbands a war-room meeting (abort_room)", () => {
  it("marks the room aborted and sends every participant back to their desk", () => {
    const { hub, a, b, room, cleanup } = setup();
    try {
      expect(hub.core.roster.getEmployeeById(a.id)?.spatial_zone).toBe("at_war_room_table");

      const updated = hub.core.council.steerOrResolveGate({
        roomId: room.id,
        action: "abort_room",
      });

      expect(updated.status).toBe("aborted");
      expect(hub.core.roster.getEmployeeById(a.id)?.spatial_zone).toBe("at_desk");
      expect(hub.core.roster.getEmployeeById(b.id)?.spatial_zone).toBe("at_desk");
    } finally {
      cleanup();
    }
  });

  it("refuses to abort a room that is already aborted, so it cannot pull agents out of a newer meeting", () => {
    const { hub, a, room, cleanup } = setup();
    try {
      hub.core.council.steerOrResolveGate({ roomId: room.id, action: "abort_room" });
      // Agent walks into a different, newer meeting.
      hub.core.roster.moveEmployeesToZone([a.id], "at_war_room_table", "speaking");

      expect(() =>
        hub.core.council.steerOrResolveGate({ roomId: room.id, action: "abort_room" }),
      ).toThrow(/already (aborted|completed|closed)/i);
      expect(hub.core.roster.getEmployeeById(a.id)?.spatial_zone).toBe("at_war_room_table");
    } finally {
      cleanup();
    }
  });
});
