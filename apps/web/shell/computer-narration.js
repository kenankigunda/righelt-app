import {BOARD_CONTEXT_PURPOSE} from './board-context-purpose.js';
import {normalizeActivitySide} from './activity-affiliation.js';
import {describeRecordedMove,describeRecordedTurn,recordedNarrationCoordinates,recordedActorSide} from './recorded-narration.js';
import {getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';
import { COMPUTER_PROFILES, COMPUTER_TIMING } from '../generated/packages/shared-types/src/computer-play.js';

export function latestComputerTurn(game) {
  if (!game?.computer) return null;
  const active = (game.moves ?? []).filter(move => !move.undone);
  for (const turn of [...(game.turns ?? [])].reverse()) {
    if (turn.status !== 'complete' && !(turn.index < (game.board?.state?.turnIndex ?? 0))) continue;
    const moves = active.filter(move => move.turnIndex === turn.index);
    const first=moves[0];
    const side=normalizeActivitySide(turn.playerSeat)
      ??(first?.selectionSnapshot?normalizeActivitySide(getTurnOwnerSideForState(first.selectionSnapshot)):null)
      ??recordedActorSide(moves.find(move=>move.action?.type!=='retreat'&&move.action?.type!=='end_turn'));
    const ownerMove=side&&[...moves].reverse().find(move=>recordedActorSide(move)===side&&move.computerProof);
    // A computer defender Retreat does not make its attacker's turn a computer
    // turn. Current manual control never rewrites the recorded owner either.
    if (ownerMove) return { turn, moves, last: moves.at(-1), side, ownerMove };
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
    if (phase.phase === 'saving') return `${name} is saving their move`;
    return `${name} is thinking`;
  }
  if (selectedPieceId) return null;
  const completed = latestComputerTurn(game);
  // Only retain narration for the immediately preceding computer turn.
  if (!completed || completed.turn.index !== (game.board?.state?.turnIndex ?? 0) - 1) return null;
  const move = completed.ownerMove;
  const completedName = COMPUTER_PROFILES[move?.computerProof?.profile]?.name ?? 'Computer';
  return { purpose:BOARD_CONTEXT_PURPOSE.INCOMING, actorName:completedName, actorSide:completed.side, text: describeTurn(completed.moves,completedName), coordinates:moveCoordinates(completed.moves), action: { id: 'replay-computer', label: 'Show me again' } };
}
