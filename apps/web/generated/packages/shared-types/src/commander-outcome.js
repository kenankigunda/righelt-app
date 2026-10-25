// Absence and loss of supply are different defeats. Keep their persisted reason
// codes shared by the engine and presentation of older, ambiguous records.
export function commanderOutcome(pieces) {
  const defeat = id => {
    const commander = pieces.find(piece => piece.id === id);
    return !commander ? 'destroyed' : commander.supplied ? null : 'unsupplied';
  };
  const p1 = defeat('C1'), p2 = defeat('C2');
  if (!p1 && !p2) return { status: 'ongoing' };
  if (p1 && p2) return { status: 'draw', reason: p1 === p2 ? `both_commanders_${p1}` : `p1_commander_${p1}_p2_${p2}` };
  return p1 ? { status: 'p2_win', reason: `p1_commander_${p1}` } : { status: 'p1_win', reason: `p2_commander_${p2}` };
}
