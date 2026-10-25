import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncStore} from '../shell/sync-store.js';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {createInitialState,listLegalActions,applyAction,resolveToStability} from '../generated/packages/game-engine/src/index.js';
import {commandFingerprint} from '../generated/packages/shared-types/src/sync-protocol.js';
import {IDENTITY_KEY} from '../shell/persistence.js';
import {socketEnvironment} from './support/socket-environment.mjs';

const storage=()=>{const data=new Map([[IDENTITY_KEY,'id-a']]);return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};};
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
function game(){
 const state=resolveToStability(createInitialState(),{artifactMode:'full'}),turn={index:0,startedAt:'2026-10-25T00:00:00Z',playerSeat:'Player 1',status:'active',moveIndexes:[]};
 return{id:'g',createdAt:turn.startedAt,updatedAt:turn.startedAt,gameplayRevision:0,player1:{identityId:'id-a'},player2:{identityId:'id-b'},myRole:'Player 1',viewers:[],turns:[turn],moves:[],currentTurn:turn,currentSnapshot:state,board:{state},legalActions:listLegalActions(state),canRecordMove:true,canEndTurn:true};
}
const frame=(value,protocolVersion=2)=>({type:'state_sync',protocolVersion,gameId:value.id,eventSeq:1,game:value});

test('cold V1 preserves the exact saved intent and a fresh compatible client commits it once',async t=>{
 const env=socketEnvironment(t),base=game(),action=base.legalActions.find(value=>value.type==='move');assert.ok(action);
 const original={protocolVersion:2,actionContractVersion:2,gameId:'g',identityId:'id-a',clientCommandId:`v2:${crypto.randomUUID()}`,submittedAt:Date.now(),kind:'action',payload:{action,notation:'original move'},expectedState:structuredClone(base.board.state),expectedGameplayRevision:0};
 original.fingerprint=await commandFingerprint(original);
 const saved=new Map([[original.clientCommandId,structuredClone(original)]]),removed=[],admitted=[],requests=[];
 const journal={list:async()=>[...saved.values()].map(value=>structuredClone(value)),admit:async value=>{admitted.push(value);saved.set(value.clientCommandId,structuredClone(value));},remove:async value=>{removed.push(value.clientCommandId);saved.delete(value.clientCommandId);},close:async()=>{}};
 const first=env.own(createSyncStore({storage:storage(),commandJournal:journal,fetcher:async(url,init)=>{requests.push({url,init});return Response.json({ok:false,error:'not_found'},{status:404});}}));
 first.setActiveGameId('g');const cold=env.sockets[0];cold.emit('open');
 const rejected=assert.rejects(first.loadGame('g'),{code:'upgrade_required'});cold.emit('message',{data:JSON.stringify(frame(base,1))});await rejected;
 assert.equal(first.isUpgradeRequired('g'),true);assert.equal(first.getGameViewModel('g'),null);
 assert.deepEqual([...saved.values()],[original]);assert.deepEqual(removed,[]);assert.deepEqual(admitted,[]);assert.equal(requests.length,0);
 await assert.rejects(first.reconcileGame('g'),{code:'upgrade_required'});await first.flushPendingCommands('g');await flush();assert.equal(requests.length,0);
 assert.deepEqual([...saved.values()],[original]);first.retire();

 let commits=0;const applied=resolveToStability(applyAction(base.board.state,action).state,{artifactMode:'full'});
 const accepted={...base,updatedAt:'2026-10-25T00:00:01Z',gameplayRevision:1,board:{state:applied},currentSnapshot:applied,moves:[{moveId:'only-original',clientCommandId:original.clientCommandId,index:0,turnIndex:0,turnMoveIndex:0,at:'2026-10-25T00:00:01Z',actorSide:'P1',action,notation:'original move',selectionSnapshot:base.board.state,snapshot:applied}],legalActions:listLegalActions(applied)};
 const sent=[];
 const second=env.own(createSyncStore({storage:storage(),commandJournal:journal,fetcher:async(url,init)=>{
  const body=JSON.parse(init.body);const commands=body.commands??[body];sent.push(...commands.map(value=>structuredClone(value)));
  for(const value of commands)assert.deepEqual(value,original);
  const reconcile=url.endsWith('/reconcile');if(!reconcile)commits++;
  return Response.json({ok:true,protocolVersion:2,gameId:'g',eventSeq:reconcile?1:2,gameplayRevision:reconcile?0:1,game:reconcile?base:accepted,commandOutcomes:commands.map(value=>({gameId:'g',identityId:'id-a',clientCommandId:value.clientCommandId,fingerprint:value.fingerprint,outcome:reconcile?'unknown':'accepted',reason:null,eventSeq:reconcile?1:2,gameplayRevision:reconcile?0:1}))});
 }}));
 second.setActiveGameId('g');const fresh=env.sockets.at(-1);fresh.emit('open');const loaded=second.loadGame('g');fresh.emit('message',{data:JSON.stringify(frame(base))});await loaded;
 for(let i=0;i<50&&saved.size;i++){await flush();await new Promise(resolve=>setTimeout(resolve,1));}
 assert.equal(commits,1);assert.ok(sent.length>=2);assert.equal(new Set(sent.map(value=>value.clientCommandId)).size,1);
 assert.deepEqual(removed,[original.clientCommandId]);assert.deepEqual(admitted,[]);assert.equal(saved.size,0);
 const current=second.getGameViewModel('g');assert.equal(current.moves.length,1);assert.equal(current.moves[0].clientCommandId,original.clientCommandId);assert.deepEqual(current.board.state,applied);assert.equal(second.isUpgradeRequired('g'),false);
});

for(const accepted of [false,true])test(`compatibility stops queued retries while an in-flight original can ${accepted?'settle accepted':'remain uncertain'}`,async t=>{
 const base=game(),action=base.legalActions.find(value=>value.type==='move'),saved=new Map(),removed=[],sent=[];let complete;
 const store=createLiveTransportStore({storage:storage(),commandJournal:{list:async()=>[],admit:async value=>saved.set(value.clientCommandId,structuredClone(value)),remove:async value=>{removed.push(value.clientCommandId);saved.delete(value.clientCommandId);}},timing:{requestTimeoutMs:500,confirmationBudgetMs:1000,retryDelaysMs:[1],retryJitter:0},fetcher:async(_url,init)=>{
  const value=JSON.parse(init.body);sent.push(value);await new Promise(resolve=>{complete=resolve;});
  const state=resolveToStability(applyAction(base.board.state,action).state,{artifactMode:'full'});
  const confirmed={...base,gameplayRevision:1,board:{state},currentSnapshot:state,moves:[{moveId:'only-original',clientCommandId:value.clientCommandId,index:0,turnIndex:0,turnMoveIndex:0,at:'2026-10-25T00:00:01Z',actorSide:'P1',notation:'original move',action,selectionSnapshot:base.board.state,snapshot:state}]};
  return Response.json({ok:true,protocolVersion:2,gameId:'g',eventSeq:accepted?2:1,gameplayRevision:accepted?1:0,game:accepted?confirmed:base,commandOutcomes:[{gameId:'g',identityId:'id-a',clientCommandId:value.clientCommandId,fingerprint:value.fingerprint,outcome:accepted?'accepted':'unknown',reason:null,eventSeq:accepted?2:1,gameplayRevision:accepted?1:0}]});
 }});t.after(()=>store.retire());store.applyLiveGameUpdate({game:base,eventSeq:1});
 const handle=await store.applyGameAction({gameId:'g',state:base.board.state,action});await flush();assert.equal(sent.length,1);const original=structuredClone(sent[0]);
 store.markUpgradeRequired('g');store.markUpgradeRequired('g');complete();await flush();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(sent.length,1);assert.equal(store.isUpgradeRequired('g'),true);await assert.rejects(store.reconcileGame('g'),{code:'upgrade_required'});
 if(accepted){await handle.committed;assert.deepEqual(removed,[original.clientCommandId]);assert.equal(saved.size,0);}
 else{assert.deepEqual([...saved.values()],[original]);assert.deepEqual(removed,[]);assert.equal(store.getCommandOutcome('g',original.clientCommandId),null);}
});

for(const stage of ['capability discovery','unknown reconciliation'])test(`terminal compatibility during ${stage} cannot dispatch the next saved request`,{timeout:2000},async t=>{
 const base={...game(),sharedReceipts:true},shared=stage==='capability discovery';
 const original={protocolVersion:2,actionContractVersion:2,gameId:'g',identityId:'id-a',clientCommandId:`v2:${crypto.randomUUID()}`,submittedAt:Date.now(),kind:shared?'shared':'action',payload:shared?{operation:'computer-control',values:{action:'pause'}}:{action:base.legalActions.find(value=>value.type==='move')},expectedState:structuredClone(base.board.state),expectedGameplayRevision:0};
 original.fingerprint=await commandFingerprint(original);
 const saved=new Map([[original.clientCommandId,structuredClone(original)]]),requests=[];let release,started;const dispatched=new Promise(resolve=>{started=resolve;});let first=true;
 const store=createLiveTransportStore({storage:storage(),commandJournal:{list:async()=>[...saved.values()],remove:async value=>saved.delete(value.clientCommandId)},timing:{requestTimeoutMs:500,recoveryPassMs:1000,retryDelaysMs:[10],retryJitter:0},fetcher:async(url,init)=>{
  requests.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});
  if(first){first=false;started();await new Promise(resolve=>{release=resolve;});}
  if(init.method==='GET')return Response.json({ok:true,protocolVersion:2,game:base,eventSeq:1});
  return Response.json({ok:true,protocolVersion:2,gameId:'g',eventSeq:1,gameplayRevision:0,game:base,commandOutcomes:[{gameId:'g',identityId:'id-a',clientCommandId:original.clientCommandId,fingerprint:original.fingerprint,outcome:'unknown',reason:null,eventSeq:1,gameplayRevision:0}]});
 }});t.after(()=>store.retire());if(!shared)store.applyLiveGameUpdate({game:base,eventSeq:1});
 const recovery=store.reconcileGame('g');await dispatched;store.markUpgradeRequired('g');release();await recovery;await flush();await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(requests.length,1);assert.equal(requests[0].method,shared?'GET':'POST');if(!shared)assert.ok(requests[0].url.endsWith('/reconcile'));
 assert.deepEqual([...saved.values()],[original]);assert.equal(store.getCommandOutcome('g',original.clientCommandId),null);
});

test('terminal compatibility during empty journal hydration cannot start reconciliation',{timeout:2000},async t=>{
 let release,started;const hydrating=new Promise(resolve=>{started=resolve;}),requests=[];
 const store=createLiveTransportStore({storage:storage(),commandJournal:{list:async()=>{started();return new Promise(resolve=>{release=resolve;});}},fetcher:async url=>{requests.push(url);return Response.json({ok:true,protocolVersion:2,gameId:'g',eventSeq:1,gameplayRevision:0,game:game(),commandOutcomes:[]});}});t.after(()=>store.retire());
 const recovery=store.reconcileGame('g');await hydrating;store.markUpgradeRequired('g');release([]);await recovery;await flush();assert.deepEqual(requests,[]);assert.equal(store.isUpgradeRequired('g'),true);
});
