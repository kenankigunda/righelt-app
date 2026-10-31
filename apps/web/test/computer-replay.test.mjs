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

function fixture({manual=true,throwRender=false,withTokens=false,baseTransform='none',holdFinal=false,automatic=false}={}) {
  const handlers=new Map(),events=[],renders=[],timers=new Map(),motions=[],ghosts=[]; let nextTimer=0,destroyed=0,tokens=[];
  const doc={hidden:false,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key),defaultView:{getComputedStyle:()=>({transform:baseTransform}),addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key)}};
  const element=()=>({ownerDocument:doc,style:{},setAttribute(){},addEventListener(){},appendChild(child){child.parent=this;},getBoundingClientRect:()=>({left:0,top:0}),querySelector(){return null;},querySelectorAll(){return tokens;},remove(){this.removed=true;}});
  doc.createElement=element; const rootEl=element();
  const updateTokens = frame => {
    if (!withTokens) return;
    tokens=(frame.snapshot.pieces ?? []).map(piece=>({getAttribute:()=>piece.id,classList:{contains:()=>false,add(){}},getBoundingClientRect:()=>({left:piece.position.col*10,top:piece.position.row*10,width:10,height:10}),cloneNode:()=>{const ghost={style:{transform:baseTransform},setAttribute(){},remove(){},animate:()=>({cancel(){},finished:Promise.resolve()})};ghosts.push(ghost);return ghost;},animate:frames=>{motions.push({id:piece.id,frames});return {cancel(){},finished:Promise.resolve()};}}));
  };
  const replay=createComputerReplay({rootEl,holdFinal,automatic,onChange:status=>events.push(status),onFinish:event=>events.push(event),reducedMotion:()=>manual,createPreview:({preview})=>{if(throwRender)throw Error('render failed');renders.push(preview);updateTokens(preview);return {update:frame=>{renders.push(frame);updateTokens(frame);},destroy:()=>{destroyed++;}};},setTimer:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimer:id=>timers.delete(id)});
  return {replay,doc,handlers,events,renders,timers,motions,ghosts,get destroyed(){return destroyed;},tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
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


test('stacked push responses animate the moving piece by identity rather than the shared square',async()=>{
  const before={pieces:[{id:'attacker',position:{row:4,col:4}},{id:'defender',position:{row:4,col:4}}]};
  const after={pieces:[{id:'attacker',position:{row:4,col:4}},{id:'defender',position:{row:5,col:4}}]};
  const f=fixture({manual:false,withTokens:true});
  const pending=f.replay.play({gameId:'game',revision:1,lineageHead:'retreat',frames:[{decisionId:'retreat',before,after,action:{type:'retreat'}}]});
  f.tick();await Promise.resolve();
  assert.deepEqual(f.motions.map(motion=>motion.id),['defender']);
  assert.equal(f.motions[0].frames[0].transform,'translate(0px, -10px)');
  f.tick();await pending; f.replay.destroy();
});


test('replay motion preserves the target token baseline stack transform',async()=>{
  const f=fixture({manual:false,withTokens:true,baseTransform:'matrix(1, 0, 0, 1, -5, -5)'});
  const pending=f.replay.play(payload());
  f.tick();await Promise.resolve();
  assert.match(f.motions[0].frames[0].transform,/matrix\(1, 0, 0, 1, -5, -5\)$/);
  assert.equal(f.motions[0].frames[1].transform,'matrix(1, 0, 0, 1, -5, -5)');
  f.replay.stop();await pending;f.replay.destroy();
});


test('removed stack ghosts use measured geometry without applying the stack transform twice',async()=>{
  const f=fixture({manual:false,withTokens:true,baseTransform:'matrix(1, 0, 0, 1, -5, -5)'});
  const pending=f.replay.play({frames:[{before:state(3),after:{pieces:[]},action:{type:'end_turn'}}]});
  f.tick();await Promise.resolve();
  assert.equal(f.ghosts.length,1);assert.equal(f.ghosts[0].style.transform,'none');
  assert.equal(f.ghosts[0].style.left,'30px');
  f.tick();await pending;f.replay.destroy();
});


for(const manual of [false,true])test(`held automatic frames hide optimistic state until explicitly released (reduced motion=${manual})`,async()=>{
 const f=fixture({manual,holdFinal:true}),input=payload();input.frames=input.frames.slice(0,1);
 const work=f.replay.play(input);
 if(!manual){f.tick();await Promise.resolve();f.tick();}
 assert.equal(await work,true);assert.equal(f.replay.snapshot().playing,true);assert.equal(f.replay.snapshot().step,1);assert.equal(f.destroyed,0);
 f.replay.stop('acknowledged-next-frame');assert.equal(f.destroyed,1);assert.equal(f.replay.snapshot().playing,false);f.replay.destroy();
});

test('automatic confirmed playback respects reduced motion without requiring manual Next',async()=>{
 const f=fixture({manual:true,automatic:true,withTokens:true}),input=payload();const work=f.replay.play(input);
 for(let step=0;step<8&&f.replay.snapshot().playing;step++){if(f.timers.size)f.tick();await Promise.resolve();}
 await work;assert.equal(f.replay.snapshot().playing,false);assert.equal(f.motions.length,0);assert.equal(f.destroyed,1);
});
