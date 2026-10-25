/** Display connectivity can differ from frozen action eligibility during a sequence. */
export const SELECTED_CONTINUATION_LABELS=Object.freeze({rushBlocker:'Reconnect piece at',retreat:'Select a retreat',follow:'Select a follow'});
export const getPieceRenderStatus = piece => ({
  supplied: piece?.displaySupplied ?? piece?.supplied ?? false,
  commanded: piece?.displayCommanded ?? piece?.commanded ?? false,
});

export function getSelectedPieceCondition(piece, snapshot) {
  if (!piece) return null;
  const status = getPieceRenderStatus(piece);
  const sequence = ['rush', 'push'].includes(snapshot?.continuation?.type) ? snapshot.continuation.type : null;
  const frozen = sequence && snapshot.continuation.frozenPieceStatesById?.[piece.id];
  if (frozen && (!frozen.supplied || !frozen.commanded)) return {type: 'frozen', supplied: frozen.supplied, commanded: frozen.commanded, sequence};
  if (!status.supplied || !status.commanded) return {type: sequence ? 'at-risk' : 'inactive', ...status, sequence};
  return null;
}

export function getSelectedPieceExplanation(piece, snapshot) {
  const condition = getSelectedPieceCondition(piece, snapshot);
  if (!condition) return null;
  const missing = !condition.supplied && !condition.commanded ? 'command or supply'
    : !condition.supplied ? 'supply' : 'command';
  if (condition.type === 'frozen') return `Cannot move: no ${missing} at start of ${condition.sequence}`;
  return condition.type === 'at-risk' ? `No ${missing} connection` : `Inactive: no ${missing} connection`;
}

// Finite real presentation variants let the board reserve its final message height.
export const SELECTED_PIECE_EXPLANATIONS = Object.freeze([
  ...[false, true].flatMap(supplied => [false, true].flatMap(commanded => {
    if (supplied && commanded) return [];
    const piece = {id: 'piece', supplied, commanded};
    return [getSelectedPieceExplanation(piece, {}), ...['rush', 'push'].flatMap(type => [
      getSelectedPieceExplanation(piece, {continuation: {type}}),
      getSelectedPieceExplanation({...piece, displaySupplied: true, displayCommanded: true}, {
        continuation: {type, frozenPieceStatesById: {piece: {supplied, commanded}}},
      }),
    ])];
  })),
]);
