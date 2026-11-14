/** World-space layout of the cozy office diorama (units ≈ meters, y is up). */

export interface FloorPoint {
  x: number;
  z: number;
}

export const FLOOR = { width: 20, depth: 14 } as const;

const DESK_COLUMNS = 3;
const DESK_ORIGIN = { x: -7.9, z: -3.2 } as const;
const DESK_SPACING = { x: 2.9, z: 2.9 } as const;

export const WAR_ROOM_CENTER: FloorPoint = { x: 4.9, z: 0 };
const WAR_ROOM_SEAT_RADIUS = 2.15;
const MIN_WAR_ROOM_SEATS = 6;

export const LOUNGE_CENTER: FloorPoint = { x: 5.4, z: 5.7 };
export const KANBAN_BOARD_CENTER: FloorPoint = { x: -7.4, z: -6.95 };

/** Where an employee stands while working at their own desk (desk sits in front, +z). */
export function deskPosition(index: number): FloorPoint {
  const col = index % DESK_COLUMNS;
  const row = Math.floor(index / DESK_COLUMNS);
  return {
    x: DESK_ORIGIN.x + col * DESK_SPACING.x,
    z: DESK_ORIGIN.z + row * DESK_SPACING.z,
  };
}

/** Evenly spaced seat around the round war-room table. */
export function warRoomPosition(seat: number, occupants: number): FloorPoint {
  const seats = Math.max(MIN_WAR_ROOM_SEATS, occupants);
  const angle = (seat / seats) * Math.PI * 2 + Math.PI / 2;
  return {
    x: WAR_ROOM_CENTER.x + Math.cos(angle) * WAR_ROOM_SEAT_RADIUS,
    z: WAR_ROOM_CENTER.z + Math.sin(angle) * WAR_ROOM_SEAT_RADIUS,
  };
}

/** Spot in front of the lounge sofa for offline / resting sessions. */
export function loungePosition(seat: number): FloorPoint {
  const perRow = 4;
  return {
    x: LOUNGE_CENTER.x - 1.35 + (seat % perRow) * 0.9,
    z: LOUNGE_CENTER.z - 0.75 + Math.floor(seat / perRow) * 0.7,
  };
}

/** Standing spot in front of the kanban pin-board. */
export function kanbanPosition(seat: number): FloorPoint {
  return {
    x: KANBAN_BOARD_CENTER.x - 1.1 + (seat % 4) * 0.75,
    z: KANBAN_BOARD_CENTER.z + 1.3 + Math.floor(seat / 4) * 0.8,
  };
}
