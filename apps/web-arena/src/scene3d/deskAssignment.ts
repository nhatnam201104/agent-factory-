/**
 * Pure desk-slot bookkeeping (R2): every live agent keeps a dense slot in
 * `0..n-1`. Removals punch holes that are refilled by the highest-slot holder
 * (at most one move per hole); brand-new agents take the lowest free slots and
 * never count as moved.
 */

export interface DeskReconcileResult {
  readonly slots: ReadonlyMap<string, number>;
  /** Ids of live agents whose slot changed during this reconcile. */
  readonly moved: readonly string[];
}

export function reconcileDeskSlots(
  prev: ReadonlyMap<string, number>,
  liveIds: readonly string[],
): DeskReconcileResult {
  const total = liveIds.length;
  const kept: Array<{ id: string; slot: number }> = [];
  for (const id of liveIds) {
    const slot = prev.get(id);
    if (slot !== undefined) kept.push({ id, slot });
  }

  const keptSlots = new Set(kept.map((entry) => entry.slot));
  const holes: number[] = [];
  for (let slot = 0; slot < total; slot++) {
    if (!keptSlots.has(slot)) holes.push(slot);
  }
  // Agents whose slot fell outside 0..n-1 fill the lowest holes, one move each.

  const slots = new Map<string, number>();
  const moved: string[] = [];
  let holeIndex = 0;
  for (const entry of kept) {
    if (entry.slot < total) {
      slots.set(entry.id, entry.slot);
      continue;
    }
    const hole = holes[holeIndex++] ?? entry.slot;
    slots.set(entry.id, hole);
    moved.push(entry.id);
  }

  const used = new Set(slots.values());
  for (const id of liveIds) {
    if (slots.has(id)) continue;
    let slot = 0;
    while (used.has(slot)) slot++;
    slots.set(id, slot);
    used.add(slot);
  }
  return { slots, moved };
}
