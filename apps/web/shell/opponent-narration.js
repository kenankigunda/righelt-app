import {playerDisplayName} from './perspective-labels.js';
import {computerBoardMessage, describeTurn, moveCoordinates} from './computer-narration.js';
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

// Ownership expresses the player's intended workflow, independently of recovery admission.
export function ownsBoardActor(game, identityId) {
  const actor = normalizeActivitySide(game?.controlSeat) ?? activityStateActorSide(game?.board?.state ?? game?.currentSnapshot);
  return Boolean(actor && roles(game ?? {}, identityId).has(actor) && !computerProfile(game,actor));
}

export function opponentBoardMessage(game, status, selection = {}, {canInteract = false, identityId} = {}) {
  if (!game || game.inHistoryMode || selection.selectedPieceId || selection.inspection) return null;
  if (game.computerTurn || game.pendingComputerSaveStartedAt != null) return computerBoardMessage(game, status, selection);
  if ((game.board?.state?.outcome?.status && game.board.state.outcome.status !== 'ongoing') || game.status === 'finished') return 'Game complete';
  const localTurn = canInteract || ownsBoardActor(game,identityId);
  if (canInteract && game.control === 'opponent' && !game.board?.state?.continuation) return null;
  if (localTurn && game.board?.state?.continuation) return null;
  const withPrompt = message => {
    if (!message || typeof message !== 'object' || !localTurn || game.board?.state?.continuation) return message;
    const pass = game.legalActions?.some(action => action.type === 'pass');
    return {...message, rows:[message,{text:pass?'Select a piece or':'Select a piece',actions:pass?[{id:'pass',label:'Pass'}]:[]}]};
  };
  const own = roles(game,identityId);
  const actor = normalizeActivitySide(game.controlSeat) ?? activityStateActorSide(game.board?.state);
  const completed = latestOpponentTurn(game,{identityId});
  const started = (game.moves ?? []).some(move => !move.undone && move.turnIndex === game.board?.state?.turnIndex);
  if (localTurn) {
    const computer = computerBoardMessage(game,status,selection);
    if (computer) return withPrompt(computer);
    if (!completed) return null;
    return withPrompt({text:describeTurn(completed.moves,'Your opponent'),coordinates:moveCoordinates(completed.moves),action:{id:'replay-computer',label:'Show me again'}});
  }
  if (!own.size) {
    if (completed && !started) {
      const actorName=playerDisplayName(game,completed.side);
      return {text:describeTurn(completed.moves,actorName),coordinates:moveCoordinates(completed.moves),actorName,action:{id:'replay-computer',label:'Show me again'}};
    }
    if (!actor) return 'Waiting for the game';
    const actorName=playerDisplayName(game,actor);
    return {text:`${actorName} to play`,actorName};
  }
  return actor && own.has(actor) ? null : 'Waiting for your opponent';
}
