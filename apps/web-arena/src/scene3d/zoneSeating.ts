/**
 * Pure seat placement for the temporary zones (no `three`, no DOM). Each zone
 * packs people into a fixed-width strip that only grows along the zone's
 * `growDirection` — away from the desk block — so crowded zones can never
 * touch the desks or a neighbouring zone (FR-009).
 */
import type { FloorPoint, Rect, ZoneAnchor } from "./layout.js";

export interface SeatPlacement {
  readonly point: FloorPoint;
  /** Yaw (radians) the avatar settles into. */
  readonly facing: number;
}

const WAR_RING_RADIUS = 2.6;
const WAR_RING_SEATS = 10;
const WAR_GRID_ROWS = 5;
const WAR_GRID_DZ = 1.3;
const WAR_GRID_BACK = 1.1;
const LOUNGE_SEATS_PER_COLUMN = 4;
const LOUNGE_DZ = 1.1;
const LOUNGE_BACK = 1.3;
const KANBAN_SEATS_PER_ROW = 4;
const KANBAN_DX = 1.1;
const KANBAN_BACK = 1.15;
/** First kanban row clears the standing board at the zone centre. */
const KANBAN_FIRST_ROW_OFFSET = 0.9;

function facingToward(center: FloorPoint, point: FloorPoint): number {
  return Math.atan2(center.x - point.x, center.z - point.z);
}

function anchorCenter(anchor: ZoneAnchor): FloorPoint {
  return anchor.center;
}

/** Seats 0-9 share the table ring; overflow stands in a grid marching along -x. */
export function warRoomSeat(anchor: ZoneAnchor, seat: number, occupants: number): SeatPlacement {
  void occupants;
  const center = anchorCenter(anchor);
  if (seat < WAR_RING_SEATS) {
    const angle = (seat / WAR_RING_SEATS) * Math.PI * 2 + Math.PI / 2;
    const point: FloorPoint = {
      x: center.x + Math.cos(angle) * WAR_RING_RADIUS,
      z: center.z + Math.sin(angle) * WAR_RING_RADIUS,
    };
    return { point, facing: facingToward(center, point) };
  }
  const overflow = seat - WAR_RING_SEATS;
  const column = Math.floor(overflow / WAR_GRID_ROWS);
  const row = overflow % WAR_GRID_ROWS;
  const point: FloorPoint = {
    x: center.x - WAR_RING_RADIUS - WAR_GRID_BACK * (column + 1),
    z: center.z + (row - (WAR_GRID_ROWS - 1) / 2) * WAR_GRID_DZ,
  };
  return { point, facing: facingToward(center, point) };
}

/** Lounge seats fill 4-deep columns that step back toward -x. */
export function loungeSeat(anchor: ZoneAnchor, seat: number, occupants: number): SeatPlacement {
  void occupants;
  const center = anchorCenter(anchor);
  const column = Math.floor(seat / LOUNGE_SEATS_PER_COLUMN);
  const row = seat % LOUNGE_SEATS_PER_COLUMN;
  const point: FloorPoint = {
    x: center.x - LOUNGE_BACK * column,
    z: center.z + (row - (LOUNGE_SEATS_PER_COLUMN - 1) / 2) * LOUNGE_DZ,
  };
  // Face west, toward the sofa at the west end of the zone.
  return { point, facing: -Math.PI / 2 };
}

/** Kanban seats form rows in front of the standing board, marching toward -z. */
export function kanbanSeat(anchor: ZoneAnchor, seat: number, occupants: number): SeatPlacement {
  void occupants;
  const center = anchorCenter(anchor);
  const row = Math.floor(seat / KANBAN_SEATS_PER_ROW);
  const col = seat % KANBAN_SEATS_PER_ROW;
  const point: FloorPoint = {
    x: center.x + (col - (KANBAN_SEATS_PER_ROW - 1) / 2) * KANBAN_DX,
    z: center.z - KANBAN_FIRST_ROW_OFFSET - KANBAN_BACK * row,
  };
  // Face south, toward the board and the desk block.
  return { point, facing: 0 };
}

/** Footprint the zone needs for `occupants` people: baseBounds ∪ seat area. */
export function zoneExtent(anchor: ZoneAnchor, occupants: number): Rect {
  const base = anchor.baseBounds;
  const center = anchorCenter(anchor);
  let minX = base.minX;
  let minZ = base.minZ;
  if (anchor.kind === "war_room") {
    const overflow = Math.max(0, occupants - WAR_RING_SEATS);
    const columns = Math.ceil(overflow / WAR_GRID_ROWS);
    if (columns > 0) minX = Math.min(minX, center.x - WAR_RING_RADIUS - WAR_GRID_BACK * columns);
  } else if (anchor.kind === "lounge") {
    const columns = Math.ceil(occupants / LOUNGE_SEATS_PER_COLUMN);
    if (columns > 0) minX = Math.min(minX, center.x - LOUNGE_BACK * (columns - 1));
  } else if (anchor.kind === "kanban") {
    const rows = Math.ceil(occupants / KANBAN_SEATS_PER_ROW);
    if (rows > 0) {
      minZ = Math.min(minZ, center.z - KANBAN_FIRST_ROW_OFFSET - KANBAN_BACK * (rows - 1));
    }
  }
  return { minX, maxX: base.maxX, minZ, maxZ: base.maxZ };
}
