import { normalizeActivitySide } from './activity-affiliation.js';

const isHumanSide = (game, side, turn, identityId) => {
  if (!side) return false;
  const seat = side === 'P1' ? 'player1' : 'player2';
  const owns = identityId ? game[seat]?.identityId === identityId : (game.myRoles ?? [game.myRole]).includes(side === 'P1' ? 'Player 1' : 'Player 2');
  const computer = game.computer;
  return owns && !(computer && !computer.manual && computer.takeoverTurn !== turn && computer.seats?.[side === 'P1' ? 'p1' : 'p2']);
};

export function latestLocalPushSequence(game, identityId) {
  const moves = (game?.moves ?? []).filter(move => !move.undone);
  for (let start = moves.length - 1; start >= 0; start--) {
    const push = moves[start];
    if (push.action?.type !== 'push' || !isHumanSide(game, normalizeActivitySide(push.actorSide), push.turnIndex, identityId)) continue;
    const sequence = [push];
    for (const move of moves.slice(start + 1)) {
      if (move.turnIndex !== push.turnIndex || !['retreat', 'follow'].includes(move.action?.type)) break;
      sequence.push(move);
    }
    if (!push.moveId || !sequence.at(-1)?.moveId || sequence.at(-1)?.action.type !== 'follow') return null;
    if (moves.slice(start + sequence.length).some(move => isHumanSide(game, normalizeActivitySide(move.actorSide), move.turnIndex, identityId))) return null;
    return { startId: push.moveId, endId: sequence.at(-1).moveId, moves: sequence };
  }
  return null;
}

export function buildPushSequenceReplay({ moves, startId, endId, gameId, revision, lineageHead }) {
  const active = (moves ?? []).filter(move => !move.undone);
  const start = active.findIndex(move => move.moveId === startId), end = active.findIndex(move => move.moveId === endId);
  if (start < 0 || end <= start) return null;
  const sequence = active.slice(start, end + 1), push = sequence[0];
  if (push.action?.type !== 'push' || sequence.at(-1).action?.type !== 'follow'
    || sequence.slice(1).some((move, index) => !['retreat', 'follow'].includes(move.action?.type) || move.action.type === 'retreat' && index !== 0 || move.turnIndex !== push.turnIndex)
    || sequence.some((move, index) => !move.moveId || !move.selectionSnapshot || !move.snapshot || move.turnMoveIndex !== push.turnMoveIndex + index)) return null;
  return structuredClone({ gameId, revision, lineageHead, frames: sequence.map(move => ({ decisionId: move.moveId, action: move.action, before: move.selectionSnapshot, after: move.snapshot, destroyedPieces: move.destroyedPieces ?? [] })) });
}

export function withPushSequenceMessage(message, game, selection, identityId) {
  if (!game || game.inHistoryMode || selection.selectedPieceId || selection.inspection || message?.action?.id === 'replay-computer') return message;
  if (!latestLocalPushSequence(game, identityId)) return message;
  const sequence = { text: 'Push sequence', action: { id: 'replay-push-sequence', label: 'Show me again' } };
  const pass = game.legalActions?.some(action => action.type === 'pass');
  const end = game.legalActions?.some(action => action.type === 'end_turn');
  const prompt = message ? typeof message === 'string' ? { text: message } : message : {
    text: game.board?.state?.continuation ? end ? 'Select a move or' : 'Select a move' : pass ? 'Select a piece or' : 'Select a piece',
    actions: end ? [{ id: 'end-turn', label: 'End turn' }] : pass ? [{ id: 'pass', label: 'Pass' }] : [],
  };
  return { ...sequence, rows: [sequence, prompt] };
}
