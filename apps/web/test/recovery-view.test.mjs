import test from "node:test";
import assert from "node:assert/strict";
import { recoveryMessage } from "../shell/recovery-view.js";
import { createLiveTransportStore } from "../shell/live-transport.js";

const snapshot = (n) => ({ pieces: [], sideToMove: "P1", turnIndex: n });
const fixture = () => ({ id: "history", createdAt: "2026-01-01", updatedAt: "2026-01-01", gameplayRevision: 0,
 board: { state: snapshot(9) }, currentSnapshot: snapshot(9), turns: [], canRecordMove: true, canEndTurn: true,
 moves: [0,1,2,3].map((index) => ({ index, moveId: `m${index}`, snapshot: snapshot(index), selectionSnapshot: snapshot(20+index) })) });
const store = () => createLiveTransportStore({ storage: {getItem:()=>"actor",setItem(){}}, fetcher: () => { throw Error("No network needed for history"); } });

test("history uses stable IDs across trimming and ignores same-identity tab selection; nearest fallback prefers earlier tie", () => {
 const t = store(); t.applyLiveGameUpdate({game:fixture()});
 t.setConnectionRecovering("history",true);
 t.selectHistoryMove({gameId:"history",moveIndex:2});
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(2));
 const next=fixture(); next.moves=next.moves.slice(1).map((m,index)=>({...m,index})); next.historyIndex=2;next.inHistoryMode=true;
 t.applyLiveGameUpdate({game:next});
 assert.equal(t.getGameViewModel("history").historyIndex,1);
 next.moves=next.moves.filter(m=>m.moveId!=="m2").map((m,index)=>({...m,index}));
 t.applyLiveGameUpdate({game:next});
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(1));
 assert.equal(t.getGameViewModel("history").historyNotice,"History changed. Showing the nearest available move.");
 t.applyLiveGameUpdate({game:{...next,moves:[]}});
 assert.equal(t.getGameViewModel("history").inHistoryMode,false);
 assert.equal(t.getGameViewModel("history").historyNotice,"History changed. Showing the current board.");
 assert.equal(t.getGameViewModel("history").sharedMutationsBlocked,true);
});
test("return live is immediate offline and remains live across later server history selections", () => {
 const t=store();t.applyLiveGameUpdate({game:fixture()});t.selectHistoryMove({gameId:"history",moveIndex:0});
 t.returnToLive({gameId:"history"});t.applyLiveGameUpdate({game:{...fixture(),inHistoryMode:true,historyIndex:1,currentSnapshot:snapshot(1)}});
 assert.equal(t.getGameViewModel("history").inHistoryMode,false);
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(9));
});
test("recovery copy distinguishes pending, overdue, storage admission, cleanup and limits", () => {
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:1}),"Checking your move…");
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:2}),"Checking your moves…");
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:2,confirmationOverdue:true}),"Your moves are still being checked.");
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:1,confirmationOverdue:true}),"Your move is still being checked.");
 assert.equal(recoveryMessage({recovering:true}),"Reconnecting. Your board will update shortly.");
 assert.equal(recoveryMessage({storageBlocked:true,unsavedCommand:true}),"Your browser couldn't save this move. It wasn't sent.");
 assert.doesNotMatch(recoveryMessage({storageBlocked:true}),/wasn't sent/);
 assert.match(recoveryMessage({storageBlocked:true,storageLimitReached:true}),/Earlier moves/);
 assert.equal(recoveryMessage({pendingCommandCount:1,syncStatus:"applying-update"}),"");
});
test("recovery gates every shared transport entrypoint and preserves home-card state", async () => {
 const t=store();t.applyLiveGameUpdate({game:fixture()});t.setConnectionRecovering("history",true);
 for(const name of ["playAsBothPlayers","approvePendingRequest","requestRevertToMove","approveRevertRequest","rejectRevertRequest","rescindRevertRequest"])
   await assert.rejects(t[name]({gameId:"history"}),/sync_recovering/);
 assert.equal(t.getHomeGameCard("history").syncStatus,"confirming");
 assert.equal(t.getGameViewModel("history").canRecordMove,false);
 t.setConnectionRecovering("history",false);
 assert.equal(t.getHomeGameCard("history").syncStatus,"ready");
 assert.equal(t.getGameViewModel("history").canRecordMove,true);
});

test("uncertain undo forces a snapshot even at the same sequence and retries a failed refresh", async () => {
 for(const committed of [true,false]) {
  let refreshes=0;let known;
  const authoritative={...fixture(),notifications:[committed?"undo committed":"unchanged"]};
  const t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},commandJournal:{list:async()=>[],remove:async()=>{}},
   timing:{requestTimeoutMs:10,confirmationBudgetMs:100,retryDelaysMs:[5]},fetcher:async(url,init)=>{
    if(url.endsWith("revert-reject"))throw Error("lost response");
    if(url.endsWith("reconcile")){known=JSON.parse(init.body).knownSnapshotEventSeq;if(++refreshes===1)throw Error("still disconnected");
     return Response.json({ok:true,protocolVersion:2,gameId:"history",eventSeq:5,gameplayRevision:0,commandOutcomes:[],game:authoritative});}
    throw Error(url);
   }});
  t.applyLiveGameUpdate({game:fixture(),eventSeq:5});
  t.applyLiveGameUpdate({game:{...fixture(),notifications:["tentative undo"]}});
  await assert.rejects(t.rejectRevertRequest({gameId:"history",requestId:"r"}),/response was lost/);
  assert.equal(t.getGameViewModel("history").sharedMutationsBlocked,true);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(known,0);assert.ok(refreshes>=2);
  assert.deepEqual(t.getGameViewModel("history").notifications,authoritative.notifications);
  assert.equal(t.getGameViewModel("history").sharedMutationsBlocked,false);
 }
});

test("selected pending history keeps its command identity through acceptance and uses result snapshot", () => {
 const t=store();const game=fixture();game.pendingMoves=[{index:4,clientCommandId:"cmd",snapshot:snapshot(4),selectionSnapshot:snapshot(20)}];
 t.applyLiveGameUpdate({game});t.selectHistoryMove({gameId:"history",moveIndex:4});
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(4));
 t.applyLiveGameUpdate({game:{...game,pendingMoves:[],moves:[...game.moves,{...game.pendingMoves[0],moveId:"durable-move"}]}});
 assert.equal(t.getGameViewModel("history").historyIndex,4);
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(4));
 t.returnToLive({gameId:"history"});assert.equal(t.getGameViewModel("history").canRecordMove,true);
});

test("an older reconciliation cannot clear a newer uncertain mutation epoch", async () => {
 let failSecond, finishFirstRefresh;let reads=0;
 const response=()=>Response.json({ok:true,protocolVersion:2,gameId:"history",eventSeq:5,gameplayRevision:0,commandOutcomes:[],game:fixture()});
 const t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},commandJournal:{list:async()=>[]},
  timing:{requestTimeoutMs:1000,retryDelaysMs:[10]},fetcher:async(url)=>{
   if(url.endsWith("revert-reject"))return new Promise((_,reject)=>{failSecond=reject;});
   if(url.endsWith("revert-rescind"))throw Error("first lost");
   if(url.endsWith("reconcile")){if(++reads===1)return new Promise(resolve=>{finishFirstRefresh=()=>resolve(response());});return response();}
  }});
 t.applyLiveGameUpdate({game:fixture(),eventSeq:5});
 const second=t.rejectRevertRequest({gameId:"history"});
 const first=t.rescindRevertRequest({gameId:"history"});
 await assert.rejects(first,/response was lost/);
 while(!finishFirstRefresh)await new Promise(resolve=>setTimeout(resolve,0));
 failSecond(Error("second lost"));await assert.rejects(second,/response was lost/);
 finishFirstRefresh();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(t.getGameViewModel("history").sharedMutationsBlocked,true);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(reads>=2);assert.equal(t.getGameViewModel("history").sharedMutationsBlocked,false);
});

test("history and live-return project forced-response ownership without enabling the wrong seat", () => {
 const t=store();const game=fixture();game.player1={identityId:"owner"};game.player2={identityId:"actor"};
 game.turns=[{index:9,playerSeat:"Player 1",moveIndexes:[0]}];game.legalActions=[{type:"move"}];
 game.board.state.continuation={type:"push",phase:"retreat"};game.moves[0].snapshot={...snapshot(9),continuation:{type:"push",phase:"retreat"}};
 t.applyLiveGameUpdate({game});t.selectHistoryMove({gameId:"history",moveIndex:0});
 assert.equal(t.getGameViewModel("history").control,"opponent");assert.equal(t.getGameViewModel("history").canRecordMove,false);
 t.returnToLive({gameId:"history"});assert.equal(t.getGameViewModel("history").canRecordMove,true);assert.equal(t.getGameViewModel("history").canEndTurn,false);
});

test("refreshing static home cards cannot erase local recovery state",async()=>{
 const t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},commandJournal:{list:async()=>[]},fetcher:async()=>Response.json({games:[{id:"history",syncStatus:"ready"}]})});
 t.applyLiveGameUpdate({game:fixture()});t.setConnectionRecovering('history',true);
 await t.loadGamesPage({section:'my'});
 assert.equal(t.getHomeGameCard('history').syncStatus,'confirming');
 assert.equal(t.getGameViewModel('history').recovering,true);
});

test("home listing restores and reconciles a journal game outside the visible page",async()=>{
 const {commandFingerprint}=await import('../generated/packages/shared-types/src/sync-protocol.js');
 const envelope={protocolVersion:2,gameId:'history',identityId:'actor',clientCommandId:'v2:home-reload',kind:'end_turn',payload:{},expectedState:snapshot(9),expectedGameplayRevision:0,expectedTurnIndex:9};
 envelope.fingerprint=await commandFingerprint(envelope);let saved=[envelope];let reconciled=false;
 const t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},commandJournal:{list:async()=>saved,remove:async()=>{saved=[];}},fetcher:async(url)=>{
  if(url.includes('/reconcile')){reconciled=true;return Response.json({protocolVersion:2,gameId:'history',eventSeq:1,gameplayRevision:0,game:fixture(),commandOutcomes:[{...envelope,outcome:'rejected',reason:'stale_state',eventSeq:1,gameplayRevision:0}]});}
  return Response.json({games:[]});
 }});
 await t.loadGamesPage({section:'my'});
 for(let i=0;i<20&&saved.length;i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(reconciled,true);assert.equal(saved.length,0);
 assert.equal(t.getGameViewModel('history').pendingCommandCount,0);
});

test("initial socket snapshot satisfies page load without a second HTTP snapshot",async()=>{
 let t;let reads=0;
 t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},commandJournal:{list:async()=>[]},beforeReconcile:async()=>{t.applyLiveGameUpdate({game:fixture(),eventSeq:7});return true;},fetcher:async()=>{reads++;throw Error('duplicate HTTP snapshot');}});
 assert.equal((await t.loadGame('history')).id,'history');assert.equal(reads,0);
});

test("initial socket fallback shares reconciliation and does not start a competing GET",async()=>{
 let reads=0;const t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},commandJournal:{list:async()=>[]},beforeReconcile:async()=>true,fetcher:async(url)=>{
  assert.ok(url.endsWith('/reconcile'));reads++;
  return Response.json({protocolVersion:2,gameId:'history',eventSeq:7,gameplayRevision:0,commandOutcomes:[],game:fixture()});
 }});
 const loaded=await Promise.all([t.loadGame('history'),t.reconcileGame('history')]);
 assert.equal(loaded[0].id,'history');assert.equal(reads,1);
});
