import {isTerminalOutcome} from './game-lifecycle.js';
import {owningPerspective, playerDisplayName, sideColorName} from './perspective-labels.js';

// Only acknowledged card metadata establishes a result. A projected board can
// contain a provisional winning position while its command is still pending.
export function homeCardResult(card, options = {}) {
  const status = card?.confirmedOutcomeStatus;
  if (!Number.isSafeInteger(card?.eventSeq) || !Number.isSafeInteger(card?.gameplayRevision) || card.eventSeq < 0 || card.gameplayRevision < 0) return {kind:'unknown', label:'Game status unavailable', action:'View game'};
  if (status === 'ongoing') return isTerminalOutcome(card?.pendingPreviewSnapshot?.outcome?.status)
    ? {kind:'pending', label:'Confirming result…', action:'View game'} : {kind:'ongoing', action:'Open game'};
  if (!isTerminalOutcome(status)) return {kind:'unknown', label:'Game status unavailable', action:'View game'};
  if (status === 'draw') return {kind:'completed', label:'Draw', detail:'No winner', winnerSide:null, action:'Review game'};
  const winnerSide = status === 'p1_win' ? 'P1' : 'P2';
  const perspective = owningPerspective(card, options);
  const person = card?.[winnerSide === 'P1' ? 'player1' : 'player2'];
  const name = perspective.kind === 'self' || !person ? sideColorName(winnerSide) : playerDisplayName(card, winnerSide);
  const detail = perspective.kind === 'player' ? perspective.sides.includes(winnerSide) ? 'You won' : 'You lost' : null;
  return {kind:'completed', label:detail === 'You won' ? 'You won' : `${name} won`, detail:detail === 'You won' ? null : detail, winnerSide, action:'Review game'};
}
