/** Restore the active ancestry without erasing any original decision or attempt. */
export function activeDecisionLineage(entries) {
  let head = null;
  const before = new Map();
  for (const entry of entries) {
    if (entry.kind === 'finalization') {
      for (let item = head; item; item = item.previous) {
        if (item.move.moveId === entry.targetDecisionId) { item.move = entry.finalizedMove; break; }
      }
    } else if (entry.move) {
      before.set(entry.id, head);
      if (!entry.move.undone) head = { move: entry.move, previous: head };
    } else if (entry.kind === 'restoration') {
      head = before.get(entry.targetDecisionId ?? entry.restoredIds?.[0]) ?? null;
    }
  }
  const result = [];
  for (let item = head; item; item = item.previous) result.push(item.move);
  return result.reverse();
}
