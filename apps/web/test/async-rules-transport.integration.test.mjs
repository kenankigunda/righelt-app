import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTransportStore } from '../shell/live-transport.js';
import { projectOptimisticGame } from '../shell/optimistic-live.js';
import { createInitialState, resolveToStability, listLegalActions } from '../generated/packages/game-engine/src/index.js';
import { ACTION_CONTRACT_HEADER, ACTION_CONTRACT_VERSION } from '../generated/packages/shared-types/src/sync-protocol.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const heldRules = () => {
  const jobs = new Map(), calls = [];
  let signalStarted;const started=new Promise(resolve=>{signalStarted=resolve;});
  return { asynchronous: true, calls, jobs, started,
    project(scope, input) {
      return new Promise((resolve,reject) => { const job = {scope,input,resolve:()=>{jobs.delete(scope);resolve(projectOptimisticGame(input));},reject}; calls.push(job); jobs.set(scope,job);signalStarted(job); });
    },
    cancel(scope) { const job=jobs.get(scope); if(job){jobs.delete(scope);job.reject(Object.assign(Error('cancelled'),{code:'rules_cancelled'}));} },
    cancelAll() { for(const scope of [...jobs.keys()])this.cancel(scope); },
  };
};
const fixture = async (t, transformState = state => state) => {
  const rules=heldRules(), state=transformState(resolveToStability(createInitialState(),{artifactMode:'full'}));
  const game={id:'async-game',createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z',gameplayRevision:0,
    myRole:'Player 1',player1:{identityId:'owner'},player2:{identityId:'owner'},selfPlayMode:true,
    board:{state},currentSnapshot:state,legalActions:listLegalActions(state),canRecordMove:true,
    turns:[{index:0,playerSeat:'Player 1',moveIndexes:[],status:'active'}],moves:[],viewers:[]};
  const saved=[], requests=[];let defer=true,failWrites=false;
  const journal={list:async()=>saved,admit:async e=>{saved.push(e);},close(){},remove:async()=>{}};
  const storage={getItem:()=> 'owner',setItem(){}};
  const store=createLiveTransportStore({storage,commandJournal:journal,rulesExecutor:rules,shouldDeferCommandSend:()=>defer,
    fetcher:async(url,init)=>{requests.push({url,init});if(failWrites&&init.method==='POST')throw Error('lost response');return Response.json({ok:true,protocolVersion:2,game,eventSeq:1},{headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)}});}});
  t.after(()=>store.retire()); store.setRulesActiveGame(game.id); await store.loadGame(game.id);
  const move=()=>store.applyGameAction({gameId:game.id,state,action:game.legalActions.find(a=>a.type==='move')});
  const waitForJob=async()=>{const job=await rules.started;assert.equal(rules.calls.length,1);return job;};
  return {rules,game,store,saved,requests,move,waitForJob,journal,storage,allowFailedSends:()=>{defer=false;failWrites=true;}};
};
test('navigation cancels unfinished projection without admitting or sending a command',async t=>{
  const f=await fixture(t), operation=f.move(); const rejected=assert.rejects(operation,{code:'rules_cancelled'});
  await f.waitForJob(); f.store.setRulesActiveGame('another-game'); await rejected;
  assert.equal(f.saved.length,0); assert.equal(f.store.getGameViewModel(f.game.id).pendingCommandCount,0);
  assert.deepEqual(f.store.getGameViewModel(f.game.id).board.state,f.game.board.state);
});
test('authority received during asynchronous checking fences the unadmitted result',async t=>{
  const f=await fixture(t), operation=f.move(); const rejected=assert.rejects(operation,{code:'stale_state'});
  const job=await f.waitForJob();
  f.store.applyLiveGameUpdate({game:{...f.game,gameplayRevision:1},eventSeq:2}); job.resolve(); await rejected;
  assert.equal(f.saved.length,0); assert.equal(f.store.getGameViewModel(f.game.id).gameplayRevision,1);
});
test('admission reuses its complete projection and navigation preserves the original durable command',async t=>{
  const f=await fixture(t), operation=f.move(); (await f.waitForJob()).resolve();
  const result=await operation;
  assert.equal(result.accepted,true); assert.equal(f.saved.length,1); assert.equal(f.rules.calls.length,1);
  assert.equal(result.game.board.state.turnIndex,1);
  const original=structuredClone(f.saved[0]); f.store.setRulesActiveGame(null);
  assert.deepEqual(f.saved[0],original); assert.equal(f.store.getGameViewModel(f.game.id).pendingCommandCount,1);
});
test('reload restores authoritative board and reconciles journal before requesting any projection',async t=>{
  const f=await fixture(t), operation=f.move(); (await f.waitForJob()).resolve(); await operation;
  const rules=heldRules();
  const reloaded=createLiveTransportStore({storage:f.storage,commandJournal:f.journal,rulesExecutor:rules,shouldDeferCommandSend:()=>true,
    fetcher:async()=>Response.json({ok:true,protocolVersion:2,game:f.game,eventSeq:1},{headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)}})});
  t.after(()=>reloaded.retire());reloaded.setRulesActiveGame(f.game.id);await reloaded.loadGame(f.game.id);
  assert.equal(rules.calls.length,0);assert.equal(reloaded.getGameViewModel(f.game.id).pendingCommandCount,1);
  assert.deepEqual(reloaded.getGameViewModel(f.game.id).board.state,f.game.board.state);
});

test('navigation before worker creation cancels queued admission without restarting hidden work',async t=>{
  const f=await fixture(t), operation=f.move();
  const rejected=assert.rejects(operation,{code:'rules_cancelled'});
  f.store.setRulesActiveGame(null); await rejected;
  assert.equal(f.rules.calls.length,0);assert.equal(f.saved.length,0);
});
test('a second admission waiting on its predecessor cannot restart after pagehide',async t=>{
  const f=await fixture(t), first=f.move(); const firstRejected=assert.rejects(first,{code:'rules_cancelled'});
  await f.waitForJob();const second=f.move();const secondRejected=assert.rejects(second,{code:'rules_cancelled'});
  f.store.setRulesActiveGame(f.game.id,false);await Promise.all([firstRejected,secondRejected]);
  assert.equal(f.rules.calls.length,1);assert.equal(f.saved.length,0);
});

test('confirmation recovery retains an already published tentative board while reload still starts authoritative',async t=>{
  const f=await fixture(t), operation=f.move();(await f.waitForJob()).resolve();const result=await operation;
  const tentative=structuredClone(result.game.board.state);
  assert.notDeepEqual(tentative,f.game.board.state);
  f.allowFailedSends();f.store.flushPendingCommands(f.game.id);
  for(let i=0;i<100&&f.store.getGameViewModel(f.game.id).syncStatus!=='confirming';i++)await tick();
  assert.equal(f.store.getGameViewModel(f.game.id).syncStatus,'confirming');
  assert.deepEqual(f.store.getGameViewModel(f.game.id).board.state,tentative);
  assert.equal(f.store.getGameViewModel(f.game.id).pendingCommandCount,1);
  assert.equal(f.saved.length,1);assert.equal(f.rules.calls.length,1);
});

test('same-revision read-only refresh during checking preserves the action and fresh participant metadata',async t=>{
 const f=await fixture(t),operation=f.move();const job=await f.waitForJob();
 f.store.applyLiveGameUpdate({game:{...structuredClone(f.game),player1:{...f.game.player1,connected:false}},eventSeq:2});
 job.resolve();const result=await operation;
 assert.equal(result.accepted,true);assert.equal(f.saved.length,1);assert.equal(f.rules.calls.length,1);
 assert.equal(result.game.player1.connected,false);
});

for(const [label,patch] of [
 ['seat ownership',{player1:{identityId:'other'}}],
 ['viewer role',{myRole:'Viewer'}],
 ['history intent',{inHistoryMode:true,historyIndex:0}],
 ['computer control',{computer:{ownerId:'owner',generation:2,seats:{p1:'horus',p2:null},modelId:'initial-1554'}}],
])test(`same-board ${label} change still fences an unfinished action`,async t=>{
 const f=await fixture(t),operation=f.move();const rejected=assert.rejects(operation,{code:'stale_state'});
 const job=await f.waitForJob();f.store.applyLiveGameUpdate({game:{...structuredClone(f.game),...patch},eventSeq:2});job.resolve();await rejected;
 assert.equal(f.saved.length,0);
});
test('same-generation lease renewal during checking preserves the action and latest expiry',async t=>{
 const f=await fixture(t);const computer={ownerId:'owner',generation:2,seats:{p1:null,p2:'horus'},modelId:'initial-1554',manual:true,
   lease:{deviceId:'device',authContextId:'context',expiresAt:100}};
 f.store.applyLiveGameUpdate({game:{...structuredClone(f.game),computer},eventSeq:2});
 const operation=f.move(),job=await f.waitForJob();
 f.store.applyLiveGameUpdate({game:{...structuredClone(f.game),computer:{...computer,lease:{...computer.lease,expiresAt:200}}},eventSeq:3});
 job.resolve();const result=await operation;assert.equal(result.accepted,true);assert.equal(f.saved.length,1);
 assert.equal(result.game.computer.lease.expiresAt,200);
});

// Resolving this display-only difference would make the boards equivalent. The
// admission fence must compare saved snapshots without entering the rule solver.
test('authority fence does not resolve snapshots on the caller thread',async t=>{
  const f=await fixture(t,state=>{state.pieces[0].displaySupplied=!state.pieces[0].supplied;return state;});
  const operation=f.move(), rejected=assert.rejects(operation,{code:'stale_state'}), job=await f.waitForJob();
  const refreshed=structuredClone(f.game); refreshed.board.state=resolveToStability(refreshed.board.state,{artifactMode:'full'});
  assert.notDeepEqual(refreshed.board.state,f.game.board.state);
  f.store.applyLiveGameUpdate({game:refreshed,eventSeq:2});job.resolve();await rejected;assert.equal(f.saved.length,0);
});

test('reload compares nonidentical saved boards off-thread and cancels on navigation',async t=>{
  const f=await fixture(t), operation=f.move();(await f.waitForJob()).resolve();await operation;
  const rules=heldRules(), current=structuredClone(f.game);delete current.board.state.artifacts;
  let check,release,signalCheck;const checkStarted=new Promise(resolve=>{signalCheck=resolve;});const sent=[];
  rules.equivalent=(scope,input)=>new Promise((resolve,reject)=>{check={scope,input};release=resolve;rules.jobs.set(scope,{reject});signalCheck();});
  const reloaded=createLiveTransportStore({storage:f.storage,commandJournal:f.journal,rulesExecutor:rules,shouldDeferCommandSend:()=>false,
    fetcher:async(url,init)=>{if(init.method==='POST'&&!url.endsWith('/reconcile'))sent.push(url);
      return Response.json({ok:true,protocolVersion:2,gameId:current.id,eventSeq:1,gameplayRevision:0,game:current,
        commandOutcomes:url.endsWith('/reconcile')?JSON.parse(init.body).commands.map(e=>({gameId:current.id,identityId:e.identityId,clientCommandId:e.clientCommandId,fingerprint:e.fingerprint,outcome:'unknown',reason:null,eventSeq:1,gameplayRevision:0})):[]},
        {headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)}});}});
  t.after(()=>reloaded.retire());reloaded.setRulesActiveGame(current.id);await reloaded.loadGame(current.id);
  await checkStarted;assert.ok(check);assert.deepEqual(sent,[]);
  reloaded.setRulesActiveGame(null);release(true);await tick();await tick();assert.deepEqual(sent,[]);assert.equal(f.saved.length,1);
});
