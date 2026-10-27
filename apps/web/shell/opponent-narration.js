import {playerDisplayName} from './perspective-labels.js';
import {computerBoardMessage, describeMove} from './computer-narration.js';
import {activityStateActorSide, normalizeActivitySide} from './activity-affiliation.js';
import {getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';

const roles = (game, identityId) => new Set([
  ...(game.myRoles ?? [game.myRole]).map(normalizeActivitySide),
  identityId && game.player1?.identityId === identityId ? 'P1' : null,
  identityId && game.player2?.identityId === identityId ? 'P2' : null,
].filter(Boolean));
const computerProfile = (game, side) => game.computer?.manual ? null : game.computer?.seats?.[side === 'P1' ? 'p1' : 'p2'];

/** Read only acknowledged decisions from the immediately preceding turn. */
export function latestOpponentTurn(game, {identityId} = {}) {
  if (!game || game.inHistoryMode) return null;
  const previous = (game.board?.state?.turnIndex ?? 0) - 1;
  const turn = game.turns?.find(item => item.index === previous);
  if (!turn) return null;
  const moves = (game.moves ?? []).filter(move => !move.undone && move.turnIndex === previous);
  if (!moves.length) return null;
  const side = normalizeActivitySide(turn.playerSeat) ?? normalizeActivitySide(moves[0].selectionSnapshot && getTurnOwnerSideForState(moves[0].selectionSnapshot)) ?? normalizeActivitySide(moves[0].actorSide);
  if (!side || roles(game, identityId).has(side) && !computerProfile(game, side)) return null;
  // A forced retreat belongs to the defender, even within the attacker's turn.
  const last = [...moves].reverse().find(move => normalizeActivitySide(move.actorSide) === side);
  return last ? {turn, moves, last, side} : null;
}

export function opponentBoardMessage(game, status, selection = {}, {canInteract = false, identityId} = {}) {
  if (!game || game.inHistoryMode) return null;
  if (selection.selectedPieceId || selection.inspection) return null;
  if (game.computerTurn || game.pendingComputerSaveStartedAt != null) return computerBoardMessage(game, status, selection);
  if ((game.board?.state?.outcome?.status && game.board.state.outcome.status !== 'ongoing') || game.status === 'finished') return 'Game complete';
  if (canInteract && game.board?.state?.continuation) return null;
  const withPass = message => message && typeof message === 'object' && canInteract && !game.board?.state?.continuation && game.legalActions?.some(action => action.type === 'pass')
    ? {...message, actions:[{id:'pass',label:'Pass'}, ...(message.actions ?? (message.action ? [message.action] : []))]} : message;
  const own = roles(game, identityId);
  if (!canInteract) {
    if (game.pendingComputerControl) return 'Updating computer play';
    if (game.pendingCommandCount > 0) return 'Saving your move';
    if (game.sharedMutationsBlocked || game.recovering || game.syncStatus === 'confirming') return 'Waiting for the game';
    const actor = normalizeActivitySide(game.controlSeat) ?? activityStateActorSide(game.board?.state);
    if (!actor) return 'Waiting for the game';
    if (!own.size) {
      const completed = latestOpponentTurn(game, {identityId});
      const currentTurn = game.board?.state?.turnIndex;
      const started = (game.moves ?? []).some(move => !move.undone && move.turnIndex === currentTurn);
      if (completed && !started) {const actorName=playerDisplayName(game,completed.side);return {text:describeMove(completed.last,actorName),actorName,action:{id:'replay-computer',label:'Show me again'}};}
      const actorName=playerDisplayName(game,actor);
      return {text:`${actorName} to play`,actorName};
    }
    if (own.has(actor)) return 'Your turn';
    return 'Waiting for your opponent';
  }
  if (selection.selectedPieceId || game.control === 'opponent') return null;
  const computer = computerBoardMessage(game, status, selection);
  if (computer) return withPass(computer);
  const completed = latestOpponentTurn(game, {identityId});
  if (!completed) return null;
  return withPass({text: describeMove(completed.last, 'Your opponent'), action: {id: 'replay-computer', label: 'Show me again'}});
}
