import { describe, expect, it } from "vitest";
import { computeOfficeLayout } from "../../apps/web-arena/src/scene3d/layout.js";
import {
  kanbanSeat,
  loungeSeat,
  warRoomSeat,
  zoneExtent,
} from "../../apps/web-arena/src/scene3d/zoneSeating.js";

const EPS = 1e-9;
const OCCUPANTS = [1, 6, 10, 30, 200] as const;
const layout = computeOfficeLayout(200);
const desks = layout.desks.bounds;

function insideRect(
  p: { x: number; z: number },
  rect: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return p.x >= rect.minX && p.x <= rect.maxX && p.z >= rect.minZ && p.z <= rect.maxZ;
}

describe("zone seating (FR-009, FR-018)", () => {
  it("keeps seats at least 1.1 apart in every zone and scale", () => {
    for (const occupants of OCCUPANTS) {
      const sets = [
        Array.from({ length: Math.min(occupants, 200) }, (_, i) =>
          warRoomSeat(layout.zones.war_room, i, occupants),
        ),
        Array.from({ length: Math.min(occupants, 200) }, (_, i) =>
          loungeSeat(layout.zones.lounge, i, occupants),
        ),
        Array.from({ length: Math.min(occupants, 200) }, (_, i) =>
          kanbanSeat(layout.zones.kanban, i, occupants),
        ),
      ];
      for (const set of sets) {
        for (let i = 0; i < set.length; i++) {
          for (let j = i + 1; j < set.length; j++) {
            const a = set[i];
            const b = set[j];
            if (!a || !b) continue;
            const dist = Math.hypot(a.point.x - b.point.x, a.point.z - b.point.z);
            expect(dist, `${i}/${j} too close with ${occupants} occupants`).toBeGreaterThanOrEqual(
              1.1 - EPS,
            );
          }
        }
      }
    }
  });

  it("seats war-room agents 0..9 on the table ring facing the centre", () => {
    for (const occupants of OCCUPANTS) {
      const anchor = layout.zones.war_room;
      for (let seat = 0; seat < Math.min(10, occupants); seat++) {
        const placement = warRoomSeat(anchor, seat, occupants);
        const radius = Math.hypot(
          placement.point.x - anchor.center.x,
          placement.point.z - anchor.center.z,
        );
        expect(radius).toBeCloseTo(2.6, 6);
        const toCenter = Math.atan2(
          anchor.center.x - placement.point.x,
          anchor.center.z - placement.point.z,
        );
        expect(placement.facing).toBeCloseTo(toCenter, 6);
      }
    }
  });

  it("piles overflow war-room agents into a grid behind the table along -x", () => {
    const anchor = layout.zones.war_room;
    const seat = warRoomSeat(anchor, 17, 200); // column 1, row 2 of the overflow grid
    expect(seat.point.x).toBeLessThan(anchor.center.x - 3.6);
    expect(seat.point.x).toBeCloseTo(anchor.center.x - 3.7 - 1.1, 6);
    expect(seat.point.z).toBeCloseTo(anchor.center.z + (2 - 2) * 1.3, 6);
    const first = warRoomSeat(anchor, 10, 200);
    expect(first.point.z).toBeCloseTo(anchor.center.z - 2 * 1.3, 6);
    // The grid stays within the zone's 6.4-tall z strip.
    for (let row = 0; row < 5; row++) {
      const p = warRoomSeat(anchor, 10 + row, 200).point;
      expect(Math.abs(p.z - anchor.center.z)).toBeLessThanOrEqual(3.2 + EPS);
    }
  });

  it("spreads lounge seats in a 4.4-deep z strip and kanban seats in a 4.4-wide x strip", () => {
    const lounge = layout.zones.lounge;
    for (let i = 0; i < 8; i++) {
      const p = loungeSeat(lounge, i, 200).point;
      expect(Math.abs(p.z - lounge.center.z)).toBeLessThanOrEqual(2.2 + EPS);
    }
    const columnStep = loungeSeat(lounge, 4, 200).point.x - loungeSeat(lounge, 0, 200).point.x;
    expect(columnStep).toBeLessThanOrEqual(-1.3 + EPS);

    const kanban = layout.zones.kanban;
    for (let i = 0; i < 8; i++) {
      const p = kanbanSeat(kanban, i, 200).point;
      expect(Math.abs(p.x - kanban.center.x)).toBeLessThanOrEqual(2.2 + EPS);
    }
  });

  it("never places zone seats on the desk block", () => {
    for (const occupants of OCCUPANTS) {
      const samples = [
        warRoomSeat(layout.zones.war_room, occupants - 1, occupants).point,
        loungeSeat(layout.zones.lounge, occupants - 1, occupants).point,
        kanbanSeat(layout.zones.kanban, occupants - 1, occupants).point,
      ];
      for (const p of samples) {
        expect(insideRect(p, desks), `seat ${JSON.stringify(p)} inside desks`).toBe(false);
      }
    }
  });

  it("grows zoneExtent only along growDirection and covers every seat (FR-009)", () => {
    const kinds = ["war_room", "lounge", "kanban"] as const;
    for (const occupants of OCCUPANTS) {
      for (const kind of kinds) {
        const anchor = layout.zones[kind];
        if (!anchor) continue;
        const extent = zoneExtent(anchor, occupants);
        // Contains baseBounds.
        expect(extent.minX).toBeLessThanOrEqual(anchor.baseBounds.minX + EPS);
        expect(extent.maxX).toBeGreaterThanOrEqual(anchor.baseBounds.maxX - EPS);
        expect(extent.minZ).toBeLessThanOrEqual(anchor.baseBounds.minZ + EPS);
        expect(extent.maxZ).toBeGreaterThanOrEqual(anchor.baseBounds.maxZ - EPS);
        // Exceeds baseBounds only toward growDirection.
        if (anchor.growDirection.x < 0) {
          expect(extent.maxX).toBeCloseTo(anchor.baseBounds.maxX, 9);
        }
        if (anchor.growDirection.z < 0) {
          expect(extent.maxZ).toBeCloseTo(anchor.baseBounds.maxZ, 9);
        }
        // Contains every seat.
        const seating =
          kind === "war_room" ? warRoomSeat : kind === "lounge" ? loungeSeat : kanbanSeat;
        for (let i = 0; i < occupants; i++) {
          const p = seating(anchor, i, occupants).point;
          expect(
            insideRect(p, extent),
            `seat ${i} of ${kind} outside zoneExtent at ${occupants}`,
          ).toBe(true);
        }
        // Never reaches the desks or another zone.
        const others = kinds
          .filter((k) => k !== kind)
          .map((k) => layout.zones[k]?.baseBounds)
          .filter((rect) => rect !== undefined);
        for (const rect of [desks, ...others]) {
          const intersects =
            extent.minX <= rect.maxX &&
            extent.maxX >= rect.minX &&
            extent.minZ <= rect.maxZ &&
            extent.maxZ >= rect.minZ;
          expect(
            intersects,
            `${kind} zoneExtent intersects a neighbouring rect at ${occupants}`,
          ).toBe(false);
        }
      }
    }
  });
});
