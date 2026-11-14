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
const removalOwner=record=>side(record?.ownerSeat??record?.piece?.owner);
const commanderRemoval=(record,owner)=>removalOwner(record)===owner
 && (record?.kind==='commander'||record?.piece?.kind==='commander')&&point(record?.position);

const resultParts=(result,count,complete)=>{
 if(!result.winner){
  const text=complete?`The game ended in a draw after ${count} ${count===1?'move':'moves'}.`:'The game ended in a draw.';
  return [{text}];
 }
 const text=complete?`${result.title} in ${count} ${count===1?'move':'moves'}.`:`${result.title}.`;
 return [{text,side:result.winner,colorNamed:result.controlsBothSides}];
};
const commanderCause=(game,record,result)=>{
 const reason=record.cause.reason;
 if(reason!==record.result.reason)return null;
 const phrase=owner=>commander(game,owner,result);
 const destroyed=owner=>{
  const label=phrase(owner),removal=record.removals.find(item=>commanderRemoval(item,owner));
  return label&&removal?[label,{text:' was destroyed.'}]:null;
 };
 const unsupplied=owner=>{const label=phrase(owner);return label?[label,{text:' lost its supply.'}]:null;};
 const byReason={
  p1_commander_destroyed:()=>destroyed('p1'),p2_commander_destroyed:()=>destroyed('p2'),
  p1_commander_unsupplied:()=>unsupplied('p1'),p2_commander_unsupplied:()=>unsupplied('p2'),
  both_commanders_destroyed:()=>{const p1=destroyed('p1'),p2=destroyed('p2');return p1&&p2?[...p1.slice(0,-1),{text:' and '},...p2]:null;},
  both_commanders_unsupplied:()=>{const p1=phrase('p1'),p2=phrase('p2');return p1&&p2?[p1,{text:' and '},p2,{text:' lost their supply.'}]:null;},
  p1_commander_destroyed_p2_unsupplied:()=>{const p1=destroyed('p1'),p2=unsupplied('p2');return p1&&p2?[...p1.slice(0,-1),{text:' and '},...p2]:null;},
  p1_commander_unsupplied_p2_destroyed:()=>{const p1=unsupplied('p1'),p2=destroyed('p2');return p1&&p2?[...p1.slice(0,-1),{text:' and '},...p2]:null;},
 };
 return byReason[reason]?.()??null;
};
const provenCauseParts=(game,record,result)=>{
 const cause=record.cause;
 if(cause.kind==='incoming-turn-immobility'){
  const incoming=side(cause.incomingSide),winner=side(result.winner);
  if(!incoming||winner!==other(incoming))return null;
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
  if(removal)return [{text:'Their push to '},{text:`(${action.to.row}, ${action.to.col})`},{text:' destroyed '},label,{text:'.'}];
 }
 if(action?.type==='rush'&&record.result.reason===`${loser}_commander_unsupplied`)
  return [{text:'Their final rush sequence cut off supply to '},label,{text:'.'}];
 return null;
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
 const parts=resultParts(result,record.activeActionCount,complete);
 const cause=provenCauseParts(game,record,result);
 if(cause)parts.push({text:' '},...cause);
 return {text:parts.map(part=>part.text).join(''),parts,coordinates:point(record.decisive.action?.to)?[record.decisive.action.to]:[]};
}
