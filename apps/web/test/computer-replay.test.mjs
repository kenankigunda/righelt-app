import test from 'node:test';
import assert from 'node:assert/strict';
import {buildComputerTurnReplay,createComputerReplay} from '../shell/computer-replay.js';

const state = row => ({pieces:[{id:'A',position:{row,col:3}}]});
const moves = () => [
  {moveId:'push',turnIndex:2,turnMoveIndex:0,actorSide:'P1',computerProof:{},action:{type:'push'},selectionSnapshot:state(3),snapshot:state(4)},
  {moveId:'retreat',turnIndex:2,turnMoveIndex:1,actorSide:'P2',action:{type:'retreat'},selectionSnapshot:state(4),snapshot:state(5)},
  {moveId:'follow',turnIndex:2,turnMoveIndex:2,actorSide:'P1',computerProof:{},action:{type:'follow'},selectionSnapshot:state(5),snapshot:state(6)},
];
const payload = () => buildComputerTurnReplay({moves:moves(),completedTurnIndex:2,gameId:'game',revision:4,lineageHead:'follow'});

test('replay frames retain forced opposing responses and copy data without mutation',()=>{
  const records=moves(); const result=buildComputerTurnReplay({moves:records,completedTurnIndex:2});
  assert.deepEqual(result.frames.map(frame=>frame.decisionId),['push','retreat','follow']);
  records[0].snapshot.pieces[0].position.row=99;
  assert.equal(result.frames[0].after.pieces[0].position.row,4);
  assert.equal(buildComputerTurnReplay({moves:records.slice(1),completedTurnIndex:2}),null);
  assert.equal(buildComputerTurnReplay({moves:records.map(record=>({...record,undone:true})),completedTurnIndex:2}),null);
  assert.equal(buildComputerTurnReplay({moves:records,completedTurnIndex:null}),null);
});

test('replay includes authoritative finalization without adding gameplay moves',()=>{
  const finalSnapshot={pieces:[]};
  const result=buildComputerTurnReplay({moves:moves(),completedTurnIndex:2,finalSnapshot});
  assert.equal(result.frames.at(-1).action.type,'end_turn');
  assert.deepEqual(result.frames.at(-1).after,finalSnapshot);
  assert.equal(moves().length,3);
});

function fixture({manual=true,throwRender=false}={}) {
  const handlers=new Map(),events=[],renders=[],timers=new Map(); let nextTimer=0,destroyed=0;
  const doc={hidden:false,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key),defaultView:{addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key)}};
  const element=()=>({ownerDocument:doc,style:{},setAttribute(){},addEventListener(){},appendChild(child){child.parent=this;},querySelector(){return null;},remove(){this.removed=true;}});
  doc.createElement=element; const rootEl=element();
  const replay=createComputerReplay({rootEl,onChange:status=>events.push(status),onFinish:event=>events.push(event),reducedMotion:()=>manual,createPreview:({preview})=>{if(throwRender)throw Error('render failed');renders.push(preview);return {update:frame=>renders.push(frame),destroy:()=>{destroyed++;}};},setTimer:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimer:id=>timers.delete(id)});
  return {replay,doc,handlers,events,renders,timers,get destroyed(){return destroyed;},tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}

test('reduced motion advances manually and owns no gameplay interfaces',async()=>{
  const f=fixture(); const input=payload(),original=structuredClone(input);
  await f.replay.play(input);
  assert.equal(f.replay.snapshot().step,1); assert.equal(f.replay.snapshot().manual,true);
  assert.equal(f.timers.size,0);
  f.replay.next(); assert.equal(f.replay.snapshot().step,2);
  f.replay.next(); f.replay.next();
  assert.equal(f.replay.snapshot().playing,false); assert.equal(f.destroyed,1);
  assert.deepEqual(input,original);
  f.replay.destroy(); assert.equal(f.handlers.size,0);
});

test('replay replacement, live revision changes, and backgrounding cancel cleanly',async()=>{
  const f=fixture(); await f.replay.play(payload()); await f.replay.play(payload());
  assert.equal(f.destroyed,1);
  f.replay.reconcile({gameId:'game',revision:4,lineageHead:'follow'}); assert.equal(f.replay.snapshot().playing,true);
  f.replay.reconcile({gameId:'game',revision:5,lineageHead:'follow'}); assert.equal(f.replay.snapshot().playing,false);
  await f.replay.play(payload()); f.doc.hidden=true; f.handlers.get('visibilitychange')();
  assert.equal(f.replay.snapshot().playing,false); assert.equal(f.destroyed,3);
  f.replay.destroy();
});

test('automatic playback cancellation settles waits and never resumes later',async()=>{
  const f=fixture({manual:false}); const pending=f.replay.play(payload());
  assert.equal(f.timers.size,1); f.replay.stop('navigation');
  assert.equal(await pending,false); assert.equal(f.timers.size,0); assert.equal(f.destroyed,1);
  f.replay.destroy();
});

test('automatic playback completes each recorded frame then restores live presentation',async()=>{
  const f=fixture({manual:false}); const pending=f.replay.play(payload());
  for(let i=0;i<4;i++){f.tick();await Promise.resolve();}
  assert.equal(await pending,true); assert.equal(f.replay.snapshot().playing,false);
  assert.equal(f.destroyed,1); assert.equal(f.events.at(-1).reason,'completed');
  f.replay.destroy();
});

test('render failure releases playback ownership and reports error',async()=>{
  const f=fixture({throwRender:true});
  await assert.rejects(f.replay.play(payload()),/render failed/);
  assert.equal(f.replay.snapshot().playing,false); assert.equal(f.events.at(-1).reason,'error');
  f.replay.destroy();
});
