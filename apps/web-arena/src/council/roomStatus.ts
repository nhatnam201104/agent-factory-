import type { WarRoomMeeting } from "@factory-arena/protocol";

type RoomStatus = WarRoomMeeting["status"];

/** Statuses in which participants are still seated in the glass war room. */
const OPEN_STATUSES: ReadonlySet<RoomStatus> = new Set([
  "draft",
  "diverging",
  "critiquing",
  "voting",
  "synthesizing",
  "awaiting_human_gate",
]);

/** True while the meeting can still be steered, approved or disbanded. */
export function isRoomOpen(status: RoomStatus): boolean {
  return OPEN_STATUSES.has(status);
}

/** Every still-open room, order preserved. */
export function filterOpenRooms<T extends { status: RoomStatus }>(rooms: readonly T[]): T[] {
  return rooms.filter((room) => isRoomOpen(room.status));
}

/** Newest still-open room. `rooms` is expected newest-first, as the hub returns it. */
export function findOpenRoom<T extends { status: RoomStatus }>(rooms: readonly T[]): T | undefined {
  return filterOpenRooms(rooms)[0];
}
