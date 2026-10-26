import {getControlSeatForTurn,getSideForSeat,getTurnOwnerSideForState} from '../generated/packages/shared-types/src/shell-live-turn.js';

export const normalizeActivitySide = side => ['P1','p1','Player 1'].includes(side) ? 'P1' : ['P2','p2','Player 2'].includes(side) ? 'P2' : null;
export const activityStateActorSide = state => {
  const turnSide=normalizeActivitySide(state && getTurnOwnerSideForState(state));
  return turnSide ? getSideForSeat(getControlSeatForTurn(state,turnSide==='P1'?'Player 1':'Player 2')) : null;
};
// Pending intent owns its actor even when its optimistic result advances play.
// A forced retreat belongs to the defender, rather than the turn owner.
export function activityActorSide(game,{thinking=false}={}) {
  const pending=normalizeActivitySide(game?.pendingActorSide);
  if(pending)return pending;
  const move=game?.pendingMoves?.[0];
  if(move)return activityStateActorSide(move.selectionSnapshot) ?? normalizeActivitySide(move.actorSide);
  if(game?.pendingCommandCount>0 || game?.pendingComputerSaveStartedAt!=null)return null;
  if(!thinking || !game?.computerTurn)return null;
  return normalizeActivitySide(game.controlSeat) ?? activityStateActorSide(game.liveCurrentSnapshot ?? game.board?.state ?? game.currentSnapshot);
}
export function setActivityActor(element,side) {
  if(!element)return;
  const actor=normalizeActivitySide(side);
  if(actor){if(element.dataset.activitySide!==actor)element.dataset.activitySide=actor;}
  else if(element.dataset.activitySide!==undefined)delete element.dataset.activitySide;
}

// Waiting for approval belongs to the responding player, independently of turn.
export function undoApprovalActorSide(game,request) {
  const requester=request?.requesterIdentityId;
  if(!requester)return null;
  const p1=game?.player1?.identityId===requester,p2=game?.player2?.identityId===requester;
  return p1===p2 ? null : p1 ? 'P2' : 'P1';
}
