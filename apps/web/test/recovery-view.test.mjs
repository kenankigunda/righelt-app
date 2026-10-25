import test from "node:test";
import assert from "node:assert/strict";
import { recoveryMessage, isBoardRecoveryPending } from "../shell/recovery-view.js";
import { createLiveTransportStore } from "../shell/live-transport.js";

const snapshot = (n) => ({ pieces: [], sideToMove: "P1", turnIndex: n });
const fixture = () => ({ id: "history", createdAt: "2026-01-01", updatedAt: "2026-01-01", gameplayRevision: 0,
 board: { state: snapshot(9) }, currentSnapshot: snapshot(9), turns: [], canRecordMove: true, canEndTurn: true,
 moves: [0,1,2,3].map((index) => ({ index, moveId: `m${index}`, snapshot: snapshot(index), selectionSnapshot: snapshot(20+index) })) });
const store = () => createLiveTransportStore({ storage: {getItem:()=>"actor",setItem(){}}, fetcher: () => { throw Error("No network needed for history"); } });

test("live board loading follows blocked recovery without requiring a reconnect timestamp", () => {
 const pending = {sharedMutationsBlocked:true,syncStatus:"confirming",pendingCommandCount:3,recoveryStartedAt:null};
 assert.equal(isBoardRecoveryPending(pending),true);
 assert.equal(isBoardRecoveryPending({...pending,recovering:true,syncStatus:"ready"}),true);
 assert.equal(isBoardRecoveryPending({...pending,sharedMutationsBlocked:false}),false);
 assert.equal(isBoardRecoveryPending({...pending,syncStatus:"ready"}),false);
 for (const flags of [{inHistoryMode:true},{storageBlocked:true},{upgradeRequired:true},{recoveryIssue:"session_changed"},{recoveryIssue:"invalid_credentials"}])
  assert.equal(isBoardRecoveryPending({...pending,...flags}),false);
 assert.equal(isBoardRecoveryPending(null),false);
});

test("history keeps the selected position after trimming and ignores same-identity tab selection", () => {
 const t = store(); t.applyLiveGameUpdate({game:fixture()});
 t.setConnectionRecovering("history",true);
 t.selectHistoryMove({gameId:"history",moveIndex:2});
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(2));
 const next=fixture(); next.moves=next.moves.slice(1).map((m,index)=>({...m,index})); next.historyIndex=2;next.inHistoryMode=true;
 t.applyLiveGameUpdate({game:next});
 assert.equal(t.getGameViewModel("history").historyIndex,1);
 next.moves=next.moves.filter(m=>m.moveId!=="m2").map((m,index)=>({...m,index}));
 t.applyLiveGameUpdate({game:next});
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(2));
 assert.equal(t.getGameViewModel("history").inspectedDecision.moveId,"m2");
 assert.equal(t.getGameViewModel("history").historyIndex,null);
 t.applyLiveGameUpdate({game:{...next,moves:[]}});
 assert.equal(t.getGameViewModel("history").inHistoryMode,true);
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(2));
 assert.equal(t.getGameViewModel("history").sharedMutationsBlocked,true);
});
test("return live is immediate offline and remains live across later server history selections", () => {
 const t=store();t.applyLiveGameUpdate({game:fixture()});t.selectHistoryMove({gameId:"history",moveIndex:0});
 t.returnToLive({gameId:"history"});t.applyLiveGameUpdate({game:{...fixture(),inHistoryMode:true,historyIndex:1,currentSnapshot:snapshot(1)}});
 assert.equal(t.getGameViewModel("history").inHistoryMode,false);
 assert.deepEqual(t.getGameViewModel("history").currentSnapshot,snapshot(9));
});
test("recovery copy distinguishes pending, overdue, storage admission, cleanup and limits", () => {
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:1}),"");
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:2}),"");
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:2,confirmationOverdue:true}),"Still checking your move. You can retry or view details.");
 assert.equal(recoveryMessage({recovering:true,pendingCommandCount:1,confirmationOverdue:true}),"Still checking your move. You can retry or view details.");
 assert.equal(recoveryMessage({recovering:true}),"");
 assert.equal(recoveryMessage({storageBlocked:true,unsavedCommand:true}),"We couldn’t save your move. Please try again.");
 assert.doesNotMatch(recoveryMessage({storageBlocked:true}),/wasn't sent/);
 assert.match(recoveryMessage({storageBlocked:true,storageLimitReached:true}),/earlier moves/);
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
    if(url.endsWith("reconcile")){if(known===undefined)known=JSON.parse(init.body).knownSnapshotEventSeq;if(++refreshes===1)throw Error("still disconnected");
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

test('trimmed historical turns derive nominal ownership from the archived continuation', () => {
 const t=store(), game=fixture();
 game.currentTurn={index:9,playerSeat:'Player 1',moveIndexes:[]};
 game.moves[0].snapshot={...snapshot(2),sideToMove:'P1',continuation:{type:'push',phase:'retreat',owner:'P2'}};
 t.applyLiveGameUpdate({game}); t.selectHistoryMove({gameId:'history',moveIndex:0});
 const view=t.getGameViewModel('history');
 assert.equal(view.currentTurn.index,2); assert.equal(view.turnOwnerSeat,'Player 2');
 assert.equal(view.controlSeat,'Player 1'); assert.equal(view.canRecordMove,false);
});

test("ordinary retry errors stay quiet until the stable episode reaches four seconds",()=>{
 const game={recovering:true,recoveryStartedAt:1000,recoveryIssue:"request_timeout"};
 assert.equal(recoveryMessage(game,4999),"");
 assert.equal(recoveryMessage(game,5000),"Reconnecting");
 assert.match(recoveryMessage({...game,recoveryIssue:"HTTP_503"},16000),/retry or view details/);
 assert.match(recoveryMessage({...game,recoveryIssue:"invalid_credentials"},1001),/sign in/);
});

test("uncached history preserves the old selection through failure and cached history works offline",async()=>{
 let offline=false,fail=true,reads=0;
 const game=fixture();const complete=structuredClone(game.moves[0]);
 const t=createLiveTransportStore({storage:{getItem:()=>"actor",setItem(){}},fetcher:async(url,init)=>{
   if(offline)throw Error("offline");reads++;
   if(fail)throw Error("unavailable");
   const request=JSON.parse(init.body);
   return Response.json({ok:true,gameId:game.id,gameplayRevision:game.gameplayRevision,move:{...complete,moveId:request.decisionId}});
 }});
 const summary=structuredClone(game);delete summary.moves[0].snapshot;delete summary.moves[0].selectionSnapshot;
 t.applyLiveGameUpdate({game:summary,eventSeq:5});
 t.selectHistoryMove({gameId:game.id,moveIndex:0});
 assert.equal(Boolean(t.getGameViewModel(game.id).inHistoryMode),false);
 assert.equal(t.getGameViewModel(game.id).historyLoading,true);
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(Boolean(t.getGameViewModel(game.id).inHistoryMode),false);
 assert.equal(t.getGameViewModel(game.id).historyLoadError,"unavailable");
 fail=false;t.selectHistoryMove({gameId:game.id,moveIndex:0});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(t.getGameViewModel(game.id).inHistoryMode,true);
 assert.deepEqual(t.getGameViewModel(game.id).currentSnapshot,complete.snapshot);
 t.returnToLive({gameId:game.id});offline=true;const before=reads;
 t.selectHistoryMove({gameId:game.id,moveIndex:0});
 assert.equal(t.getGameViewModel(game.id).inHistoryMode,true);assert.equal(reads,before);
 t.retire();
});

test("accepting two commands preserves the first inspected pending board when it becomes a summary",()=>{
 const t=store(),game=fixture();
 game.pendingMoves=[{index:4,clientCommandId:"first",snapshot:snapshot(44),selectionSnapshot:snapshot(43)},{index:5,clientCommandId:"second",snapshot:snapshot(45),selectionSnapshot:snapshot(44)}];
 t.applyLiveGameUpdate({game});t.selectHistoryMove({gameId:game.id,moveIndex:4});
 t.applyLiveGameUpdate({game:{...game,pendingMoves:[],moves:[...game.moves,{index:4,clientCommandId:"first",moveId:"accepted-first"},{...game.pendingMoves[1],moveId:"accepted-second"}]}});
 assert.equal(t.getGameViewModel(game.id).inspectedDecision.moveId,"accepted-first");
 assert.deepEqual(t.getGameViewModel(game.id).currentSnapshot,snapshot(44));
 t.retire();
});
