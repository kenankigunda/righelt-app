import {createEngineBoardAdapter} from '/apps/web/board-adapters/engine-board-adapter.js';
import {createBoardRuntime} from '/apps/web/board/runtime/board-runtime.js';
import {createComputerReplay,buildComputerTurnReplay} from '/apps/web/shell/computer-replay.js';
import {applyAction,validateAction,resolveToStability} from '/apps/web/generated/packages/game-engine/src/index.js';

const catalog=await (await fetch('/apps/web/scenarios/catalog.json')).json();
const source=catalog.scenarios.find(item=>item.title==='Short replay');
let state=resolveToStability(source.initialState,{artifactMode:'full'});
const records=[];
for(const [index,record]of source.moves.entries()){
  if(record.turnIndex>state.turnIndex){const ended=applyAction(state,{type:'end_turn'});state=resolveToStability(ended.state,{artifactMode:'full'});}
  const validation=validateAction(state,record.action);if(!validation.ok)throw Error(`Fixture action ${index} illegal: ${validation.code}`);
  const before=structuredClone(state),result=applyAction(state,record.action);state=resolveToStability(result.state,{artifactMode:'full'});
  records.push({...record,moveId:`record-${index}`,computerProof:record.actorSide==='P2'?{}:undefined,selectionSnapshot:before,snapshot:structuredClone(state),destroyedPieces:result.removedPieces??[]});
}
const turn=records.filter(record=>record.turnIndex===7);
const normalPayload=buildComputerTurnReplay({moves:turn,completedTurnIndex:7,gameId:'fixture',revision:1,lineageHead:'follow'});
if(!normalPayload||normalPayload.frames.map(frame=>frame.action.type).join(',')!=='push,retreat,follow')throw Error('Expected an actual push/retreat/follow recording');
const nativeAnimate=Element.prototype.animate;
let motions=[],writes=0,mounts=0,unmounts=0,sequence=0;
Element.prototype.animate=function(frames,options){
  const rect=this.getBoundingClientRect(),base=getComputedStyle(this).transform;
  const motion=nativeAnimate.call(this,frames,options);
  if(this.closest('.computer-replay')&&this.hasAttribute('data-piece-id')){
    motions.push({token:this,id:this.dataset.pieceId,frames,animation:motion,target:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},base});
  }
  return motion;
};
const makeAdapter=()=>{const adapter=createEngineBoardAdapter();const mount=adapter.mount,unmount=adapter.unmount;adapter.mount=options=>{mounts++;return mount(options);};adapter.unmount=()=>{unmounts++;return unmount();};return adapter;};
const liveSnapshot=structuredClone(normalPayload.frames.at(-1).after),original=JSON.stringify(liveSnapshot);
const runtime=createBoardRuntime({boardAdapter:makeAdapter(),host:{canSelect:()=>true,canInteract:()=>true,applyAction:async()=>{writes++;throw Error('Replay must not submit');}}});
runtime.bindElements({boardEl:document.getElementById('live-board'),overlayLinesEl:document.getElementById('live-lines')});
await runtime.loadSnapshot(liveSnapshot,{legalActions:[]});
const timers=new Map();
const controller=createComputerReplay({rootEl:document.getElementById('live-root'),createAdapter:makeAdapter,setTimer:fn=>{timers.set(++sequence,fn);return sequence;},clearTimer:id=>timers.delete(id),onChange:status=>{runtime.setInteractionBlocked(status.playing);document.getElementById('status').textContent=status.playing?`Replay ${status.step}/${status.total}`:'Live';},onFinish:({reason})=>window.lastReplayReason=reason});
let playback;
window.replayFixture={controller,runtime,timers,get payload(){return structuredClone(normalPayload);},get motions(){return motions;},get writes(){return writes;},get activeAdapters(){return mounts-unmounts;},get unchanged(){return JSON.stringify(liveSnapshot)===original;},
 start(payload=normalPayload){motions=[];playback=controller.play(payload);return controller.snapshot();},
 async advance(){const next=timers.entries().next().value;if(!next)throw Error('No pending replay step');timers.delete(next[0]);next[1]();await Promise.resolve();await Promise.resolve();return controller.snapshot();},
 async settled(){return await playback;},
 createRemovalPayload(fixture){const validation=validateAction(fixture.initialState,fixture.action);if(!validation.ok)throw Error(`Removal fixture illegal: ${validation.code}`);const result=applyAction(fixture.initialState,fixture.action);return buildComputerTurnReplay({moves:[{moveId:'removal',turnIndex:fixture.initialState.turnIndex,turnMoveIndex:0,computerProof:{},action:fixture.action,selectionSnapshot:fixture.initialState,snapshot:resolveToStability(result.state,{artifactMode:'full'})}],completedTurnIndex:fixture.initialState.turnIndex,gameId:'fixture',revision:1,lineageHead:'removal'});},
 pauseMotions(time){for(const motion of motions){motion.animation.pause();motion.animation.currentTime=time;}},
};
document.getElementById('stop').onclick=()=>controller.stop('stopped');
document.getElementById('next').onclick=()=>controller.next();
window.fixtureReady=true;
