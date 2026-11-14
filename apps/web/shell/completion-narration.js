import {getGameResult} from './game-result.js';
import {playerDisplayName,sideColorName} from './perspective-labels.js';

const point=value=>value&&Number.isSafeInteger(value.row)&&Number.isSafeInteger(value.col);
const side=value=>value==='P1'||value==='p1'?'p1':value==='P2'||value==='p2'?'p2':null;
const other=value=>value==='p1'?'p2':value==='p2'?'p1':null;
const possessive=name=>`${name}’s`;

const commander=(game,owner,result)=>{
 const ownerSide=side(owner);
 if(!ownerSide)return null;
 if(result.controlsBothSides)return {text:`Your ${sideColorName(ownerSide)} commander`,side:ownerSide,colorNamed:true};
 if(result.side===ownerSide)return {text:'Your commander',side:ownerSide};
 return {text:`${possessive(playerDisplayName(game,ownerSide))} commander`,side:ownerSide};
};
const actor=(game,owner,result)=>{
 const ownerSide=side(owner);
 if(!ownerSide)return null;
 if(result.controlsBothSides)return {text:`You as ${sideColorName(ownerSide)}`,side:ownerSide,colorNamed:true};
 if(result.side===ownerSide)return {text:'You',side:ownerSide};
 return {text:playerDisplayName(game,ownerSide),side:ownerSide};
};
const sentenceActor=(game,owner,result)=>{
 const ownerSide=side(owner),label=actor(game,owner,result);
 if(!ownerSide||!label)return null;
 if(result.controlsBothSides)return {...label,text:`you as ${sideColorName(ownerSide)}`};
 if(result.side===ownerSide)return {...label,text:'you'};
 return label;
};
const removalOwner=record=>side(record?.ownerSeat??record?.piece?.owner);
const commanderRemoval=(record,owner)=>removalOwner(record)===owner
 && (record?.kind==='commander'||record?.piece?.kind==='commander')&&point(record?.position);

const resultParts=(result,count,complete,{terminal=true}={})=>{
 if(!result.winner){
  const text=complete?`The game ended in a draw after ${count} ${count===1?'move':'moves'}${terminal?'.':''}`:`The game ended in a draw${terminal?'.':''}`;
  return [{text}];
 }
 const text=complete?`${result.title} in ${count} ${count===1?'move':'moves'}${terminal?'.':''}`:`${result.title}${terminal?'.':''}`;
 return [{text,side:result.winner,colorNamed:result.controlsBothSides}];
};
const commanderCause=(game,record,result)=>{
 const reason=record.cause.reason;
 if(reason!==record.result.reason)return null;
 const phrase=owner=>commander(game,owner,result);
 const destroyed=owner=>{
  const label=phrase(owner),removal=record.removals.find(item=>commanderRemoval(item,owner));
  return label&&removal?[label,{text:' was destroyed'}]:null;
 };
 const unsupplied=owner=>{const label=phrase(owner);return label?[label,{text:' lost its supply'}]:null;};
 const sentence=parts=>parts?[...parts,{text:'.'}]:null;
 const compound=(first,second)=>first&&second?[...first,{text:', and '},...second,{text:'.'}]:null;
 const byReason={
  p1_commander_destroyed:()=>sentence(destroyed('p1')),p2_commander_destroyed:()=>sentence(destroyed('p2')),
  p1_commander_unsupplied:()=>sentence(unsupplied('p1')),p2_commander_unsupplied:()=>sentence(unsupplied('p2')),
  both_commanders_destroyed:()=>compound(destroyed('p1'),destroyed('p2')),
  both_commanders_unsupplied:()=>{const p1=phrase('p1'),p2=phrase('p2');return p1&&p2?[p1,{text:' and '},p2,{text:' lost their supply.'}]:null;},
  p1_commander_destroyed_p2_unsupplied:()=>compound(destroyed('p1'),unsupplied('p2')),
  p1_commander_unsupplied_p2_destroyed:()=>compound(unsupplied('p1'),destroyed('p2')),
 };
 return byReason[reason]?.()??null;
};
const incomingTurnLoser=(record,result)=>{
 const incoming=side(record.cause.incomingSide),winner=side(result.winner);
 return incoming&&winner===other(incoming)&&record.decisive.action?.type==='pass'
  &&record.decisive.decisionId===null&&side(record.decisive.actorSide)===incoming?incoming:null;
};
const provenCauseParts=(game,record,result)=>{
 const cause=record.cause;
 if(cause.kind==='incoming-turn-immobility'){
  const incoming=incomingTurnLoser(record,result);
  if(!incoming)return null;
  const label=actor(game,incoming,result);
  return label?[label,{text:' had no legal move except Pass.'}]:null;
 }
 if(cause.kind==='commander-settlement')return commanderCause(game,record,result);
 if(cause.kind!=='relevant-continuation-finality'||!Number.isSafeInteger(cause.endpointCount)
   ||cause.endpointCount<1||!Number.isSafeInteger(cause.optionalEndpointCount)||cause.optionalEndpointCount<0)return null;
 const action=record.decisive.action,winner=side(result.winner),loser=other(winner);
 if(!winner||!loser)return null;
 const label=commander(game,loser,result);
 if(!label)return null;
 if(action?.type==='push'&&point(action.to)){
  const removal=record.removals.find(item=>commanderRemoval(item,loser)
   &&item.position.row===action.to.row&&item.position.col===action.to.col);
  if(removal)return [{text:'Their push to '},{text:`(${action.to.row}, ${action.to.col})`,coordinate:true},{text:' destroyed '},label,{text:'.'}];
 }
 if(action?.type==='rush'&&record.result.reason===`${loser}_commander_unsupplied`)
  return [{text:'Their final rush sequence cut off supply to '},label,{text:'.'}];
 return null;
};
const joinedCauseParts=(game,record,result,count,complete)=>{
 if(!complete||!result.winner)return null;
 const winner=side(result.winner),loser=other(winner),cause=record.cause,action=record.decisive.action;
 if(cause.kind==='incoming-turn-immobility'&&count===0){
  const incoming=incomingTurnLoser(record,result);
  if(!incoming||incoming!==loser)return null;
  const label=sentenceActor(game,incoming,result);
  return label?[{text:' because '},label,{text:' had no legal move.'}]:null;
 }
 if(cause.kind!=='relevant-continuation-finality'||!Number.isSafeInteger(cause.endpointCount)
   ||cause.endpointCount<1||!Number.isSafeInteger(cause.optionalEndpointCount)||cause.optionalEndpointCount<0
   ||action?.type!=='retreat'||typeof record.decisive.decisionId!=='string'||!record.decisive.decisionId
   ||side(record.decisive.actorSide)!==loser)return null;
 if(result.controlsBothSides)return [{text:' after '},{text:`you retreated as ${sideColorName(loser)}`,side:loser,colorNamed:true},{text:'.'}];
 if(result.side===loser)return [{text:' after '},{text:'you retreated',side:loser},{text:'.'}];
 return [{text:' after '},{text:playerDisplayName(game,loser),side:loser},{text:' retreated.'}];
};

/** Consume only the closed, persisted terminal record. Missing or partial facts
 * remain independently absent and never fall back to visible History. */
export function completedOutcomeNarration(game,{identityId}={}){
 const record=game?.terminalOutcome,result=getGameResult(game,identityId);
 if(!record||record.version!==1||!result||record.result?.status!==game?.board?.state?.outcome?.status
  ||record.result.status!==record.board?.outcome?.status||!record.decisive||!Array.isArray(record.removals)
  ||!Number.isSafeInteger(record.decisive.turnIndex)||record.decisive.turnIndex<0
  ||(Number.isSafeInteger(game?.historyTurnIndex)&&record.decisive.turnIndex!==game.historyTurnIndex)
  ||!record.cause||typeof record.cause.kind!=='string')return null;
 const complete=record.activeActionCountComplete===true&&Number.isSafeInteger(record.activeActionCount)
  &&record.activeActionCount>=0;
 const joinedCause=joinedCauseParts(game,record,result,record.activeActionCount,complete);
 const parts=resultParts(result,record.activeActionCount,complete,{terminal:!joinedCause});
 if(joinedCause)parts.push(...joinedCause);
 else {
  const cause=provenCauseParts(game,record,result);
  if(cause)parts.push({text:' '},...cause);
 }
 return {text:parts.map(part=>part.text).join(''),parts,coordinates:point(record.decisive.action?.to)?[record.decisive.action.to]:[]};
}
