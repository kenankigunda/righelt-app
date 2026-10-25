import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createSyncStore} from '../shell/sync-store.js';
import {createCommandJournal} from '../shell/command-journal.js';
import apiWorker from '../../api/index.js';
import {createFakeD1} from '../../../packages/api-handler/test/support/fake-d1.mjs';
import {createFakeGameRooms} from '../../../packages/api-handler/test/support/fake-game-rooms.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('a human move drains exactly once after creation and a socket-confirmed computer lease retire',{timeout:5000},async t=>{
 const env={DB:createFakeD1()};env.GAME_ROOMS=createFakeGameRooms(()=>env);
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
 const journal=createCommandJournal({indexedDB:new IDBFactory()}),creationReady=deferred(),releaseCreation=deferred(),sharedReady=deferred();
 const writes=[],admissions=[];const admit=journal.admit;journal.admit=command=>{admissions.push(structuredClone(command));return admit(command);};
 const store=createSyncStore({storage,commandJournal:journal,createSyncClient:()=>({connectGame(){},disconnectGame(){},disconnectAll(){},getDesiredGameIds:()=>[]}),fetcher:async(url,init={})=>{
  const request=new Request(`https://example.test${url}`,init),body=init.body?JSON.parse(init.body):null;
  if(init.method==='POST')writes.push({url,body});
  const response=await apiWorker.fetch(request,env);
  if(url==='/api/shell/games'){creationReady.resolve();await releaseCreation.promise;}
  if(url.endsWith('/shared')){
   const accepted=await response.clone().json();sharedReady.resolve({accepted,body});
   // The server committed, but only the socket receipt may finish this request.
   return new Promise((resolve,reject)=>{const abort=()=>reject(init.signal?.reason??new DOMException('Aborted','AbortError'));if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});});
  }
  return response;
 }});
 t.after(()=>{releaseCreation.resolve();store.retire();});
 const creation=store.createGame({computer:{p1:null,p2:'babs'}});await creationReady.promise;
 assert.equal(store.getGameViewModel(creation.gameId).canRecordMove,false);
 assert.equal(writes.filter(write=>write.url.endsWith('/apply')).length,0);
 releaseCreation.resolve();await creation.committed;
 const control=store.computerControl(creation.gameId,{action:'acquire',deviceId:'test-device',tabId:'test-tab',generation:0}).then(value=>({value}),error=>({error}));
 const {accepted,body}=await sharedReady.promise;
 assert.equal(body.kind,'shared');assert.equal(body.payload.operation,'computer-control');
 const outcome=accepted.commandOutcomes.find(outcome=>outcome.clientCommandId===body.clientCommandId);assert.equal(outcome.outcome,'accepted');
 // Public socket admission entry point: actual API-produced authority/receipt.
 store.applyLiveGameUpdate({game:accepted.game,eventSeq:accepted.eventSeq,commandOutcome:outcome});const controlOutcome=await control;assert.equal(controlOutcome.error,undefined);
 const ready=store.getGameViewModel(creation.gameId);assert.equal(ready.sharedMutationsBlocked,false);assert.equal(ready.canRecordMove,true);
 assert.equal(JSON.parse(storage.getItem('righelt.pendingLocalGames')??'{}')[creation.gameId],undefined);
 const action=ready.legalActions.find(action=>action.from&&action.to);assert(action);
 const move=await store.applyGameAction({gameId:creation.gameId,state:ready.currentSnapshot,action});await move.committed;
 const sent=writes.filter(write=>write.url.endsWith('/apply'));assert.equal(sent.length,1);assert.equal(sent[0].body.clientCommandId,move.id);
 const saved=admissions.filter(command=>command.kind==='action');assert.equal(saved.length,1);assert.deepEqual(sent[0].body,saved[0]);
 assert.equal(store.getGameViewModel(creation.gameId).moves.length,1);assert.equal(env.DB.getGameState(creation.gameId).moves.length,1);
 assert.deepEqual(await journal.list(store.getIdentityId(),creation.gameId),[]);
});
