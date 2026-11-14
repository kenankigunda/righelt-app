import {isTerminalOutcome} from './game-lifecycle.js';

const terminalKey = game => {
  const outcome=game?.board?.state?.outcome;
  if(!isTerminalOutcome(outcome?.status))return null;
  const commit=game?.terminalOutcome?.commit;
  if(commit && (Number.isSafeInteger(commit.eventSeq)||Number.isSafeInteger(commit.gameplayRevision)||commit.clientCommandId))
    return `commit:${commit.eventSeq??''}:${commit.gameplayRevision??''}:${commit.clientCommandId??''}`;
  return `legacy:${game?.gameplayRevision??''}:${outcome.status}:${outcome.reason??''}`;
};
const isCommitKey=key=>typeof key==='string'&&key.startsWith('commit:');
export const resumeAfterDialogFocusRestore=(callback,schedule=queueMicrotask)=>schedule(callback);

// Page-local result ownership. Authority creates eligibility; route, focus and
// dialog state only decide when an already-confirmed result may be presented.
export function createConfirmedResultOwner(){
  const entries=new Map();
  let historyGeneration=0;
  const entry=gameId=>entries.get(gameId)??null;
  const observe=game=>{
    if(!game?.id||!game?.board?.state?.outcome)return {changed:false,becameTerminal:false};
    const status=game.board.state.outcome.status,terminal=isTerminalOutcome(status),key=terminalKey(game),previous=entry(game.id);
    if(!previous){entries.set(game.id,{status,key,mode:'quiet',noticeDismissed:false,deliberateHistory:false});return {changed:true,becameTerminal:false};}
    if(!terminal){
      const changed=previous.status!==status||previous.key!==null||previous.mode!=='quiet';
      entries.set(game.id,{status,key:null,mode:'quiet',noticeDismissed:false,deliberateHistory:previous.deliberateHistory});
      return {changed,becameTerminal:false};
    }
    if(isTerminalOutcome(previous.status)){
      const refinish=isCommitKey(previous.key)&&isCommitKey(key)&&previous.key!==key;
      Object.assign(previous,{status,key,...(refinish?{mode:'pending',noticeDismissed:false}: {})});
      return {changed:refinish,becameTerminal:refinish};
    }
    Object.assign(previous,{status,key,mode:'pending',noticeDismissed:false});
    return {changed:true,becameTerminal:true};
  };
  const deliberateHistory=gameId=>{const current=entry(gameId),token={gameId,generation:++historyGeneration};if(!current)return token;current.deliberateHistory=true;current.historyGeneration=token.generation;if(current.mode==='pending')current.mode='manual';return token;};
  const abandonHistory=token=>{const current=entry(token?.gameId);if(!current||current.historyGeneration!==token?.generation)return false;current.deliberateHistory=false;current.historyGeneration=null;if(current.mode==='manual'){current.mode='pending';current.noticeDismissed=false;return true;}return false;};
  const live=gameId=>{const current=entry(gameId);if(current&&!isTerminalOutcome(current.status)){current.deliberateHistory=false;current.historyGeneration=null;}};
  const evaluate=(gameId,{current=false,visible=true,dialogOpen=false,inHistory=false}={})=>{
    const value=entry(gameId);
    if(!value||!isTerminalOutcome(value.status))return {present:false,allowReview:false,notice:false};
    if(value.mode==='pending'&&(value.deliberateHistory||inHistory))value.mode='manual';
    if(value.mode==='pending'&&current&&visible&&!dialogOpen){value.mode='presented';return {present:true,allowReview:false,notice:false};}
    return {present:false,allowReview:value.mode==='quiet'||value.mode==='reviewed'||value.mode==='presented',notice:value.mode==='manual'&&!value.noticeDismissed};
  };
  const present=gameId=>{const current=entry(gameId);if(current&&isTerminalOutcome(current.status)){current.mode='presented';current.noticeDismissed=true;return true;}return false;};
  const review=gameId=>{const current=entry(gameId);if(current&&isTerminalOutcome(current.status)){current.mode='reviewed';current.noticeDismissed=true;return true;}return false;};
  const dismissNotice=gameId=>{const current=entry(gameId);if(current?.mode==='manual')current.noticeDismissed=true;};
  const snapshot=gameId=>{const current=entry(gameId);return current?{...current}:null;};
  return {observe,evaluate,deliberateHistory,abandonHistory,live,present,review,dismissNotice,snapshot,clear:()=>entries.clear()};
}

export {terminalKey as confirmedResultKey};
