import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedFramePresenter} from '../shell/confirmed-frame-presenter.js';
import {createConfirmedComputerPlayback} from '../shell/confirmed-computer-playback.js';
import {createComputerReplay} from '../shell/computer-replay.js';
const frame={moveId:'m',computerProof:{},action:{type:'move'},selectionSnapshot:{pieces:[]},snapshot:{pieces:[]}};
test('replay error finish cannot resolve a failed confirmed frame before play rejects',async()=>{
 let tries=0;const presenter=createConfirmedFramePresenter({getRoot:()=>({}),getGameId:()=> 'g',createReplay:({onFinish})=>({destroy(){},stop(){},async play(){if(!tries++){onFinish({reason:'error'});throw Error('render_failed');}onFinish({reason:'completed'});}})});
 const queue=createConfirmedComputerPlayback({present:presenter.present});const game={id:'g',board:{state:{pieces:[]}},moves:[]};queue.observe(game,{scope:'owner'});queue.observe({...game,moves:[frame]},{scope:'owner'});await new Promise(resolve=>setImmediate(resolve));
 assert.match(queue.snapshot().error.message,/confirmed_presentation_error/);assert.equal(queue.snapshot().current.move.moveId,'m');assert.equal(queue.snapshot().displayed.moves.length,0);queue.retry();await new Promise(resolve=>setImmediate(resolve));assert.equal(queue.snapshot().error,null);assert.equal(queue.snapshot().displayed.moves[0].moveId,'m');
});

for(const reason of ['backgrounded','navigation','scope-changed','destroyed'])test(`${reason} retires automatic presentation without a user-facing playback failure`,async()=>{
 const presenter=createConfirmedFramePresenter({getRoot:()=>({}),getGameId:()=> 'g',createReplay:({onFinish})=>({destroy(){},stop(){},async play(){onFinish({reason});}})});
 const queue=createConfirmedComputerPlayback({present:presenter.present});const baseline={id:'g',board:{state:{pieces:[]}},moves:[]},accepted={...baseline,moves:[frame]};
 queue.observe(baseline,{scope:'owner'});queue.observe(accepted,{scope:'owner'});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queue.snapshot().error,null);assert.equal(queue.snapshot().playing,false);assert.equal(queue.snapshot().displayed.moves[0].moveId,'m');
});

test('confirmed empty End-turn closure publishes both stages but cues once and holds display ownership through settlement motion',async()=>{
 const timers=new Map(),stageFrames=[],animationOptions=[];let nextTimer=0,tokens=[];
 const doc={hidden:false,addEventListener(){},removeEventListener(){},defaultView:{getComputedStyle:()=>({transform:'none'}),addEventListener(){},removeEventListener(){}}};
 const element=()=>({ownerDocument:doc,style:{},children:[],classList:{add(){}},setAttribute(){},addEventListener(){},append(...items){for(const item of items)this.appendChild(item);},appendChild(child){child.parent=this;this.children.push(child);},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),querySelectorAll(){return tokens;},remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.removed=true;}});
 doc.createElement=element;doc.createElementNS=element;
 const root=element(),piece={id:'lost',position:{row:3,col:3}},before={pieces:[piece],turnIndex:4,sideToMove:'P2'},settled={pieces:[],turnIndex:5,sideToMove:'P1'};
 const createAdapter=()=>({mount(){},unmount(){},render({snapshot}){tokens=(snapshot.pieces??[]).map(entry=>({getAttribute:name=>name==='data-piece-id'?entry.id:null,classList:{contains:()=>false,add(){}},getBoundingClientRect:()=>({left:30,top:30,width:10,height:10}),cloneNode(){return {style:{},setAttribute(){},remove(){},animate(_frames,options){animationOptions.push(options);return {cancel(){},finished:Promise.resolve()};}};}}));}});
 const presenter=createConfirmedFramePresenter({getRoot:()=>root,getGameId:()=>'g',createAdapter,reducedMotion:()=>false,createReplay:options=>createComputerReplay({...options,onFrame:entry=>{stageFrames.push(entry.decisionId);options.onFrame(entry);},setTimer:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimer:id=>timers.delete(id)})});
 const cues=[],publications=[];
 const queue=createConfirmedComputerPlayback({present:presenter.present,onMove:move=>cues.push(move.moveId),onChange:snapshot=>publications.push(snapshot)});
 const move={moveId:'pass',index:0,turnIndex:4,turnMoveIndex:0,actorSide:'P2',computerProof:{attemptId:'a'},action:{type:'pass'},selectionSnapshot:before,inspectionSnapshot:structuredClone(before),snapshot:structuredClone(before)};
 const closure={moveId:'end',index:1,turnIndex:4,turnMoveIndex:1,actorSide:'P2',computerProof:{attemptId:'a'},action:{type:'end_turn'},selectionSnapshot:before,snapshot:settled,destroyedPieces:[{pieceId:'lost',position:{row:3,col:3},removalPhase:'turn_settlement'}]};
 const baseline={id:'g',gameplayRevision:0,board:{state:before},moves:[],turns:[{index:4}]},accepted={...baseline,gameplayRevision:1,board:{state:settled},moves:[move,closure],turns:[{index:4},{index:5}]};
 queue.observe(baseline,{scope:'owner'});queue.observe(accepted,{scope:'owner'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(stageFrames,['pass','pass'],'empty movement and animated settlement both publish');
 assert.deepEqual(cues,['pass'],'one acknowledged decision produces one displayed cue');
 assert.deepEqual([...timers.values()].map(timer=>timer.ms),[120]);
 assert.equal(animationOptions[0].duration,120);
 assert.equal(queue.snapshot().playing,true);assert.equal(queue.snapshot().displayed.gameplayRevision,0,'display ownership remains on the safe baseline');
 assert.equal(root.children.at(-1).style.pointerEvents,'auto','the cosmetic layer still fences obsolete-board input');
 const [timerId,timer]=timers.entries().next().value;timers.delete(timerId);timer.fn();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(queue.snapshot().playing,false);assert.equal(queue.snapshot().displayed.gameplayRevision,1);
 assert.equal(root.children.length,0,'the input-owning layer retires only after settlement');
 assert.equal(publications.some(snapshot=>snapshot.current?.frame?.decisionId==='pass'),true,'History metadata was published before completion');
 queue.destroy();presenter.destroy();
});
