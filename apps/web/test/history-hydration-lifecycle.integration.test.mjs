import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTransportStore} from '../shell/live-transport.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=turnIndex=>({pieces:[],sideToMove:'P1',turnIndex});
const move=(index,turnIndex=4)=>({index,moveId:`m${index}`,turnIndex,turnMoveIndex:index,action:{type:'pass',actorId:'P1'},snapshot:snapshot(turnIndex)});
const summary=record=>{const next={...record};delete next.snapshot;return next;};
const game=moves=>({id:'history-lifecycle',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:7,board:{state:snapshot(9)},currentSnapshot:snapshot(9),turns:[],moves,canRecordMove:false,canEndTurn:false});
const store=fetcher=>createLiveTransportStore({storage:{getItem:()=> 'actor',setItem(){}},commandJournal:{list:async()=>[]},fetcher});

test('returning Live aborts the only active optional readers and never starts queued snapshots',async t=>{
 const moves=Array.from({length:10},(_,index)=>move(index));
 let started=0,active=0,peak=0,aborted=0;
 const transport=store((url,init)=>{
  assert.match(url,/decision-snapshot$/);assert.equal(init.method,'POST');
  started+=1;active+=1;peak=Math.max(peak,active);
  return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted+=1;active-=1;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true}));
 });
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:game(moves.map(summary)),eventSeq:7});
 const selecting=transport.selectHistoryTurn({gameId:'history-lifecycle',turnIndex:4});
 await tick();assert.equal(started,4);assert.equal(peak,4);
 transport.returnToLive({gameId:'history-lifecycle'});await selecting;await tick();
 assert.equal(started,4,'six obsolete queued reads never reach the transport boundary');
 assert.equal(aborted,4);assert.equal(active,0);
 const view=transport.getGameViewModel('history-lifecycle');
 assert.equal(view.inHistoryMode,false);assert.equal(view.historyLoading,false);assert.equal(view.pendingCommandCount,0);
});

test('a current shared consumer keeps the exact snapshot request alive after History retires',async t=>{
 const record=move(0),pending=[];let requests=0,aborts=0;
 const transport=store((url,init)=>{
  assert.match(url,/decision-snapshot$/);requests+=1;init.signal.addEventListener('abort',()=>aborts+=1);
  return new Promise(resolve=>pending.push(()=>resolve(Response.json({ok:true,gameId:'history-lifecycle',gameplayRevision:7,move:record}))));
 });
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:game([summary(record)]),eventSeq:7});
 const selecting=transport.selectHistoryTurn({gameId:'history-lifecycle',turnIndex:4});await tick();
 const replacement=transport.selectHistoryTurn({gameId:'history-lifecycle',turnIndex:4});await tick();
 assert.equal(requests,1);assert.equal(aborts,0,'replacement claims the shared flight before the old consumer retires');
 const shared=transport.readDecisionMove('history-lifecycle',7,record.moveId);await tick();
 assert.equal(requests,1,'same immutable snapshot joins one optional flight');
 transport.returnToLive({gameId:'history-lifecycle'});await tick();assert.equal(aborts,0,'the remaining consumer retains the flight');
 pending[0]();assert.equal((await shared).moveId,record.moveId);await Promise.all([selecting,replacement]);
 assert.equal(transport.getGameViewModel('history-lifecycle').inHistoryMode,false);
});

test('concurrent archived-turn consumers share page discovery and snapshot hydration without caching unfenced pages',async t=>{
 const record=move(0,20);let archiveReads=0,snapshotReads=0,releaseArchive;
 const transport=store((url,init)=>{
  const body=JSON.parse(init.body);
  if(url.endsWith('/decision-history')){
   archiveReads+=1;
   if(archiveReads>1)return Promise.resolve(Response.json({items:[{kind:'decision',id:record.moveId,move:record}],nextCursor:null}));
   return new Promise(resolve=>releaseArchive=()=>resolve(Response.json({items:[{kind:'decision',id:record.moveId,move:record}],nextCursor:null})));
  }
  assert.ok(url.endsWith('/decision-snapshot'));snapshotReads+=1;
  return Promise.resolve(Response.json({gameId:'history-lifecycle',gameplayRevision:7,move:record}));
 });
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:game([]),eventSeq:7});
 const first=transport.loadTurnMoves({gameId:'history-lifecycle',turnIndex:20});
 const second=transport.loadTurnMoves({gameId:'history-lifecycle',turnIndex:20});await tick();
 assert.equal(archiveReads,1);releaseArchive();
 assert.deepEqual((await Promise.all([first,second])).map(moves=>moves.map(value=>value.moveId)),[[record.moveId],[record.moveId]]);
 assert.equal(snapshotReads,1);
 await transport.loadTurnMoves({gameId:'history-lifecycle',turnIndex:20});
 assert.equal(archiveReads,2,'a later call revalidates unfenced archive lineage');
 assert.equal(snapshotReads,1,'the existing bounded completed-snapshot cache remains reusable');
});

test('an explicit move selection hydrates only that move without speculative adjacent reads',async t=>{
 const moves=[move(0),move(1),move(2)],requested=[];
 const transport=store((url,init)=>{
  assert.match(url,/decision-snapshot$/);const body=JSON.parse(init.body);requested.push(body.decisionId);
  return Promise.resolve(Response.json({gameId:'history-lifecycle',gameplayRevision:7,move:moves.find(value=>value.moveId===body.decisionId)}));
 });
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:game(moves.map(summary)),eventSeq:7});
 await transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:1,moveId:'m1'});
 assert.deepEqual(requested,['m1']);assert.equal(transport.getGameViewModel('history-lifecycle').inspectedDecision.moveId,'m1');
});

test('one failed turn snapshot retires its remaining queued and active siblings',async t=>{
 const moves=Array.from({length:6},(_,index)=>move(index));let started=0,aborted=0,rejectFirst;
 const transport=store((url,init)=>{
  assert.match(url,/decision-snapshot$/);started+=1;
  return new Promise((resolve,reject)=>{
   if(started===1)rejectFirst=()=>reject(new Error('snapshot_failed'));
   init.signal.addEventListener('abort',()=>{aborted+=1;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});
  });
 });
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:game(moves.map(summary)),eventSeq:7});
 const selection=transport.selectHistoryTurn({gameId:'history-lifecycle',turnIndex:4});await tick();assert.equal(started,4);
 rejectFirst();await selection;await tick();
 assert.equal(started,4,'failed optional work never opens the remaining queued reads');assert.equal(aborted,3);
 assert.equal(transport.getGameViewModel('history-lifecycle').historyLoadError,'snapshot_failed');
});


const completedGame=records=>{const value=game(records);value.board.state.outcome={status:'p1_win'};value.myRoles=['Player 1'];return value;};
const offerProof=(decisionId,revision=7,eligible=true)=>({gameId:'history-lifecycle',decisionId,gameplayRevision:revision,eligible});
test('completed cached selection hydrates only its authoritative eligibility proof',async t=>{
 const records=[move(0),move(1)],requested=[];let release;
 const transport=store((url,init)=>{
  assert.match(url,/decision-snapshot$/);requested.push(JSON.parse(init.body).decisionId);
  return new Promise(resolve=>{release=()=>resolve(Response.json({gameId:'history-lifecycle',gameplayRevision:7,move:records[1],undoEligibility:offerProof('m1')}));});
 });t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:completedGame(records),eventSeq:7});
 const selecting=transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:1});await tick();
 assert.deepEqual(requested,['m1'],'local snapshots cannot grant completed Undo without authority proof');
 assert.equal(transport.getGameViewModel('history-lifecycle').completedUndoEligibility,null);
 release();await selecting;const selected=transport.getGameViewModel('history-lifecycle');
 assert.equal(selected.inspectedDecision.moveId,'m1');assert.deepEqual(selected.completedUndoEligibility,offerProof('m1'));
 await transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:1});assert.deepEqual(requested,['m1'],'same exact revision proof is reusable');
});

test('late completed target proof cannot displace a newer selected target',async t=>{
 const records=[move(0),move(1)],pending=[];
 const transport=store((url,init)=>new Promise(resolve=>{const id=JSON.parse(init.body).decisionId;pending.push(()=>resolve(Response.json({gameId:'history-lifecycle',gameplayRevision:7,move:records.find(m=>m.moveId===id),undoEligibility:offerProof(id)})));}));
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:completedGame(records),eventSeq:7});
 const first=transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:0});await tick();
 const second=transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:1});await tick();
 assert.equal(pending.length,2);pending[1]();await second;pending[0]();await first;
 const selected=transport.getGameViewModel('history-lifecycle');assert.equal(selected.inspectedDecision.moveId,'m1');assert.deepEqual(selected.completedUndoEligibility,offerProof('m1'));
});

test('completed proof cannot survive a new gameplay revision or returning Live',async t=>{
 const record=move(0),transport=store(()=>Promise.resolve(Response.json({gameId:'history-lifecycle',gameplayRevision:7,move:record,undoEligibility:offerProof('m0')})));
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:completedGame([record]),eventSeq:7});
 await transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:0});assert.equal(transport.getGameViewModel('history-lifecycle').completedUndoEligibility.eligible,true);
 const revised=completedGame([record]);revised.gameplayRevision=8;transport.applyLiveGameUpdate({game:revised,eventSeq:8});
 assert.equal(transport.getGameViewModel('history-lifecycle').completedUndoEligibility,null);
 transport.returnToLive({gameId:'history-lifecycle'});assert.equal(transport.getGameViewModel('history-lifecycle').completedUndoEligibility,null);
});

for(const invalid of [undefined,{...offerProof('m0'),decisionId:'other'},{...offerProof('m0'),gameplayRevision:6}])test(`completed hydration ignores missing or foreign eligibility ${JSON.stringify(invalid)}`,async t=>{
 const record=move(0),transport=store(()=>Promise.resolve(Response.json({gameId:'history-lifecycle',gameplayRevision:7,move:record,undoEligibility:invalid})));
 t.after(()=>transport.retire());transport.applyLiveGameUpdate({game:completedGame([record]),eventSeq:7});await transport.selectHistoryMove({gameId:'history-lifecycle',moveIndex:0});
 assert.equal(transport.getGameViewModel('history-lifecycle').completedUndoEligibility,null);
});
