import {computerRetryDisposition} from './computer-recovery.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';
const clone=value=>structuredClone(value);
const activeMoves=game=>(game?.moves??[]).filter(move=>!move.undone);
const id=move=>move.moveId;

/** Orders immutable server decisions. Display ownership never grants game authority. */
export function createConfirmedComputerPlayback({loadMove=async move=>move,present=async()=>{},onChange=()=>{},onMove=()=>{},onError=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let generation=0,scope=null,latest=null,known=[],queue=[],running=false,displayed=null,current=null,controller=null,error=null,announced=new Set(),retryTimer=null,retrying=false,loading=false,failures=0;
 const snapshot=()=>({playing:running||queue.length>0||Boolean(current),pending:queue.length+(current?1:0),displayed:displayed?clone(displayed):null,current:current?clone(current):null,error,retrying:retrying||loading,canRetry:!running});
 const notify=()=>onChange(snapshot());
 const cancel=()=>{generation++;if(retryTimer!==null)clearTimer(retryTimer);retryTimer=null;retrying=false;loading=false;failures=0;controller?.abort();controller=null;queue=[];current=null;running=false;error=null;};
 const baseline=(game,nextScope)=>{cancel();scope=nextScope;latest=clone(game);known=activeMoves(game).map(id);announced=new Set(known);displayed=clone(game);notify();};
 const drain=async()=>{
  if(running||retryTimer!==null||error||!queue.length)return;
  running=true;const run=generation;controller=new AbortController();const signal=controller.signal;notify();
  try{
   while(queue.length&&run===generation){
    current=queue.shift();const entry=current;loading=true;notify();
    const move=await loadMove(clone(entry.move),clone(latest??entry.game));
    if(run!==generation||signal.aborted)return;
    if(move?.moveId!==entry.move.moveId||!move.selectionSnapshot||!move.snapshot)throw Error('invalid_confirmed_playback_frame');
    loading=false;retrying=false;notify();
    const frame=clone({decisionId:move.moveId,action:move.action,before:move.selectionSnapshot,after:move.snapshot,destroyedPieces:move.destroyedPieces??[]});
    await present(frame,{signal,onDisplayed:()=>{if(run===generation&&!signal.aborted&&!announced.has(move.moveId)){announced.add(move.moveId);onMove(clone(move),clone(entry.game));}}});
    if(run!==generation||signal.aborted)return;
    const position=clone(entry.game),index=activeMoves(position).findIndex(entry=>id(entry)===move.moveId);
    position.moves=activeMoves(position).slice(0,index+1);position.board={...position.board,state:clone(move.snapshot)};
    position.currentSnapshot=clone(move.snapshot);position.liveCurrentSnapshot=clone(move.snapshot);
    position.turns=(position.turns??[]).filter(turn=>turn.index<=move.snapshot.turnIndex);
    position.currentTurn=position.turns.at(-1)??null;displayed=position;current=null;failures=0;notify();
   }
   if(run===generation){displayed=clone(latest);running=false;controller=null;notify();}
  }catch(failure){
   if(run!==generation||signal.aborted)return;controller?.abort();loading=false;running=false;controller=null;
   if(computerRetryDisposition(failure)!=='terminal'){
    retrying=true;const delay=Math.max(SYNC_TIMING.retryDelaysMs[Math.min(failures++,SYNC_TIMING.retryDelaysMs.length-1)],failure.retryAfterMs??0);
    retryTimer=setTimer(()=>{retryTimer=null;if(run!==generation)return;queue.unshift(current);current=null;void drain();},delay);
   }else{error=failure;onError(failure);}
   notify();
  }
 };
 return {
  observe(game,{scope:nextScope,visible=true,enabled=true}={}){
   if(!game)return;
   const moves=activeMoves(game),ids=moves.map(id);
   if(scope!==nextScope||!latest||!visible||!enabled){baseline(game,nextScope);return;}
   // History may prepend older summaries or trim its retained prefix. Follow
   // the prior head, while a missing/reordered active lineage retires playback.
   const previousHead=known.at(-1),headIndex=previousHead?ids.indexOf(previousHead):-1;
   const retained=new Set(ids),knownSet=new Set(known);
   if(previousHead&&(headIndex<0||JSON.stringify(known.filter(value=>retained.has(value)))!==JSON.stringify(ids.filter(value=>knownSet.has(value))))){baseline(game,nextScope);return;}
   const fresh=moves.slice(headIndex+1);known=ids;latest=clone(game);
   const computer=fresh.filter(move=>move.computerProof);
   for(const move of computer)queue.push({move:clone(move),game:clone(game)});
   if(!running&&!queue.length&&!error){displayed=clone(game);return;}
   notify();void drain();
  },
  retry(){if(running||(!error&&!retrying)||!current)return;if(retryTimer!==null)clearTimer(retryTimer);retryTimer=null;queue.unshift(current);current=null;error=null;void drain();},
  snapshot,
  reset(){cancel();scope=null;latest=null;known=[];displayed=null;notify();},
  destroy(){cancel();scope=null;latest=null;displayed=null;},
 };
}
