import type { WarRoomMeeting } from "@factory-arena/protocol";
import { describe, expect, it } from "vitest";
import {
  filterOpenRooms,
  findOpenRoom,
  isRoomOpen,
} from "../../apps/web-arena/src/council/roomStatus.js";

const room = (id: string, status: WarRoomMeeting["status"]) => ({ id, status });

describe("isRoomOpen", () => {
  it.each([
    "draft",
    "diverging",
    "critiquing",
    "voting",
    "synthesizing",
    "awaiting_human_gate",
  ] as const)("treats %s as an open meeting", (status) => {
    expect(isRoomOpen(status)).toBe(true);
  });

  it.each(["executing", "completed", "aborted"] as const)(
    "treats %s as finished (nothing left to disband)",
    (status) => {
      expect(isRoomOpen(status)).toBe(false);
    },
  );
});

describe("findOpenRoom", () => {
  it("returns the newest room that is still open, skipping aborted ones", () => {
    const rooms = [room("newest", "aborted"), room("older", "voting"), room("oldest", "completed")];
    expect(findOpenRoom(rooms)?.id).toBe("older");
  });

  it("returns undefined when every room is finished", () => {
    expect(findOpenRoom([room("a", "aborted"), room("b", "executing")])).toBeUndefined();
  });
});

describe("filterOpenRooms", () => {
  it("returns every open room, so one click can disband stale meetings too", () => {
    const rooms = [
      room("a", "aborted"),
      room("b", "awaiting_human_gate"),
      room("c", "completed"),
      room("d", "voting"),
    ];
    expect(filterOpenRooms(rooms).map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("returns an empty list when nothing is open", () => {
    expect(filterOpenRooms([room("a", "aborted")])).toEqual([]);
  });
});
