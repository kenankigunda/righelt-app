// Synthetic games, fake runtime and inert timers only. No network or model work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputerSession} from '../shell/computer-session.js';
import {COMPUTER_CAPABILITIES,createComputerControl,changeComputerControl} from '../generated/packages/shared-types/src/computer-play.js';
import {createInitialState} from '../generated/packages/game-engine/src/state.js';

const microtasks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture({holdAction='acquire',holdResume=false}={}){
 const games=new Map(['babs-old','tau-new'].map((id,index)=>[id,{id,gameplayRevision:index,
  computer:createComputerControl('fake-owner',index?{p1:null,p2:'tau'}:{p1:'babs',p2:null}),
  board:{state:{...createInitialState(),sideToMove:index?'P2':'P1',turnIndex:index}}}]));
 let gameId='babs-old',blocked=false,releaseOld,now=100,computations=0;const controls=[];
 const held=new Promise(resolve=>{releaseOld=resolve;});
 const transport={getIdentityId:()=> 'fake-owner',getGameViewModel:id=>({...games.get(id),pendingCommandCount:0,sharedMutationsBlocked:blocked}),
  loadGame:async id=>games.get(id),reconcileGame:async id=>{if(holdResume&&id==='babs-old')await held;},computerControl:async(id,values)=>{
   controls.push({gameId:id,...values});
   if(id==='babs-old'&&values.action===holdAction)await held;
   const game=games.get(id);game.computer=changeComputerControl(game.computer,{...values,ownerId:'fake-owner',authContextId:'fake-session',now,turnIndex:game.board.state.turnIndex});
  },decisionAttempt:async()=>{},applyGameAction:async()=>{throw Error('No gameplay submission belongs to this acquisition-only fixture');}};
 const runtime={cancel(){},compute(){computations++;throw Error('Synthetic computation failed');}};
 const session=createComputerSession({runtime,analysisRuntime:runtime,deviceId:'fake-device',clock:()=>now,
  timers:{setInterval(){return 1;},clearInterval(){}},getContext:()=>({game:games.get(gameId),transport,accountGeneration:1,authenticated:true,visible:true})});
 return {session,controls,releaseOld,computations:()=>computations,setTime(value){now=value;},enableResume(){const game=games.get(gameId);game.sharedReceipts=true;game.computerCapabilities={resumeHere:COMPUTER_CAPABILITIES.resumeHere};},switchToTau(){gameId='tau-new';},setBlocked(value){blocked=value;},game:()=>games.get(gameId)};
}
test('new game acquisition proceeds while a foreign game acquisition receipt remains unresolved',async()=>{
 const f=fixture();let oldTick,newTick;
 try{
  oldTick=f.session.tick();await microtasks();
  assert.deepEqual(f.controls.map(row=>row.gameId),['babs-old']);
  f.switchToTau();newTick=f.session.tick();await microtasks();
  assert.deepEqual(f.controls.map(row=>[row.gameId,row.action]),[['babs-old','acquire'],['tau-new','acquire']],
   'Tau must not wait for the unrelated durable Babs receipt');
  await newTick;assert.equal(f.session.snapshot().activity.activeHere,true);
  f.releaseOld();await oldTick;
  assert.equal(f.session.snapshot().activity.activeHere,true,'late old acknowledgement cannot replace Tau local authority');
  assert.equal(f.game().computer.lease.deviceId,'fake-device');
 }finally{f.releaseOld();await Promise.allSettled([oldTick,newTick]);f.session.destroy();}
});
test('genuine current-game recovery with zero pending commands still prevents acquisition',async()=>{
 const f=fixture();
 try{
  f.switchToTau();f.setBlocked(true);await f.session.tick();
  assert.deepEqual(f.controls,[]);assert.equal(f.game().computer.lease,null);
  assert.equal(f.session.snapshot().activity.showRecoveryNotice,false,'uncertain authority is not an unacquired runner failure');
  f.setBlocked(false);await f.session.tick();
  assert.deepEqual(f.controls.map(row=>[row.gameId,row.action]),[['tau-new','acquire']]);
  assert.equal(f.session.snapshot().activity.activeHere,true);
 }finally{f.releaseOld();f.session.destroy();}
});

test('a foreign renewal receipt does not block a new game acquisition',async()=>{
 const f=fixture({holdAction:'renew'});let renewal,newTick;
 try{
  await f.session.tick();f.setTime(5100);renewal=f.session.tick();await microtasks();
  assert.equal(f.controls.at(-1).action,'renew');
  f.switchToTau();newTick=f.session.tick();await microtasks();
  assert.deepEqual(f.controls.at(-1).gameId,'tau-new');assert.equal(f.controls.at(-1).action,'acquire');
  await newTick;assert.equal(f.session.snapshot().activity.activeHere,true);
  f.releaseOld();await renewal;assert.equal(f.session.snapshot().activity.activeHere,true);
 }finally{f.releaseOld();await Promise.allSettled([renewal,newTick]);f.session.destroy();}
});
test('a foreign explicit resume and its control fence cannot block a new game',async()=>{
 const f=fixture({holdResume:true});let resume,newTick;
 try{
  f.enableResume();resume=f.session.action('resume-here');await microtasks();
  assert.equal(f.session.snapshot().phase,'resuming');
  f.switchToTau();newTick=f.session.tick();await microtasks();
  assert.deepEqual(f.controls.map(row=>[row.gameId,row.action]),[['tau-new','acquire']]);
  await newTick;assert.equal(f.session.snapshot().activity.activeHere,true);
  f.releaseOld();await resume;
  assert.equal(f.session.snapshot().activity.activeHere,true);
  assert.deepEqual(f.controls.map(row=>[row.gameId,row.action]),[['tau-new','acquire']]);
 }finally{f.releaseOld();await Promise.allSettled([resume,newTick]);f.session.destroy();}
});

test('late successful old-game pause cannot clear current-game terminal recovery',async()=>{
 const f=fixture({holdAction:'pause'});let pause;
 try{
  await f.session.tick();pause=f.session.action('pause');await microtasks();
  assert.deepEqual(f.controls.map(row=>[row.gameId,row.action]),[['babs-old','acquire'],['babs-old','pause']]);
  f.switchToTau();await f.session.tick();await f.session.tick();
  assert.equal(f.computations(),1);assert.equal(f.session.snapshot().phase,'recovery');
  f.releaseOld();await pause;await f.session.tick();
  assert.equal(f.session.snapshot().phase,'recovery');
  assert.equal(f.computations(),1,'late old success must not clear the current terminal recovery key and start another computation');
 }finally{f.releaseOld();await Promise.allSettled([pause]);f.session.destroy();}
});
