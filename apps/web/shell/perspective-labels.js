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
export function playerDisplayName(game,side) {
  const actor=normalizeActivitySide(side);
  if(!actor)return 'Player';
  const name=rawName(game,actor);
  const anonymous=side=>Boolean(seat(game,side))&&!computerSeat(game,side)&&!seat(game,side)?.profile?.displayName&&!seat(game,side)?.profile?.username;
  return anonymous('P1')&&anonymous('P2')?`Guest ${actor==='P1'?1:2}`:name;
}

export function perspectiveActorLabel(game,side,options={}) {
  const actor=normalizeActivitySide(side);
  if(!actor)return 'Next player';
  const own=humanControlledSides(game,options);
  return own.includes(actor)?'You':own.length?'Opponent':playerDisplayName(game,actor);
}

export const BOARD_TURN_CAPTIONS=Object.freeze(['Your turn to play','Opponent to play','Guest 1 to play','Guest 2 to play']);
export function boardTurnCaption(game,state,options={}) {
  const actor=activityStateActorSide(state);
  const label=perspectiveActorLabel(game,actor,{...options,includeManualControl:true});
  return {text:label==='You'?'Your turn to play':`${label} to play`,side:actor,...(!['You','Opponent'].includes(label)?{name:label,suffix:' to play'}:{})};
}
export const boardTurnLabel = (game,state,options={}) => boardTurnCaption(game,state,options).text;
export function liveHistoryLabel(game,state,options={}) {
  const actor=activityStateActorSide(state);
  const label=perspectiveActorLabel(game,actor,{...options,includeManualControl:true});
  return `Live · Waiting on ${label==='You'?'you':label==='Opponent'?'opponent':label} to move`;
}

// History names the computer that acted; current-turn captions stay relative.
export function historyActorLabel(game,move,options={}) {
  const side=normalizeActivitySide(move?.actorSide)??activityStateActorSide(move?.selectionSnapshot);
  if(!side)return 'Next player';
  const profile=COMPUTER_PROFILES[move?.computerProof?.profile];
  if(profile)return profile.name;
  return computerSeat(game,side)?playerDisplayName(game,side):perspectiveActorLabel(game,side,options);
}
