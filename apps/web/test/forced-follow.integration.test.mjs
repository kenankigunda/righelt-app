import test from 'node:test';
import assert from 'node:assert/strict';
import { createForcedFollow } from '../shell/forced-follow.js';
import { followGame, applyFollow } from './support/forced-follow.mjs';

const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush = () => new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
  let game=followGame(options),visible=true,eligible=true,scope='account',canAct=true,view={pendingCommandCount:0},sound=0,clears=0;
  const requests=[],events=[],errors=[];let receipt,commandId;
  const owner={getIdentityId:()=> 'human',reconcileGame:async()=>{events.push('reconcile');},applyGameAction:async request=>{
    requests.push(request);commandId=requests.length===1?'follow-command':`follow-command-${requests.length}`;events.push('admit');view={...view,pendingCommandCount:1,pendingMoves:[{clientCommandId:commandId,action:request.action}]};receipt=deferred();
    return{id:commandId,committed:receipt.promise};
  }};
  let currentOwner=owner;
  const getContext=()=>({owner:currentOwner,scope,game,view,visible,eligible,canAct});
  const controller=createForcedFollow({getContext,hold:async()=>{events.push('hold');},animate:async move=>{events.push('animate');options.onAnimate?.(move);},clearVisual:()=>{clears++;},sound:()=>{sound++;events.push('sound');},onError:error=>errors.push(error),withLock:options.withLock??((_,work)=>work())});
  return{controller,owner,getContext,requests,events,errors,game:()=>game,view:()=>view,sounds:()=>sound,clears:()=>clears,
    setView:values=>{view={...view,...values};},setGame:next=>{game=next;},ack:()=>{game=applyFollow(game,requests.at(-1).action,commandId);view={...view,pendingCommandCount:0};receipt.resolve();},reject:error=>{view={...view,pendingCommandCount:0};receipt.reject(error);},
    change:kind=>{if(kind==='owner')currentOwner={...owner};if(kind==='scope')scope='other-account';if(kind==='game')game={...game,id:'other'};if(kind==='hidden')visible=false;if(kind==='history')eligible=false;if(kind==='computer')canAct=false;}};
}

test('automatic follow waits for authoritative reconciliation and durable acknowledgement before animation/sound',async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());const before=structuredClone(f.game());
  const work=f.controller.tick();await flush();assert.deepEqual(f.events,['hold','reconcile','admit']);
  for(let i=0;i<5;i++)await f.controller.tick();assert.equal(f.requests.length,1);assert.equal(f.sounds(),0);
  assert.equal(f.controller.ownsEnqueue({gameId:'g',clientCommandId:'follow-command'},f.view()),false,'admitting ends when the handle is returned');
  f.ack();await work;
  assert.deepEqual(f.events,['hold','reconcile','admit','sound','animate']);assert.equal(f.sounds(),1);assert.equal(f.controller.snapshot().working,false);
  assert.deepEqual(f.requests[0].state,before.board.state);await f.controller.tick();assert.equal(f.requests.length,1);
});

test('restored pending journals block a refreshed controller before any second admission',async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());
  f.owner.reconcileGame=async()=>{f.setView({pendingCommandCount:1,sharedMutationsBlocked:true});};
  await f.controller.tick();await f.controller.tick();assert.equal(f.requests.length,0);assert.equal(f.sounds(),0);
});

for(const reason of ['owner','scope','game','hidden','history'])test(`a preflight cannot submit after ${reason} changes`,async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());const gate=deferred();f.owner.reconcileGame=()=>gate.promise;
  const work=f.controller.tick();await flush();f.change(reason);await f.controller.tick();gate.resolve();await work;
  assert.equal(f.requests.length,0);assert.equal(f.controller.snapshot().working,false);
});

test('a turn passing to the computer after acceptance still completes the acknowledged follow animation',async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());const work=f.controller.tick();await flush();f.ack();f.change('computer');await work;
  assert.equal(f.sounds(),1);assert.ok(f.events.includes('animate'));
});

test('a hidden tab leaves its admitted command to durable recovery without replaying it',async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());const work=f.controller.tick();await flush();f.change('hidden');await f.controller.tick();await work;f.ack();await flush();
  assert.equal(f.requests.length,1);assert.equal(f.sounds(),0);assert.ok(!f.events.includes('animate'));
});

test('an admitted rejection never creates a second automatic delivery owner',async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());const work=f.controller.tick();await flush();f.reject(Error('stale_state'));await work;
  await f.controller.tick();assert.equal(f.requests.length,1);assert.equal(f.errors.length,1);
});

test('a preflight failure does not spin a controller retry loop',async t=>{
  const f=fixture();t.after(()=>f.controller.destroy());let reads=0;
  f.owner.reconcileGame=async()=>{reads++;throw Error('network');};await f.controller.tick();await flush();
  assert.equal(reads,1);assert.equal(f.requests.length,0);assert.equal(f.errors.length,1);
});

test('only active human authority may automate a mandatory follow',async t=>{
  for(const values of [{pendingCommandCount:1},{sharedMutationsBlocked:true},{inHistoryMode:true}]) {
    const f=fixture();t.after(()=>f.controller.destroy());f.setView(values);await f.controller.tick();assert.equal(f.requests.length,0);assert.deepEqual(f.events,[]);
  }
  const f=fixture();t.after(()=>f.controller.destroy());f.change('computer');await f.controller.tick();assert.deepEqual(f.events,[]);
});

test('same-origin controllers use one browser lock and recheck authority inside it',async t=>{
  let locked=false;
  const withLock=async(_,work)=>{if(locked)return;locked=true;try{return await work();}finally{locked=false;}};
  const first=fixture({withLock}),second=fixture({withLock});t.after(()=>{first.controller.destroy();second.controller.destroy();});
  second.owner.reconcileGame=async()=>{second.setGame(first.game());};
  const work=first.controller.tick();await flush();await second.controller.tick();assert.equal(second.requests.length,0);
  first.ack();await work;await second.controller.tick();assert.equal(first.requests.length,1);assert.equal(second.requests.length,0);
});


test('all mandatory single-choice follows advance only after the preceding acknowledgement and animation',async t=>{
 const f=fixture({second:true});t.after(()=>f.controller.destroy());const first=f.controller.tick();await flush();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].action.actorId,'F1');f.ack();await first;await flush();
 assert.equal(f.requests.length,2);assert.equal(f.requests[1].action.actorId,'F2');assert.equal(f.sounds(),1);
 f.ack();await flush();assert.equal(f.controller.snapshot().working,false);assert.equal(f.sounds(),2);
 assert.equal(new Set(f.game().moves.map(move=>move.clientCommandId)).size,2);
});

test('automatic enqueue ownership suppresses only its own exact follow while admission is publishing',async t=>{
 const f=fixture();t.after(()=>f.controller.destroy());const apply=f.owner.applyGameAction;
 f.owner.applyGameAction=async request=>{const handle=await apply(request);
  assert.equal(f.controller.ownsEnqueue({gameId:'g',clientCommandId:handle.id},f.view()),true);
  assert.equal(f.controller.ownsEnqueue({gameId:'different',clientCommandId:handle.id},f.view()),false);
  return handle;
 };
 const work=f.controller.tick();await flush();f.ack();await work;assert.equal(f.sounds(),1);
});
