import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';

export function latestComputerTurn(game) {
  if (!game?.computer) return null;
  const active = (game.moves ?? []).filter(move => !move.undone);
  for (const turn of [...(game.turns ?? [])].reverse()) {
    if (turn.status !== 'complete' && !(turn.index < (game.board?.state?.turnIndex ?? 0))) continue;
    const moves = active.filter(move => move.turnIndex === turn.index);
    if (moves.some(move => move.computerProof)) return { turn, moves, last: moves.at(-1) };
  }
  return null;
}

export function describeComputerMove(move) {
  if (!move) return null;
  const name = COMPUTER_PROFILES[move.computerProof?.profile]?.name ?? 'Computer';
  const coordinate = point => `(${point.row}, ${point.col})`;
  const action = move.action;
  if (action?.type === 'pass') return `${name} passed`;
  const verb = {move:'moved',project:'projected',rush:'rushed',push:'pushed',retreat:'retreated',follow:'followed'}[action?.type] ?? 'moved';
  return action?.from && action?.to ? `${name} ${verb} a piece from ${coordinate(action.from)} to ${coordinate(action.to)}` : `${name} completed the turn`;
}

export function computerBoardMessage(game, status, { selectedPieceId } = {}) {
  if (!game?.computer || game.inHistoryMode) return null;
  const name = COMPUTER_PROFILES[status?.profile ?? game.pendingComputerProfile ?? game.computerTurn]?.name ?? 'Computer';
  if (game.computerTurn || game.pendingComputerSaveStartedAt != null) {
    if (game.pendingComputerSaveStartedAt != null) return `${name} is finishing the turn`;
    if (game.computer.paused) return `${name} is paused`;
    if (status?.phase === 'recovery') return `${name} needs a hand`;
    if (status?.phase === 'other-device') return `${name} is playing on another device`;
    if (['preparing','initializing-verified-runtime'].includes(status?.phase)) return status.detailed ? `Preparing ${name} · ${Math.floor(status.elapsedMs / 1000)}s` : `Preparing ${name}`;
    return `${name} is thinking`;
  }
  if (selectedPieceId) return null;
  const completed = latestComputerTurn(game);
  // Only retain narration for the immediately preceding computer turn.
  if (!completed || completed.turn.index !== (game.board?.state?.turnIndex ?? 0) - 1) return null;
  const move = [...completed.moves].reverse().find(item => item.computerProof);
  return { text: describeComputerMove(move), action: { id: 'replay-computer', label: 'Show me again' } };
}
