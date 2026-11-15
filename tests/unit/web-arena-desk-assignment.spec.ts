import { describe, expect, it } from "vitest";
import { reconcileDeskSlots } from "../../apps/web-arena/src/scene3d/deskAssignment.js";

function ids(count: number, prefix = "emp"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

function slotSet(slots: ReadonlyMap<string, number>): number[] {
  return [...slots.values()].sort((a, b) => a - b);
}

describe("reconcileDeskSlots", () => {
  it("adds an agent to the lowest free slot and moves nobody", () => {
    const prev = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const { slots, moved } = reconcileDeskSlots(prev, ["a", "b", "c"]);
    expect([...slots.entries()].sort()).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    expect(moved).toEqual([]);
  });

  it("fills the hole of a single removal with the highest slot holder", () => {
    const prev = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 3],
    ]);
    const { slots, moved } = reconcileDeskSlots(prev, ["a", "b", "d"]);
    expect(slotSet(slots)).toEqual([0, 1, 2]);
    expect(slots.get("a")).toBe(0);
    expect(slots.get("b")).toBe(1);
    expect(slots.get("d")).toBe(2);
    expect(moved).toEqual(["d"]);
  });

  it("compacts heavily after bulk removals (60 of 120)", () => {
    let slots = new Map<string, number>();
    const all = ids(120);
    const { slots: afterAdd } = reconcileDeskSlots(slots, all);
    slots = afterAdd;
    const survivors = all.slice(0, 60);
    const { slots: compacted, moved } = reconcileDeskSlots(slots, survivors);
    expect(slotSet(compacted)).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(moved.length).toBeLessThanOrEqual(60);
    for (const [id, slot] of compacted) expect(slot).toBeLessThan(60);
    void slots;
  });

  it("never reports brand-new agents as moved", () => {
    const prev = new Map([["old", 0]]);
    const { moved } = reconcileDeskSlots(prev, ["old", "fresh-1", "fresh-2"]);
    expect(moved).toEqual([]);
  });

  it("does not mutate the previous map", () => {
    const prev = new Map([
      ["a", 0],
      ["b", 1],
    ]);
    const snapshot = new Map(prev);
    reconcileDeskSlots(prev, ["b"]);
    expect([...prev.entries()].sort()).toEqual([...snapshot.entries()].sort());
  });

  it("keeps assignments stable when live id order changes", () => {
    const prev = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    const first = reconcileDeskSlots(prev, ["a", "b", "c"]);
    const second = reconcileDeskSlots(prev, ["c", "a", "b"]);
    expect(second.moved).toEqual([]);
    for (const [id, slot] of first.slots) expect(second.slots.get(id)).toBe(slot);
  });

  it("holds the dense-slot invariant through a seeded random add/remove walk", () => {
    let seed = 0x2f6a88c1;
    const rand = (max: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % max;
    };
    let slots = new Map<string, number>();
    let live: string[] = [];
    let created = 0;
    for (let step = 0; step < 500; step++) {
      if (live.length === 0 || rand(3) < 2) {
        live = [...live, `gen-${created++}`];
      } else {
        const victim = rand(live.length);
        live = live.filter((_, i) => i !== victim);
      }
      const result = reconcileDeskSlots(slots, live);
      slots = result.slots as Map<string, number>;
      expect(slotSet(slots)).toEqual(Array.from({ length: live.length }, (_, i) => i));
      expect(slots.size).toBe(live.length);
    }
  });

  it("moves at most one desk per single removal and none per add (SC-006)", () => {
    let seed = 0x51ed270b;
    const rand = (max: number): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % max;
    };
    let slots = new Map<string, number>();
    let live: string[] = [];
    let created = 0;
    // Grow to 200 one agent at a time.
    while (live.length < 200) {
      live = [...live, `walk-${created++}`];
      const { slots: next, moved } = reconcileDeskSlots(slots, live);
      expect(moved, "adding must never move existing agents").toEqual([]);
      slots = next as Map<string, number>;
    }
    // Shrink back to 0 one agent at a time.
    while (live.length > 0) {
      const victim = rand(live.length);
      live = live.filter((_, i) => i !== victim);
      const { slots: next, moved } = reconcileDeskSlots(slots, live);
      if (live.length >= 10) {
        expect(
          moved.length,
          `removal to n=${live.length} moved ${moved.length} agents`,
        ).toBeLessThanOrEqual(Math.max(1, Math.floor(live.length * 0.1)));
      }
      expect(moved.length).toBeLessThanOrEqual(1);
      slots = next as Map<string, number>;
      expect(slotSet(slots)).toEqual(Array.from({ length: live.length }, (_, i) => i));
    }
  });
});
