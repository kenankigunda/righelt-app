import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {IDBFactory} from 'fake-indexeddb';
import {createSyncStore} from '../shell/sync-store.js';
import {validSyncSnapshot} from '../shell/live-transport.js';
import {createRouteHydration} from '../shell/route-hydration.js';
import {createCommandJournal} from '../shell/command-journal.js';
import {isSyncRevision} from '../generated/packages/shared-types/src/sync-protocol.js';
import apiWorker from '../../api/index.js';
import {createFakeD1} from '../../../packages/api-handler/test/support/fake-d1.mjs';
import {createFakeGameRooms} from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';
import {socketEnvironment} from './support/socket-environment.mjs';

const source=readFileSync(new URL('../shell/live-transport.js',import.meta.url),'utf8');
const a=source.indexOf('  const loadGame = async '),b=source.indexOf('  const decisionRequest =',a);
assert(a>=0&&b>a);
const loaderSource=source.slice(a,b);
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const until=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Initial-load fixture did not reach its required boundary');};
async function server(){
 const env={DB:createFakeD1()};env.GAME_ROOMS=createFakeGameRooms(()=>env);
 const request=(url,init={})=>apiWorker.fetch(new Request('https://test'+url,init),env);
 const response=await request('/api/shell/games',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identityId:'id-main-owner',selfPlayMode:false})});
 assert(response.ok);const body=await response.json();assert(validSyncSnapshot(body.game,body.game.id));
 return{request,game:body.game,eventSeq:body.eventSeq};
}
async function fixture(t){
 const browser=socketEnvironment(t),api=await server(),values=new Map(),requests=[];
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const journal=createCommandJournal({indexedDB:new IDBFactory()});
 const store=browser.own(createSyncStore({storage,commandJournal:journal,fetcher:async(url,init={})=>{requests.push({path:new URL('https://test'+url).pathname,method:init.method??'GET'});return api.request(url,init);}}));
 const hydrate=createRouteHydration(),key={generation:0,owner:store,routeKey:'game:'+api.game.id,inputs:'same-route-inputs'};
 const read=()=>hydrate(key,()=>store.loadGame(api.game.id,{positionFirst:true})).then(game=>({game,error:null}),error=>({game:null,error}));
 const receive=async socket=>{const response=await api.request(`/api/shell/games/${api.game.id}?identityId=${store.getIdentityId()}`),snapshot=await response.json();assert(response.ok);socket.emit('open');socket.emit('message',{data:JSON.stringify({...snapshot,protocolVersion:2,gameId:api.game.id,type:'state_sync'})});await settle();};
 const check=async outcome=>{
  assert.equal(outcome.error,null);
  assert.equal(outcome.game.id,api.game.id);assert.notEqual(outcome.game.positionOnly,true);
  assert.equal(store.getAuthoritativeGame(api.game.id).id,api.game.id);
  assert.equal(store.getLastEventSeq(api.game.id),api.eventSeq);
  assert.equal((await journal.list(store.getIdentityId(),api.game.id)).length,0);
  assert.equal(requests.filter(r=>/\/(apply|shared|end-turn|computer-control)$/.test(r.path)).length,0);
  assert.equal(requests.filter(r=>r.method==='GET'&&r.path===`/api/shell/games/${api.game.id}`).length,0,'Socket replacement must not become an extra legacy HTTP load');
 };
 return{...browser,api,store,read,receive,check,requests};
}

test('a fresh route hydrates from its original socket without a pageshow race',async t=>{const f=await fixture(t);f.store.setActiveGameId(f.api.game.id);const pending=f.read();await until(()=>f.sockets.length===1);await f.receive(f.sockets[0]);await f.check(await pending);});
test('a replacement socket completed before route loading remains usable',async t=>{const f=await fixture(t);f.store.setActiveGameId(f.api.game.id);f.window.dispatchEvent(new Event('pageshow'));await until(()=>f.sockets.length===2);await f.receive(f.sockets[1]);await until(()=>Boolean(f.store.getAuthoritativeGame(f.api.game.id))&&!f.store.getGameViewModel(f.api.game.id).recovering);const outcome=await f.read();assert.equal(outcome.error,null);assert.equal(outcome.game.id,f.api.game.id);assert.notEqual(outcome.game.positionOnly,true);});
test('pageshow replacement may retire the exact initial read without rejecting a now-proven full-game route',async t=>{const f=await fixture(t);f.store.setActiveGameId(f.api.game.id);const pending=f.read();await until(()=>f.sockets.length===1);f.window.dispatchEvent(new Event('pageshow'));await until(()=>f.sockets.length===2);await settle();await f.receive(f.sockets[1]);const result=await pending;t.diagnostic(`Actual initial-load result: ${result.error?.code??'full replacement accepted'}`);await f.check(result);});

// Execute the actual loader consumer to qualify each refusal independently of
// the socket race. Reconciliation is the only controlled seam; no write owner
// or snapshot validation algorithm is copied into this fixture.
function controlledLoader(game,{mutate=()=>{},code='recovery_superseded',synchronous=false,status=null,initialAuthenticated=true}={}){
 const state={pendingCommands:[],recoveryGeneration:1,connectionRecoveryEpoch:1,connectionRecovering:false,recoveryOwner:null,recoveryPromise:null};
 const session={authenticated:initialAuthenticated,contextId:'c'.repeat(64),account:{id:'id-main-owner'}};
 const context={identityId:'id-main-owner',active:true,auth:{enabled:true,storageGeneration:'same-storage',session},gameById:new Map(),lastEventSeqByGameId:new Map(),
  getOptimisticState:()=>state,beforeReconcile:async()=>true,hydrateJournal:async()=>{},validSyncSnapshot,isSyncRevision,
  getGameViewModel:()=>context.gameById.get(game.id)??null,markUpgradeRequired:()=>{throw Error('Unexpected initial upgrade');}};
 let fallbackCalls=0;context.boundedRequest=async()=>{fallbackCalls++;return {protocolVersion:2,game,eventSeq:1};};
 context.upsertGameSnapshot=({game,eventSeq})=>{context.gameById.set(game.id,game);context.lastEventSeqByGameId.set(game.id,eventSeq);};
 const failure=Object.assign(new Error(code),{code,...(status===null?{}:{status})});
 const finish=()=>{context.gameById.set(game.id,structuredClone(game));context.lastEventSeqByGameId.set(game.id,1);mutate(context,state);throw failure;};
 context.reconcileGame=()=>synchronous?finish():Promise.resolve().then(finish);
 const load=vm.runInNewContext(loaderSource+';loadGame',context);
 return{load:()=>load(game.id),failure,state,context,get fallbackCalls(){return fallbackCalls;}};
}
test('the actual loader accepts only a proven full replacement and preserves every foreign/stale/blocking refusal',async()=>{
 const {game}=await server();const good=controlledLoader(game);assert.equal((await good.load()).id,game.id);
 const refusals={
  retired:c=>{c.active=false;},identity:c=>{c.identityId='different-owner';},session:c=>{c.auth.session={...c.auth.session};},
  context:c=>{c.auth.session.contextId='d'.repeat(64);},account:c=>{c.auth.session.account.id='different-account';},signedOut:c=>{c.auth.session.authenticated=false;},
  authMode:c=>{c.auth.enabled=false;},storageGeneration:c=>{c.auth.storageGeneration='different-storage';},
  optimisticOwner:(c,s)=>{c.getOptimisticState=()=>({...s});},inflightWrite:(_c,s)=>{s.attempt={commandId:'existing-command'};},
  recoveryGeneration:(_c,s)=>{s.recoveryGeneration++;},connectionEpoch:(_c,s)=>{s.connectionRecoveryEpoch++;},
  recovering:(_c,s)=>{s.connectionRecovering=true;},recoveryOwner:(_c,s)=>{s.recoveryOwner={};},recoveryPromise:(_c,s)=>{s.recoveryPromise=Promise.resolve();},
  storage:(_c,s)=>{s.storageBlocked=true;},unsaved:(_c,s)=>{s.unsavedCommand={};},upgrade:(_c,s)=>{s.upgradeRequired=true;},
  pendingWrite:(_c,s)=>{s.pendingCommands=[{clientCommandId:'unresolved-write'}];},forceSnapshot:(_c,s)=>{s.forceSnapshot=true;},
  sessionFailure:(_c,s)=>{s.recoveryIssue='session_changed';},credentialFailure:(_c,s)=>{s.recoveryIssue='invalid_credentials';},
  missingGame:c=>{c.gameById.clear();},wrongGame:c=>{c.gameById.set(game.id,{...game,id:'wrong-game'});},
  positionOnly:c=>{c.gameById.set(game.id,{...game,positionOnly:true});},invalidSequence:c=>{c.lastEventSeqByGameId.set(game.id,-1);},
 };
 for(const [label,mutate]of Object.entries(refusals)){const f=controlledLoader(game,{mutate});await assert.rejects(f.load(),error=>error===f.failure,label);}
 const signIn=controlledLoader(game,{initialAuthenticated:false,mutate:c=>{c.auth.session.authenticated=true;}});await assert.rejects(signIn.load(),error=>error===signIn.failure);
 for(const synchronous of [false,true]){const unrelated=controlledLoader(game,{code:'unrelated_read_failure',synchronous});await assert.rejects(unrelated.load(),error=>error===unrelated.failure);assert.equal(unrelated.fallbackCalls,0);}
 for(const status of [404,405]){const fallback=controlledLoader(game,{code:'legacy_protocol_discovery',status,synchronous:true});assert.equal((await fallback.load()).id,game.id);assert.equal(fallback.fallbackCalls,1);}
});
