import { describe, expect, it } from "vitest";
import {
  AISLE,
  AISLE_GAP,
  DESK_PITCH,
  type Rect,
  computeOfficeLayout,
  deskSlotPosition,
  slotCell,
} from "../../apps/web-arena/src/scene3d/layout.js";

const EPS = 1e-9;
/** Station footprint around the agent spot; must match buildDeskStation (EmployeeAvatar.tsx). */
const STATION_HALF_WIDTH = 0.8;
const STATION_Z_BACK = -0.72;
const STATION_Z_FRONT = 1.12;
/** Largest functional zone (war room): the biggest empty floor region allowed (SC-005). */
const LARGEST_ZONE_AREA = 6.4 * 6.4;

function stationRect(x: number, z: number): Rect {
  return {
    minX: x - STATION_HALF_WIDTH,
    maxX: x + STATION_HALF_WIDTH,
    minZ: z + STATION_Z_BACK,
    maxZ: z + STATION_Z_FRONT,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.minX < b.maxX - EPS && b.minX < a.maxX - EPS && a.minZ < b.maxZ - EPS && b.minZ < a.maxZ - EPS
  );
}

/** Rect-to-rect distance (0 when they intersect or touch). */
function rectDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.hypot(dx, dz);
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.minX >= outer.minX - EPS &&
    inner.maxX <= outer.maxX + EPS &&
    inner.minZ >= outer.minZ - EPS &&
    inner.maxZ <= outer.maxZ + EPS
  );
}

/** True when two rects share an edge segment of positive length (edge-touch graph). */
function touchesEdge(a: Rect, b: Rect): boolean {
  const xOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const zOverlap = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  const touchX = Math.abs(a.maxX - b.minX) < EPS || Math.abs(b.maxX - a.minX) < EPS;
  const touchZ = Math.abs(a.maxZ - b.minZ) < EPS || Math.abs(b.maxZ - a.minZ) < EPS;
  return (touchX && zOverlap > EPS) || (touchZ && xOverlap > EPS);
}

describe("slotCell square-shell order", () => {
  it("matches the fixed shell coordinates (R1)", () => {
    expect(slotCell(0)).toEqual({ col: 0, row: 0 });
    expect(slotCell(1)).toEqual({ col: 1, row: 0 });
    expect(slotCell(2)).toEqual({ col: 1, row: 1 });
    expect(slotCell(3)).toEqual({ col: 0, row: 1 });
    expect(slotCell(4)).toEqual({ col: 2, row: 0 });
    expect(slotCell(6)).toEqual({ col: 2, row: 2 });
    expect(slotCell(8)).toEqual({ col: 1, row: 2 });
  });

  it("is independent of the total agent count", () => {
    const layout50 = computeOfficeLayout(50);
    const layout51 = computeOfficeLayout(51);
    // Slot coordinates depend only on k, so slots 0..49 keep the same spot in both layouts.
    for (let k = 0; k < 50; k++) {
      const pos = deskSlotPosition(k);
      expect(pos.x).toBeGreaterThanOrEqual(layout50.desks.bounds.minX - EPS);
      expect(pos.x).toBeGreaterThanOrEqual(layout51.desks.bounds.minX - EPS);
      expect(pos.z).toBeGreaterThanOrEqual(layout50.desks.bounds.minZ - EPS);
      expect(pos.z).toBeGreaterThanOrEqual(layout51.desks.bounds.minZ - EPS);
    }
    // Growing never moves the origin: the block only extends toward +x / +z.
    expect(layout51.desks.bounds.minX).toBe(layout50.desks.bounds.minX);
    expect(layout51.desks.bounds.minZ).toBe(layout50.desks.bounds.minZ);
    expect(layout51.desks.bounds.maxX).toBeGreaterThanOrEqual(layout50.desks.bounds.maxX);
    expect(layout51.desks.bounds.maxZ).toBeGreaterThanOrEqual(layout50.desks.bounds.maxZ);
  });
});

describe("computeOfficeLayout geometry (n = 0..200)", () => {
  it("keeps every desk and its station inside the floor (SC-001, FR-004)", () => {
    for (let n = 0; n <= 200; n++) {
      const layout = computeOfficeLayout(n);
      expect(layout.desks.count).toBe(n);
      for (let k = 0; k < n; k++) {
        const pos = deskSlotPosition(k);
        expect(pos.x).toBeGreaterThanOrEqual(layout.desks.bounds.minX - EPS);
        expect(pos.x).toBeLessThanOrEqual(layout.desks.bounds.maxX + EPS);
        expect(pos.z).toBeGreaterThanOrEqual(layout.desks.bounds.minZ - EPS);
        expect(pos.z).toBeLessThanOrEqual(layout.desks.bounds.maxZ + EPS);
        const station = stationRect(pos.x, pos.z);
        const host = layout.floorRects.find((rect) => contains(rect, station));
        expect(host, `desk ${k} of n=${n} must sit fully on one floor rect`).toBeDefined();
      }
    }
  });

  it("never overlaps desks and keeps at least DESK_PITCH apart on one axis (FR-016)", () => {
    // Stations are far smaller than DESK_PITCH, so center separation on one
    // axis implies the desk furniture cannot overlap either.
    const positions = Array.from({ length: 201 }, (_, k) => deskSlotPosition(k));
    const violations: string[] = [];
    for (let n = 0; n <= 200; n++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = positions[i];
          const b = positions[j];
          if (!a || !b) continue;
          const dx = Math.abs(a.x - b.x);
          const dz = Math.abs(a.z - b.z);
          if (Math.max(dx, dz) < 4.1 - 1e-6) violations.push(`n=${n} desks ${i}/${j}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the desk block nearly square (SC-004, FR-006)", () => {
    for (let n = 6; n <= 200; n++) {
      const bounds = computeOfficeLayout(n).desks.bounds;
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxZ - bounds.minZ;
      expect(Math.max(w, h) / Math.min(w, h)).toBeLessThanOrEqual(2 + EPS);
    }
  });

  it("separates zones from each other and from the desks by at least AISLE (FR-007)", () => {
    const kinds = ["war_room", "lounge", "kanban", "director", "coffee"] as const;
    for (let n = 0; n <= 200; n += 7) {
      const layout = computeOfficeLayout(n);
      const zones = kinds
        .map((kind) => layout.zones[kind]?.baseBounds)
        .filter((z) => z !== undefined);
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        if (!zone) continue;
        for (let j = i + 1; j < zones.length; j++) {
          const other = zones[j];
          if (!other) continue;
          expect(overlaps(zone, other), `zones ${i}/${j} overlap at n=${n}`).toBe(false);
          expect(rectDistance(zone, other)).toBeGreaterThanOrEqual(2.0 - EPS);
        }
        expect(overlaps(zone, layout.desks.bounds), `zone ${i} intersects desks at n=${n}`).toBe(
          false,
        );
        expect(rectDistance(zone, layout.desks.bounds)).toBeGreaterThanOrEqual(2.0 - EPS);
      }
    }
  });

  it("keeps zones completely static regardless of agent count (FR-007, FR-014)", () => {
    const reference = JSON.stringify(computeOfficeLayout(0).zones);
    for (let n = 0; n <= 200; n++) {
      expect(JSON.stringify(computeOfficeLayout(n).zones)).toBe(reference);
    }
  });

  it("normalizes invalid agent counts like floor(max(0, n))", () => {
    const zero = computeOfficeLayout(0);
    expect(computeOfficeLayout(-3).desks.bounds).toEqual(zero.desks.bounds);
    expect(computeOfficeLayout(-3).key).toBe(zero.key);
    expect(computeOfficeLayout(2.7).key).toBe(computeOfficeLayout(2).key);
    expect(computeOfficeLayout(2.7).desks.bounds).toEqual(computeOfficeLayout(2).desks.bounds);
  });

  it("still provides all five zones and a non-empty footprint for n = 0", () => {
    const layout = computeOfficeLayout(0);
    expect(Object.keys(layout.zones).sort()).toEqual([
      "coffee",
      "director",
      "kanban",
      "lounge",
      "war_room",
    ]);
    expect(layout.desks.count).toBe(0);
    expect(layout.footprint.maxX - layout.footprint.minX).toBeGreaterThan(0);
    expect(layout.footprint.maxZ - layout.footprint.minZ).toBeGreaterThan(0);
  });

  it("builds disjoint connected floor rects that host every zone (SC-001)", () => {
    const kinds = ["war_room", "lounge", "kanban", "director", "coffee"] as const;
    for (let n = 0; n <= 200; n += 13) {
      const layout = computeOfficeLayout(n);
      const rects = layout.floorRects;
      for (let i = 0; i < rects.length; i++) {
        const a = rects[i];
        if (!a) continue;
        for (let j = i + 1; j < rects.length; j++) {
          const b = rects[j];
          if (!b) continue;
          expect(overlaps(a, b), `floorRects ${i}/${j} overlap at n=${n}`).toBe(false);
        }
      }
      // Edge-touch graph is connected.
      const seen = new Set<number>([0]);
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < rects.length; i++) {
          const candidate = rects[i];
          if (!candidate || seen.has(i)) continue;
          for (const j of seen) {
            const anchor = rects[j];
            if (!anchor) continue;
            if (touchesEdge(candidate, anchor)) {
              seen.add(i);
              grew = true;
              break;
            }
          }
        }
      }
      expect(seen.size, `floorRects must connect at n=${n}`).toBe(rects.length);
      // Every zone bounds sits fully inside one floor rect.
      for (const kind of kinds) {
        const bounds = layout.zones[kind]?.baseBounds;
        if (!bounds) continue;
        expect(
          rects.some((rect) => contains(rect, bounds)),
          `zone ${kind} not fully on the floor at n=${n}`,
        ).toBe(true);
      }
      // footprint = bounding box of floorRects.
      const minX = Math.min(...rects.map((r) => r.minX));
      const maxX = Math.max(...rects.map((r) => r.maxX));
      const minZ = Math.min(...rects.map((r) => r.minZ));
      const maxZ = Math.max(...rects.map((r) => r.maxZ));
      expect(layout.footprint).toEqual({ minX, maxX, minZ, maxZ });
    }
  });
});

describe("compact layout (SC-005, FR-007)", () => {
  type Cell = { cx: number; cz: number };

  function emptyRegions(n: number): number[] {
    const layout = computeOfficeLayout(n);
    const margin = 1.5;
    const interior = (r: Rect): Rect => ({
      minX: r.minX + margin,
      maxX: r.maxX - margin,
      minZ: r.minZ + margin,
      maxZ: r.maxZ - margin,
    });
    const covered: Rect[] = [
      layout.desks.bounds,
      ...Object.values(layout.zones).map((z) => z.baseBounds),
    ];
    const onFloorInterior = (cell: Cell): boolean =>
      layout.floorRects.some((r) => {
        const inner = interior(r);
        return (
          cell.cx >= inner.minX &&
          cell.cx <= inner.maxX &&
          cell.cz >= inner.minZ &&
          cell.cz <= inner.maxZ
        );
      });
    const isCovered = (cell: Cell): boolean =>
      covered.some(
        (r) => cell.cx >= r.minX && cell.cx <= r.maxX && cell.cz >= r.minZ && cell.cz <= r.maxZ,
      );
    const empty = new Set<string>();
    const fp = layout.footprint;
    for (let cx = Math.ceil(fp.minX); cx <= Math.floor(fp.maxX); cx++) {
      for (let cz = Math.ceil(fp.minZ); cz <= Math.floor(fp.maxZ); cz++) {
        const cell: Cell = { cx: cx + 0.5, cz: cz + 0.5 };
        if (onFloorInterior(cell) && !isCovered(cell)) empty.add(`${cell.cx}|${cell.cz}`);
      }
    }
    // BFS over 4-connected empty cells.
    const regions: number[] = [];
    const visited = new Set<string>();
    for (const key of empty) {
      if (visited.has(key)) continue;
      let area = 0;
      const queue = [key];
      visited.add(key);
      while (queue.length) {
        const current = queue.pop();
        if (!current) continue;
        area++;
        const [cx, cz] = current.split("|").map(Number);
        for (const [nx, nz] of [
          [cx + 1, cz],
          [cx - 1, cz],
          [cx, cz + 1],
          [cx, cz - 1],
        ]) {
          const next = `${nx}|${nz}`;
          if (empty.has(next) && !visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      regions.push(area);
    }
    return regions;
  }

  it("leaves no empty floor region larger than the biggest zone (SC-005)", () => {
    for (const n of [0, 1, 2, 6, 30, 100, 200]) {
      const regions = emptyRegions(n);
      const largest = regions.length ? Math.max(...regions) : 0;
      expect(largest, `largest empty region at n=${n} is ${largest}`).toBeLessThanOrEqual(
        LARGEST_ZONE_AREA + EPS,
      );
    }
  });

  it("hugs the desk block within AISLE + 1 at working scale (FR-007)", () => {
    for (const n of [30, 100, 200]) {
      const layout = computeOfficeLayout(n);
      for (const anchor of Object.values(layout.zones)) {
        expect(
          rectDistance(anchor.baseBounds, layout.desks.bounds),
          `${anchor.kind} too far from desks at n=${n}`,
        ).toBeLessThanOrEqual(AISLE + 1.0 + EPS);
      }
    }
  });
});

describe("desk spacing (US5, FR-016)", () => {
  it("uses a pitch at least 1.4x the old 2.9 spacing", () => {
    expect(DESK_PITCH.x).toBeGreaterThanOrEqual(2.9 * 1.4);
    expect(DESK_PITCH.z).toBeGreaterThanOrEqual(2.9 * 1.4);
  });

  it("inserts walkways after every 4 columns and rows (R3)", () => {
    // slot 16 -> cell (4,0); slot 9 -> cell (3,0); slot 13 -> cell (0,3); slot 21 -> cell (0,4).
    expect(slotCell(16)).toEqual({ col: 4, row: 0 });
    expect(slotCell(9)).toEqual({ col: 3, row: 0 });
    expect(slotCell(13)).toEqual({ col: 0, row: 3 });
    expect(slotCell(21)).toEqual({ col: 0, row: 4 });
    const colStep = deskSlotPosition(16).x - deskSlotPosition(9).x;
    const rowStep = deskSlotPosition(21).z - deskSlotPosition(13).z;
    expect(colStep).toBeGreaterThanOrEqual(4.1 + AISLE_GAP - EPS);
    expect(rowStep).toBeGreaterThanOrEqual(4.1 + AISLE_GAP - EPS);
    // The walkway is an addition on top of the regular pitch, not a wider pitch.
    expect(colStep).toBeLessThan(DESK_PITCH.x * 2);
    expect(rowStep).toBeLessThan(DESK_PITCH.z * 2);
  });
});
