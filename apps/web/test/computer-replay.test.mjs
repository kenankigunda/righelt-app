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
  assert.equal(result.frames.at(-1).action.type,'follow');
  assert.equal(result.frames.length,3);
  assert.equal(result.frames.some(frame=>frame.action.type==='end_turn'),false);
  assert.deepEqual(result.frames.at(-1).recordedMove.snapshot,finalSnapshot);
  assert.deepEqual(result.frames.at(-1).after,finalSnapshot);
  assert.equal(moves().length,3);
});

test('replay separates causal move narration from the later authoritative removal boundary',()=>{
 const records=moves(),pending=state(6),settled={pieces:[]};
 records[0].destroyedPieces=[];
 records[2].inspectionSnapshot=pending;records[2].snapshot=settled;
 records[2].destroyedPieces=[{pieceId:'A',position:{row:6,col:3},reason:'loss_of_supply',removalPhase:'turn_settlement',causalMoveId:'push'}];
 const result=buildComputerTurnReplay({moves:records,completedTurnIndex:2});
 assert.deepEqual(result.frames[0].recordedMove.destroyedPieces,records[2].destroyedPieces);
 assert.deepEqual(result.frames[2].after,pending);
 assert.deepEqual(result.frames[2].settledAfter,settled);
 assert.deepEqual(result.frames[2].destroyedPieces,[]);
 assert.deepEqual(result.frames[2].settlementDestroyedPieces,records[2].destroyedPieces);
});

function fixture({manual=true,throwRender=false,withTokens=false,baseTransform='none',holdFinal=false,automatic=false,blocksInput=true}={}) {
  const handlers=new Map(),events=[],renders=[],timers=new Map(),motions=[],ghosts=[],displayed=[]; let nextTimer=0,destroyed=0,tokens=[];
  const doc={hidden:false,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key),defaultView:{getComputedStyle:()=>({transform:baseTransform}),addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key)}};
  const element=()=>({ownerDocument:doc,style:{},children:[],setAttribute(){},addEventListener(){},appendChild(child){child.parent=this;this.children.push(child);},getBoundingClientRect:()=>({left:0,top:0}),querySelector(){return null;},querySelectorAll(){return tokens;},remove(){this.removed=true;}});
  doc.createElement=element; const rootEl=element();
  const updateTokens = frame => {
    if (!withTokens) return;
    tokens=(frame.snapshot.pieces ?? []).map(piece=>({getAttribute:()=>piece.id,classList:{contains:()=>false,add(){}},getBoundingClientRect:()=>({left:piece.position.col*10,top:piece.position.row*10,width:10,height:10}),cloneNode:()=>{const ghost={style:{transform:baseTransform},setAttribute(){},remove(){},animate:()=>({cancel(){},finished:Promise.resolve()})};ghosts.push(ghost);return ghost;},animate:frames=>{motions.push({id:piece.id,frames});return {cancel(){},finished:Promise.resolve()};}}));
  };
  const replay=createComputerReplay({rootEl,holdFinal,automatic,blocksInput,onChange:status=>events.push(status),onFinish:event=>events.push(event),onFrame:frame=>displayed.push(frame),reducedMotion:()=>manual,createPreview:({preview})=>{if(throwRender)throw Error('render failed');renders.push(preview);updateTokens(preview);return {update:frame=>{renders.push(frame);updateTokens(frame);},destroy:()=>{destroyed++;}};},setTimer:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimer:id=>timers.delete(id)});
  return {replay,rootEl,doc,handlers,events,renders,timers,motions,ghosts,displayed,get destroyed(){return destroyed;},tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}};
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
  assert.equal(f.rootEl.children.at(-1).style.pointerEvents,'auto','requested replay retains input ownership');
  assert.equal(f.timers.size,1); f.replay.stop('navigation');
  assert.equal(await pending,false); assert.equal(f.timers.size,0); assert.equal(f.destroyed,1);
  f.replay.destroy();
});

test('nonblocking presentation cannot intercept input through its cosmetic layer',async()=>{
 const f=fixture({manual:false,automatic:true,blocksInput:false}),pending=f.replay.play(payload());
 assert.equal(f.rootEl.children.at(-1).style.pointerEvents,'none');
 f.replay.stop('settled');assert.equal(await pending,false);f.replay.destroy();
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
 await work;assert.equal(f.replay.snapshot().playing,false);assert.equal(f.motions.length,0);assert.equal(f.timers.size,0,'reduced automatic playback owns no pause or motion timer');assert.equal(f.destroyed,1);
});

test('automatic live playback shows its first confirmed frame without a lead wait and owns only meaningful motion time',async()=>{
 const f=fixture({manual:false,automatic:true,withTokens:true}),input=payload();input.frames=input.frames.slice(0,1);
 const work=f.replay.play(input);await Promise.resolve();
 assert.equal(f.replay.snapshot().step,1,'the confirmed frame is visible immediately');
 assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[120],'there is no separate lead or trailing hold');
 f.tick();await work;
 assert.equal(f.replay.snapshot().playing,false);assert.equal(f.timers.size,0);
});

test('automatic live playback renders and publishes a no-motion action without owning a timer',async()=>{
 const f=fixture({manual:false,automatic:true,withTokens:true}),still=state(3);
 const frame={decisionId:'pass',before:still,after:structuredClone(still),action:{type:'pass'},recordedMove:{moveId:'pass'}};
 await f.replay.play({gameId:'game',frames:[frame]});
 assert.equal(f.timers.size,0);
 assert.deepEqual(f.displayed.map(item=>item.decisionId),['pass'],'the cue/history publication callback still runs');
 assert.equal(f.renders.some(item=>item.previewKey?.endsWith(':after')),true,'the acknowledged frame still renders');
 assert.equal(f.events.at(-1).reason,'completed');
});

test('automatic live playback skips only an empty movement wait before animated settlement',async()=>{
 const f=fixture({manual:false,automatic:true,withTokens:true}),still=state(3);
 const work=f.replay.play({gameId:'game',frames:[{decisionId:'end',before:still,after:structuredClone(still),settledAfter:{pieces:[]},action:{type:'end_turn'}}]});
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[120],'only the removal animation owns time');
 assert.equal(f.displayed.length,2,'both acknowledged movement and settlement stages publish');
 assert.equal(f.ghosts.length,1,'settlement removal is still animated');
 f.tick();await work;
});

test('automatic live playback preserves movement before settlement and times each visible stage',async()=>{
 const f=fixture({manual:false,automatic:true,withTokens:true});
 const work=f.replay.play({gameId:'game',frames:[{decisionId:'move-and-remove',before:state(3),after:state(4),settledAfter:{pieces:[]},action:{type:'move'}}]});
 await Promise.resolve();
 assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[120]);
 assert.equal(f.ghosts.length,0,'settlement has not started during movement');
 f.tick();await Promise.resolve();
 assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[120]);
 assert.equal(f.ghosts.length,1,'settlement starts only after movement completes');
 assert.equal(f.displayed.length,2);
 f.tick();await work;
});

test('requested replay keeps its deliberate lead and between-frame pacing',async()=>{
 const f=fixture({manual:false}),work=f.replay.play(payload());
 assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[360]);
 f.tick();await Promise.resolve();
 assert.deepEqual([...f.timers.values()].map(timer=>timer.ms),[880]);
 f.replay.stop();await work;
});
