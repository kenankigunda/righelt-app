import { COMPUTER_PROFILES, COMPUTER_TIMING } from '../generated/packages/shared-types/src/computer-play.js';

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
  return describeMove(move, COMPUTER_PROFILES[move?.computerProof?.profile]?.name ?? 'Computer');
}

export function describeMove(move, name) {
  if (!move) return null;
  const coordinate = point => `(${point.row}, ${point.col})`;
  const action = move.action;
  if (action?.type === 'pass') return `${name} passed`;
  const verb = {move:'moved',project:'projected',rush:'rushed',push:'pushed',retreat:'retreated',follow:'followed'}[action?.type] ?? 'moved';
  return action?.from && action?.to ? `${name} ${verb} a piece from ${coordinate(action.from)} to ${coordinate(action.to)}` : `${name} completed the turn`;
}

export const moveCoordinates = moves => moves.flatMap(move => [move.action?.from, move.action?.to]).filter(Boolean);

/** Summarize the acknowledged sequence, including defender retreat and all followers. */
export function describeTurn(moves, name) {
  const active = moves.filter(move => !move.undone && move.action?.type !== 'end_turn');
  const push = active.find(move => move.action?.type === 'push');
  if (push) {
    const point = push.action.to;
    const followers = new Set(active.filter(move => move.action?.type === 'follow').map(move => move.action.actorId ?? `${move.action.from?.row},${move.action.from?.col}`));
    const victim = point ? `(${point.row}, ${point.col})` : 'a piece';
    return `${name} pushed ${victim}${followers.size ? ` and had ${followers.size > 1 ? 'several pieces' : 'a piece'} follow` : ''}`;
  }
  const rushed = new Set(active.filter(move => move.action?.type === 'rush').map(move => move.action.actorId ?? `${move.action.from?.row},${move.action.from?.col}`));
  if (rushed.size > 1) return `${name} rushed several pieces`;
  if (rushed.size === 1) {
    const steps=active.filter(move=>move.action?.type==='rush');
    return describeMove({...steps[0],action:{...steps[0].action,to:steps.at(-1).action.to}},name);
  }
  return describeMove(active.at(-1),name);
}

export function computerPhasePresentation(game, status = {}, now = status?.observedAt ?? Date.now()) {
  const hasPending = game.pendingComputerSaveStartedAt != null;
  const pending = hasPending && !['recovery', 'other-device', 'paused'].includes(status?.phase);
  return {
    phase: status?.speculation?.phase==='computing'?'computing':pending ? 'saving' : status?.phase,
    phaseElapsedMs: pending ? Math.max(0, now - game.pendingComputerSaveStartedAt) : status?.phaseElapsedMs ?? 0,
    profile: hasPending ? game.pendingComputerProfile ?? game.computerTurn ?? status?.profile : status?.profile ?? game.computerTurn,
  };
}

export function computerBoardMessage(game, status, { selectedPieceId } = {}) {
  if (!game?.computer || game.inHistoryMode) return null;
  const phase = computerPhasePresentation(game, status);
  const name = COMPUTER_PROFILES[phase.profile]?.name ?? 'Computer';
  if(status?.activity?.needsHelp||game.confirmedPlayback?.error)return `${name} needs help`;
  if(game.confirmedPlayback?.playing)return `${name} is making their move`;
  if (game.computerTurn || game.pendingComputerSaveStartedAt != null) {
    if (status?.phase === 'recovery') return `${name} needs help`;
    if(status?.speculation?.phase==='computing')return `${name} is thinking`;
    if (status?.phase === 'other-device') return `${name} is thinking`;
    if (status?.phase === 'paused') return `${name} is paused`;
    if (game.pendingComputerSaveStartedAt != null) return `${name} is saving their move`;
    if (game.pendingComputerControl) return `Waiting for ${name}`;
    if (status?.phase === 'resuming') return `Waiting for ${name}`;
    if (game.computer.paused) return `${name} is paused`;
    if (!phase.phase || phase.phase === 'idle') return status?.activity?.showRecoveryNotice ? `${name} needs help` : `Waiting for ${name}`;
    if (['preparing','initializing-verified-runtime'].includes(status?.phase)) return `Waiting for ${name}`;
    if (phase.phaseElapsedMs >= COMPUTER_TIMING.phaseLabelAfterMs) {
      if (phase.phase === 'saving') return `${name} is saving their move`;
    }
    return `${name} is thinking`;
  }
  if (selectedPieceId) return null;
  const completed = latestComputerTurn(game);
  // Only retain narration for the immediately preceding computer turn.
  if (!completed || completed.turn.index !== (game.board?.state?.turnIndex ?? 0) - 1) return null;
  const move = [...completed.moves].reverse().find(item => item.computerProof);
  const completedName = COMPUTER_PROFILES[move?.computerProof?.profile]?.name ?? 'Computer';
  return { text: describeTurn(completed.moves,completedName), coordinates:moveCoordinates(completed.moves), action: { id: 'replay-computer', label: 'Show me again' } };
}
