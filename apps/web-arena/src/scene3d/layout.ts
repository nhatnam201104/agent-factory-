/**
 * Pure world-space layout of the open-world office (units ≈ meters, y is up).
 * No `three`, no DOM — safe to unit-test in node. The desk block starts at the
 * origin and only grows toward +x/+z; the five functional zones are anchored
 * constants so adding or removing agents never moves them (R7).
 */

export interface FloorPoint {
  readonly x: number;
  readonly z: number;
}

export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export type ZoneKind = "war_room" | "lounge" | "kanban" | "director" | "coffee";

export interface ZoneAnchor {
  readonly kind: ZoneKind;
  readonly center: FloorPoint;
  /** Footprint the zone occupies when empty (furniture + rug). */
  readonly baseBounds: Rect;
  /** Unit vector the zone grows toward when crowded — always away from the desk block. */
  readonly growDirection: FloorPoint;
}

export interface DeskGrid {
  readonly count: number;
  readonly cols: number;
  readonly rows: number;
  readonly bounds: Rect;
}

export interface OfficeLayout {
  /** `"${cols}x${rows}"` — changes only when the desk-block bounding frame changes. */
  readonly key: string;
  readonly desks: DeskGrid;
  readonly zones: Readonly<Record<ZoneKind, ZoneAnchor>>;
  /** Disjoint edge-touching rects forming the wooden floor; union is connected. */
  readonly floorRects: readonly Rect[];
  /** Bounding box of floorRects — used by the camera and the ground plane, not walkable per se. */
  readonly footprint: Rect;
  readonly decorSpots: readonly FloorPoint[];
}

export const DESK_PITCH = { x: 4.1, z: 4.1 } as const;
/** Clearance between the desk block and zones, and between zones. */
export const AISLE = 2.0;
/** Walkway added after every 4 columns / rows of desks (added with the aisles in US5). */
export const AISLE_GAP = 1.4;
export const FOOTPRINT_MARGIN = 1.5;

/**
 * One desk station's footprint around the agent's standing spot. Mirrors
 * buildDeskStation (EmployeeAvatar.tsx): desk top 1.6 × 0.8 centered at z=0.72,
 * office chair centered at z=−0.42.
 */
export const DESK_STATION = {
  halfWidth: 0.8,
  /** Most negative z the chair reaches, relative to the agent spot. */
  zBack: -0.72,
  /** Most positive z the desk front edge reaches, relative to the agent spot. */
  zFront: 1.12,
} as const;

/** Grid cell of slot k in the fixed square-shell order (R1); never depends on n. */
export function slotCell(slot: number): { col: number; row: number } {
  const k = Math.max(0, Math.floor(slot));
  const s = Math.floor(Math.sqrt(k));
  const j = k - s * s;
  return j <= s ? { col: s, row: j } : { col: j - s - 1, row: s };
}

/** Agent spot at desk slot k; the desk sits in front at +z. A 1.4 m walkway
 * separates every 4x4 cluster of desks (R3). Block starts at (0,0). */
export function deskSlotPosition(slot: number): FloorPoint {
  const { col, row } = slotCell(slot);
  return {
    x: col * DESK_PITCH.x + Math.floor(col / 4) * AISLE_GAP,
    z: row * DESK_PITCH.z + Math.floor(row / 4) * AISLE_GAP,
  };
}

/** Centre-to-centre extent of a grid line index, walkways included (monotone). */
function gridExtent(index: number, pitch: number): number {
  return index * pitch + Math.floor(index / 4) * AISLE_GAP;
}

const rect = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({
  minX,
  maxX,
  minZ,
  maxZ,
});
const grow = (x: number, z: number): FloorPoint => ({ x, z });

/** Zone anchors are compile-time constants: identical for every agent count (FR-007). */
function buildZones(): Readonly<Record<ZoneKind, ZoneAnchor>> {
  const war: ZoneAnchor = {
    kind: "war_room",
    center: { x: -6, z: 0 },
    baseBounds: rect(-9.2, -2.8, -3.2, 3.2),
    growDirection: grow(-1, 0),
  };
  const lounge: ZoneAnchor = {
    kind: "lounge",
    center: { x: -4.9, z: 7.4 },
    baseBounds: rect(-7, -2.8, 5.2, 9.6),
    growDirection: grow(-1, 0),
  };
  const coffee: ZoneAnchor = {
    kind: "coffee",
    center: { x: -4.25, z: 12.8 },
    baseBounds: rect(-4.7, -3.8, 11.6, 14),
    growDirection: grow(-1, 0),
  };
  const kanban: ZoneAnchor = {
    kind: "kanban",
    center: { x: 2.2, z: -3.52 },
    baseBounds: rect(0, 4.4, -4.32, -2.72),
    growDirection: grow(0, -1),
  };
  const director: ZoneAnchor = {
    kind: "director",
    center: { x: 7.6, z: -3.67 },
    baseBounds: rect(6.4, 8.8, -4.62, -2.72),
    growDirection: grow(0, -1),
  };
  return { war_room: war, lounge, coffee, kanban, director };
}
const ZONES = buildZones();

const expand = (bounds: Rect, margin: number): Rect =>
  rect(bounds.minX - margin, bounds.maxX + margin, bounds.minZ - margin, bounds.maxZ + margin);

function boundingBox(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.minX));
  const maxX = Math.max(...rects.map((r) => r.maxX));
  const minZ = Math.min(...rects.map((r) => r.minZ));
  const maxZ = Math.max(...rects.map((r) => r.maxZ));
  return { minX, maxX, minZ, maxZ };
}

/** Plants every ~5 units along a floor edge, kept only where the edge is walkable floor. */
function buildDecorSpots(floorRects: readonly Rect[], footprint: Rect): FloorPoint[] {
  const inset = 0.8;
  const edges: Array<{ horizontal: boolean; fixed: number; from: number; to: number }> = [
    { horizontal: true, fixed: footprint.minZ + inset, from: footprint.minX, to: footprint.maxX },
    { horizontal: false, fixed: footprint.minX + inset, from: footprint.minZ, to: footprint.maxZ },
    { horizontal: true, fixed: footprint.maxZ - inset, from: footprint.minX, to: footprint.maxX },
    { horizontal: false, fixed: footprint.maxX - inset, from: footprint.minZ, to: footprint.maxZ },
  ];
  const onFloor = (p: FloorPoint): boolean =>
    floorRects.some((r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ);
  const spots: FloorPoint[] = [];
  for (const edge of edges) {
    for (let t = edge.from + 2.5; t <= edge.to - 2; t += 5) {
      const point: FloorPoint = edge.horizontal ? { x: t, z: edge.fixed } : { x: edge.fixed, z: t };
      if (onFloor(point)) spots.push(point);
    }
  }
  return spots;
}

/** Immutable layout for `agentCount` agents; invalid counts behave as floor(max(0, n)). */
export function computeOfficeLayout(agentCount: number): OfficeLayout {
  const count = Math.max(0, Math.floor(agentCount));
  let maxCol = 0;
  let maxRow = 0;
  for (let k = 1; k < count; k++) {
    const cell = slotCell(k);
    if (cell.col > maxCol) maxCol = cell.col;
    if (cell.row > maxRow) maxRow = cell.row;
  }
  const cols = maxCol + 1;
  const rows = maxRow + 1;
  const desks: DeskGrid = {
    count,
    cols,
    rows,
    bounds: rect(
      -DESK_STATION.halfWidth,
      gridExtent(maxCol, DESK_PITCH.x) + DESK_STATION.halfWidth,
      DESK_STATION.zBack,
      gridExtent(maxRow, DESK_PITCH.z) + DESK_STATION.zFront,
    ),
  };

  const northStrip = rect(
    ZONES.kanban.baseBounds.minX - FOOTPRINT_MARGIN,
    ZONES.director.baseBounds.maxX + FOOTPRINT_MARGIN,
    ZONES.director.baseBounds.minZ - FOOTPRINT_MARGIN,
    desks.bounds.minZ - FOOTPRINT_MARGIN,
  );
  // Trim the east edge to the desk block's west edge so the two rects touch
  // without overlapping (their 1.5 m margins would otherwise collide).
  const westStrip = rect(
    ZONES.war_room.baseBounds.minX - FOOTPRINT_MARGIN,
    desks.bounds.minX - FOOTPRINT_MARGIN,
    ZONES.war_room.baseBounds.minZ - FOOTPRINT_MARGIN,
    ZONES.coffee.baseBounds.maxZ + FOOTPRINT_MARGIN,
  );
  const deskBlock = expand(desks.bounds, FOOTPRINT_MARGIN);
  const floorRects = [northStrip, westStrip, deskBlock] as const;
  const footprint = boundingBox(floorRects);
  return {
    key: `${cols}x${rows}`,
    desks,
    zones: ZONES,
    floorRects,
    footprint,
    decorSpots: buildDecorSpots(floorRects, footprint),
  };
}
