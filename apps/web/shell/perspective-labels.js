import {isCompletedGame} from './game-lifecycle.js';
import {recordedActorSide} from './recorded-narration.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {activityStateActorSide,normalizeActivitySide} from './activity-affiliation.js';

const seat = (game,side) => game?.[side==='P1'?'player1':'player2'];
const computerSeat = (game,side) => Boolean(seat(game,side)?.computerProfile || game?.computer?.seats?.[side==='P1'?'p1':'p2']);

/** Display ownership requires both an explicit role and the captured identity. */
export function humanControlledSides(game,{identityId,includeManualControl=false}={}) {
  if(!game || !identityId)return [];
  const roles=new Set([...(game.myRoles??[]),game.myRole].map(normalizeActivitySide).filter(Boolean));
  const matches=side=>seat(game,side)?.identityId===identityId;
  const bothRole=game.myRole==='Both Players'||game.myRoles?.includes('Both Players');
  const ownsBoth=matches('P1')&&matches('P2');
  const declared=['P1','P2'].filter(side=>(roles.has(side)||bothRole)&&matches(side));
  const bothHumans=!computerSeat(game,'P1')&&!computerSeat(game,'P2');
  if(game.selfPlayMode && bothHumans && ownsBoth && (declared.length||bothRole))return ['P1','P2'];
  // A takeover is temporary control, not a change to the seats' identities.
  if(includeManualControl && game.computer?.manual && game.canControlComputer && (declared.length||bothRole&&ownsBoth))return ['P1','P2'].filter(matches);
  const computerSides=['P1','P2'].filter(side=>computerSeat(game,side));
  if(computerSides.length===1 && declared.length){
    const humanSide=computerSides[0]==='P1'?'P2':'P1';
    return matches(humanSide)?[humanSide]:[];
  }
  const human=declared.filter(side=>!computerSeat(game,side));
  if(human.length===2 && !game.selfPlayMode){
    const primary=normalizeActivitySide(game.myRole);
    return human.includes(primary)?[primary]:[];
  }
  return human;
}

export function owningPerspective(game,options={}) {
  const sides=humanControlledSides(game,options);
  return {kind:sides.length===2?'self':sides.length?'player':'viewer',sides};
}

export const sideColorName = side => ['P1','p1','Player 1','red'].includes(side)?'Red':['P2','p2','Player 2','blue'].includes(side)?'Blue':'Player';
const rawName = (game,side) => {
  const person=seat(game,side),profile=person?.computerProfile??game?.computer?.seats?.[side==='P1'?'p1':'p2'];
  return COMPUTER_PROFILES[profile]?.name || person?.profile?.displayName || person?.profile?.username || 'Guest';
};
export const hasAnonymousPlayers = game => ['P1','P2'].every(side=>Boolean(seat(game,side))&&!computerSeat(game,side)&&!seat(game,side)?.profile?.displayName&&!seat(game,side)?.profile?.username);
export function playerDisplayName(game,side) {
  const actor=normalizeActivitySide(side);
  if(!actor)return 'Player';
  const name=rawName(game,actor);
  return hasAnonymousPlayers(game)?`Guest ${actor==='P1'?1:2}`:name;
}

/** Canonical visible identity; nonvisual color and ownership never depend on text color. */
export function playerIdentityLabel(game,side,options={}) {
  const actor=normalizeActivitySide(side);
  if(!actor)return {text:'Player',side:null,color:null,accessibleName:'Player'};
  const ownedSides=humanControlledSides(game,options),owned=ownedSides.includes(actor),color=sideColorName(actor);
  let text=playerDisplayName(game,actor);
  if(options.viewerRelative){
    if(owned)text='You';
    else if(/^Guest [12]$/.test(text)){
      const unnamedOthers=['P1','P2'].filter(candidate=>seat(game,candidate)&&!ownedSides.includes(candidate)&&!computerSeat(game,candidate)&&rawName(game,candidate)==='Guest');
      if(unnamedOthers.length===1)text='Guest';
    }
  }
  return {text,side:actor,color,accessibleName:options.viewerRelative&&owned?`You, ${color}`:`${text}${owned?', you':''}, ${color}`};
}

export function perspectiveActorLabel(game,side,options={}) {
  const actor=normalizeActivitySide(side);
  if(!actor)return 'Next player';
  const own=humanControlledSides(game,options);
  return own.includes(actor)?'You':own.length?'Opponent':playerDisplayName(game,actor);
}

export const BOARD_TURN_CAPTIONS=Object.freeze(['Your turn to play','Opponent to play','Guest 1 to play','Guest 2 to play','Game complete']);
export function boardTurnCaption(game,state,options={}) {
  const actor=activityStateActorSide(state);
  if(isCompletedGame(game))return {text:'Game complete',side:actor};
  const label=perspectiveActorLabel(game,actor,{...options,includeManualControl:true});
  return {text:label==='You'?'Your turn to play':`${label} to play`,side:actor,...(!['You','Opponent'].includes(label)?{name:label,suffix:' to play'}:{})};
}
export const boardTurnLabel = (game,state,options={}) => boardTurnCaption(game,state,options).text;
export function liveHistoryLabel(game,state,options={}) {
  if(isCompletedGame(game))return 'Game complete';
  const actor=activityStateActorSide(state);
  const label=perspectiveActorLabel(game,actor,{...options,includeManualControl:true});
  return `Live · Waiting on ${label==='You'?'you':label==='Opponent'?'opponent':label} to move`;
}

// Recorded perspective follows saved human ownership, never temporary control or the live turn.
export function recordedActorIdentity(game,move,options={}) {
  const side=recordedActorSide(move);
  if(!side)return {text:'Next player',side:null,owned:false,self:false};
  const perspective=owningPerspective(game,options);
  const owned=!move?.computerProof && perspective.sides.includes(side);
  const self=owned && perspective.kind==='self';
  const text=move?.computerProof
    ? COMPUTER_PROFILES[move.computerProof.profile]?.name ?? playerDisplayName(game,side)
    : owned ? self ? `You (${sideColorName(side)})` : 'You' : playerDisplayName(game,side);
  return {text,side,owned,self};
}
export const historyActorLabel = (game,move,options={}) => recordedActorIdentity(game,move,options).text;

/** Read-only replay attribution uses the pinned actor, not the currently active seat. */
export function recordedReplayLabel(game,move,options={}) {
  const actor=recordedActorIdentity(game,move,options);
  if(actor.owned)return actor.self ? `Playing your recorded ${sideColorName(actor.side)} move` : 'Playing your recorded move';
  return actor.side ? `Playing ${actor.text}’s recorded move` : 'Playing recorded move';
}

/** Ownership is supplied by the saved-seat model. Text comparison only detects
 * a visible alias collision, never grants ownership or rewrites a real name. */
export function viewerAliasQualifiers(labels=[]) {
  const owned=labels.filter(label=>label.owned);
  if(owned.length!==1)return {};
  const collision=labels.find(label=>!label.owned && label.name==='You');
  if(!collision)return {};
  const username=typeof collision.username==='string' && collision.username.trim() ? collision.username : null;
  return username ? {[collision.side]:`@${username}`} : {
    [owned[0].side]:sideColorName(owned[0].side),[collision.side]:sideColorName(collision.side),
  };
}
