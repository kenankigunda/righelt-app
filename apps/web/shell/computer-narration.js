import {describeRecordedMove,describeRecordedTurn,recordedNarrationCoordinates} from './recorded-narration.js';
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

export const describeMove = describeRecordedMove;
export const describeTurn = describeRecordedTurn;
export const moveCoordinates = recordedNarrationCoordinates;

export function computerPhasePresentation(game, status = {}, now = status?.observedAt ?? Date.now()) {
  const hasPending = game.pendingComputerSaveStartedAt != null;
  const pending = hasPending && !['recovery', 'other-device', 'paused'].includes(status?.phase);
  return {
    phase: pending ? 'saving' : status?.phase,
    phaseElapsedMs: pending ? Math.max(0, now - game.pendingComputerSaveStartedAt) : status?.phaseElapsedMs ?? 0,
    profile: hasPending ? game.pendingComputerProfile ?? game.computerTurn ?? status?.profile : status?.profile ?? game.computerTurn,
  };
}

export function computerBoardMessage(game, status, { selectedPieceId } = {}) {
  if (!game?.computer || game.inHistoryMode) return null;
  const phase = computerPhasePresentation(game, status);
  const name = COMPUTER_PROFILES[phase.profile]?.name ?? 'Computer';
  if (game.computerTurn || game.pendingComputerSaveStartedAt != null) {
    if (status?.phase === 'recovery') return `${name} needs a hand`;
    if (status?.phase === 'other-device') return `${name} is thinking`;
    if (status?.phase === 'paused') return `${name} is paused`;
    if (game.pendingComputerSaveStartedAt != null) return phase.phaseElapsedMs >= COMPUTER_TIMING.phaseLabelAfterMs ? `${name} is saving their move` : `${name} is thinking`;
    if (game.pendingComputerControl) return `Waiting for ${name}`;
    if (status?.phase === 'resuming') return `Waiting for ${name}`;
    if (game.computer.paused) return `${name} is paused`;
    if (!phase.phase || phase.phase === 'idle') return status?.activity?.showRecoveryNotice ? `${name} needs a hand` : `Waiting for ${name}`;
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
