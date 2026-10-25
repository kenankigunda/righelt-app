import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveTransportStore } from '../shell/live-transport.js';
import { IDENTITY_KEY } from '../shell/persistence.js';
import { createInitialGame, applyServerAction, withViewModel } from '../../../packages/api-handler/src/shell-live-core.ts';
import { resolveToStability } from '../../../packages/game-engine/src/index.ts';
import { commander, makeState, unit } from '../../../packages/game-engine/test/helpers/state-builders.mjs';
import { commandFingerprint } from '../generated/packages/shared-types/src/sync-protocol.js';

const gameView=()=>{
  const game=createInitialGame({gameId:'g',identityId:'owner',selfPlayMode:true});
  game.board.state=resolveToStability(makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('L','P1',3,3),unit('A','P1',4,4),unit('B','P1',5,3),unit('E','P2',4,2)]}));
  assert.equal(applyServerAction(game,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}}).ok,true);
  return withViewModel(game,'owner');
};
const memoryStorage=()=>{const values=new Map([[IDENTITY_KEY,'owner']]);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
const journal=(initial=[])=>{let entries=initial;return {list:async()=>entries,admit:async value=>{entries.push(value)},remove:async value=>{entries=entries.filter(entry=>entry.clientCommandId!==value.clientCommandId)}}};

test('cold protocol rejection exposes recovery without accepting a snapshot or changing the journal', async t => {
  const commands = journal([{clientCommandId: 'saved'}]);
  const store = createLiveTransportStore({storage:memoryStorage(), commandJournal:commands,
    fetcher:async()=>Response.json({protocolVersion:1,game:gameView(),commandOutcomes:[]})});
  t.after(()=>store.retire());
  await assert.rejects(store.loadGame('g'), {code:'upgrade_required'});
  assert.equal(store.isUpgradeRequired('g'), true);
  assert.equal(store.getGameViewModel('g'), null);
  assert.equal(store.getAuthoritativeGame('g'), null);
  assert.deepEqual(await commands.list(), [{clientCommandId:'saved'}]);
});

for(const advertised of [null,'1']) test(`unsupported server contract ${advertised} blocks End Turn before optimistic admission`,async(t)=>{
  const game=gameView(), commands=journal();let writes=0;
  const store=createLiveTransportStore({storage:memoryStorage(),commandJournal:commands,fetcher:async(_url,init)=>{
    if(init?.method==='POST') writes++;
    return Response.json({protocolVersion:2,game,eventSeq:1},{headers:advertised?{'X-Righelt-Action-Contract':advertised}:{}});
  }});t.after(()=>store.retire());await store.loadGame('g');
  const before=structuredClone(store.getGameViewModel('g').board.state);
  await assert.rejects(store.endTurn({gameId:'g'}),{code:'upgrade_required'});
  assert.equal(writes,0);assert.equal((await commands.list()).length,0);
  assert.equal(store.getGameViewModel('g').upgradeRequired,true);
  assert.deepEqual(store.getGameViewModel('g').board.state,before);
});

test('socket-first contract advertisement permits semantic End Turn without an HTTP preload',async(t)=>{
  const game=gameView(), commands=journal();let sent=0;
  const store=createLiveTransportStore({storage:memoryStorage(),commandJournal:commands,fetcher:async()=>{sent++;return new Promise(()=>{})}});t.after(()=>store.retire());
  store.applyLiveGameUpdate({game,eventSeq:1,baseline:true,actionContractVersion:2});
  await store.endTurn({gameId:'g'});
  assert.equal(store.getGameViewModel('g').board.state.continuation,null);
  assert.equal(store.getGameViewModel('g').pendingMoves.length,0);
  const [envelope]=await commands.list();assert.equal(envelope.actionContractVersion,2);
  assert.equal(sent,1);
});

test('obsolete durable intent is rejected and cleared without a write or automatic reload loop',async(t)=>{
  const game=gameView(), command={protocolVersion:2,gameId:'g',identityId:'owner',clientCommandId:'v2:old-pass',kind:'action',payload:{action:{type:'pass'}},expectedState:game.board.state,expectedGameplayRevision:0};
  command.fingerprint=await commandFingerprint(command);
  const commands=journal([command]);let applies=0,reconciles=0;
  const store=createLiveTransportStore({storage:memoryStorage(),commandJournal:commands,fetcher:async(url)=>{
    if(url.endsWith('/apply')) applies++;
    if(url.endsWith('/reconcile')) {
      reconciles++;
      return Response.json({protocolVersion:2,gameId:'g',eventSeq:2,gameplayRevision:0,game,commandOutcomes:[{gameId:'g',identityId:'owner',clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:'rejected',reason:'upgrade_required',eventSeq:2,gameplayRevision:0}]},{headers:{'X-Righelt-Action-Contract':'2'}});
    }
    return Response.json({protocolVersion:2,game,eventSeq:1},{headers:{'X-Righelt-Action-Contract':'2'}});
  }});t.after(()=>store.retire());await store.loadGame('g');
  for(let i=0;i<30&&!store.getGameViewModel('g').upgradeRequired;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.getGameViewModel('g').upgradeRequired,true);
  assert.equal(store.getGameViewModel('g').pendingCommandCount,0);
  assert.equal((await commands.list()).length,0);assert.equal(applies,0);assert.equal(reconciles,1);
  assert.deepEqual(store.getGameViewModel('g').board.state,game.board.state);
});
