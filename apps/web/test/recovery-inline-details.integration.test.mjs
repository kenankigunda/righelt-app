import {createGameAlertItems} from '../shell/game-alert-presentation.js';
import {recoveryActivity} from '../shell/notification-state.js';
import {activityActorSide} from '../shell/activity-affiliation.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';
import {createRecoveryPresentation} from '../shell/recovery-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveTransportStore} from '../shell/live-transport.js';
import {recoveryMessage,needsRecoveryAction} from '../shell/recovery-view.js';
import {renderGameAlertCard} from '../shell/game-alert.js';
import {issueDiagnostics} from '../shell/issue-diagnostics.js';

test('a promoted long recovery has actionable inline details without a request failure', t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});
 issueDiagnostics.clear();
 const transport=createLiveTransportStore({storage:{getItem:()=> 'details-test',setItem(){}},fetcher:()=>{throw Error('No request needed');}});
 t.after(()=>{transport.retire();issueDiagnostics.clear();});
 transport.applyLiveGameUpdate({game:{id:'details-game',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:0,board:{state:{pieces:[],sideToMove:'P1',turnIndex:0}},moves:[],turns:[],canRecordMove:true},eventSeq:1});
 transport.setConnectionRecovering('details-game',true);
 t.mock.timers.tick(15000);
 const game=transport.getGameViewModel('details-game');
 assert.equal(needsRecoveryAction(game),true);
 assert.match(recoveryMessage(game),/Still reconnecting.*view details/);
 const html=renderGameAlertCard({body:recoveryMessage(game),incidentId:transport.ensureRecoveryIncident(game.id)});
 assert.match(html,/data-action="toggle-diagnostic"/,'a notice promising details must expose its report');
 // Exercise the current app-used item owner as well as the disclosure renderer.
 // Playback/Undo/context leaves are absent in this real transport fixture.
 const getItems=createGameAlertItems(()=>({transport,maybeUpdateUndoRequestOutcomeFeedback(){},presentedRecoveryMessage:recoveryMessage,needsRecoveryAction,recoveryPresentationOptions:()=>({}),issueDiagnostics,isDiagnosticOpen:()=>false,dismissedRecoveryNotices:new Map(),escapeHtml:String,recoveryActivity,activityActorSide,playbackRecoveryWait:{update:()=>0},viewingScope:()=> 'details-test',liveBoardVisible:()=>true,SYNC_TIMING,renderComputerProgress:()=>'',computerSession:null,getActiveRevertRequest:()=>null,getActivePendingRevertRequest:()=>null,boardContextScope:()=> 'details-test',boardContexts:{items:()=>[]},contextReplayEnabled:()=>false}));
 const notice=getItems(game).find(item=>item.key.startsWith('live-sync:'));
 assert.ok(notice);assert.match(notice.html,/data-action="toggle-diagnostic"/,'the actual notification owner must wire its transport-owned report');
 assert.equal(issueDiagnostics.list().length,1);assert.equal(issueDiagnostics.get(transport.ensureRecoveryIncident(game.id)).events.filter(event=>event.stage==='notice_promoted').length,1);

});

test('promotion is idempotent and does not notify or mutate admission',t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});issueDiagnostics.clear();
 const transport=createLiveTransportStore({storage:{getItem:()=> 'details-test',setItem(){}},fetcher:()=>{throw Error('No request needed');}});
 t.after(()=>{transport.retire();issueDiagnostics.clear();});
 transport.applyLiveGameUpdate({game:{id:'g',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:0,board:{state:{pieces:[],sideToMove:'P1',turnIndex:0}},moves:[],turns:[],canRecordMove:true},eventSeq:1});
 transport.setConnectionRecovering('g',true);
 assert.equal(transport.ensureRecoveryIncident('g'),null);assert.equal(issueDiagnostics.list().length,0);
 t.mock.timers.tick(15000);let emissions=0;const unsubscribe=transport.subscribe(()=>emissions++);t.after(unsubscribe);
 const before=transport.getGameViewModel('g');const id=transport.ensureRecoveryIncident('g');assert.ok(id);
 for(let i=0;i<10;i++)assert.equal(transport.ensureRecoveryIncident('g'),id);
 assert.equal(emissions,0,'render-time evidence must not cause recursive rendering');
 const after=transport.getGameViewModel('g');
 for(const key of ['pendingCommandCount','gameplayRevision','sharedMutationsBlocked','gameplayMutationsBlocked','recovering','canRecordMove'])assert.equal(after[key],before[key]);
 assert.equal(issueDiagnostics.get(id).events.filter(event=>event.stage==='notice_promoted').length,1);
 assert.equal(transport.ensureRecoveryIncident('missing-game'),null);assert.equal(issueDiagnostics.list().length,1);
 transport.setConnectionRecovering('g',false);assert.ok(issueDiagnostics.get(id).resolvedAt);
 assert.equal(transport.ensureRecoveryIncident('g'),null);assert.equal(issueDiagnostics.list().length,1);
 transport.setConnectionRecovering('g',true);t.mock.timers.tick(15000);
 const next=transport.ensureRecoveryIncident('g');assert.ok(next);assert.notEqual(next,id);
 assert.equal(issueDiagnostics.list().length,2,'a real new episode can create its own report');
});

test('a pending command keeps its exact incident identity and sanitized payload on promotion',async t=>{
 const {IDBFactory}=await import('fake-indexeddb');
 const {createCommandJournal}=await import('../shell/command-journal.js');
 const {createInitialState,resolveToStability,listLegalActions}=await import('../generated/packages/game-engine/src/index.js');
 t.mock.timers.enable({apis:['Date'],now:1000});issueDiagnostics.clear();
 const journal=createCommandJournal({indexedDB:new IDBFactory()});
 const transport=createLiveTransportStore({storage:{getItem:()=> 'details-command',setItem(){}},commandJournal:journal,fetcher:(_url,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))});
 t.after(()=>{transport.retire();issueDiagnostics.clear();});
 const state=resolveToStability(createInitialState(),{artifactMode:'full'});
 transport.applyLiveGameUpdate({game:{id:'pending-details',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:0,board:{state},currentSnapshot:state,moves:[],turns:[{index:0,status:'active',playerSeat:'Player 1',startedAt:'2026-01-01',moveIndexes:[]}],currentTurn:{index:0,status:'active',playerSeat:'Player 1',startedAt:'2026-01-01',moveIndexes:[]},canRecordMove:true},eventSeq:1});
 const submitted=await transport.applyGameAction({gameId:'pending-details',state,action:listLegalActions(state).find(action=>action.type==='move')});
 assert.equal(submitted.accepted,true,JSON.stringify(submitted));
 const [envelope]=await journal.list(transport.getIdentityId(),'pending-details');assert.ok(envelope);
 transport.setConnectionRecovering('pending-details',true);
 t.mock.timers.tick(15000);
 const id=transport.ensureRecoveryIncident('pending-details');assert.ok(id);
 const report=issueDiagnostics.get(id);assert.equal(report.initial.commandId,submitted.clientCommandId);assert.equal(report.initial.fingerprint,envelope.fingerprint);
 assert.equal(issueDiagnostics.capture('recovery:pending-details',{stage:'later_receipt',commandId:submitted.clientCommandId}),id);
 assert.equal(transport.ensureRecoveryIncident('pending-details'),id);
 assert.equal(issueDiagnostics.get(id).events.filter(event=>event.stage==='notice_promoted').length,1);
 assert.deepEqual(await journal.list(transport.getIdentityId(),'pending-details'),[envelope]);
 transport.retire();assert.equal(transport.ensureRecoveryIncident('pending-details'),null);
});


test('an incompatible client notice has details before publishing its failure',t=>{
 issueDiagnostics.clear();
 const transport=createLiveTransportStore({storage:{getItem:()=> 'details-upgrade',setItem(){}},fetcher:()=>{throw Error('No request needed');}});
 t.after(()=>{transport.retire();issueDiagnostics.clear();});
 transport.applyLiveGameUpdate({game:{id:'upgrade',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:0,board:{state:{pieces:[],sideToMove:'P1',turnIndex:0}},moves:[],turns:[]},eventSeq:1});
 let published;
 transport.subscribe(event=>{if(event.type==='upgrade_required')published=transport.ensureRecoveryIncident('upgrade');});
 transport.markUpgradeRequired('upgrade');assert.ok(published);
 assert.equal(issueDiagnostics.get(published).initial.code,'upgrade_required');
 assert.match(renderGameAlertCard({incidentId:published}),/>Details<\/button>/);
});

const {createForegroundRecoveryWait}=await import('../shell/foreground-recovery.js');
const {createRecoveryTelemetry}=await import('../shell/recovery-telemetry.js');

for(const interrupted of ['hidden','History'])test(`${interrupted} recovery time cannot promote Details before a fresh foreground wait`,t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});issueDiagnostics.clear();
 const transport=createLiveTransportStore({storage:{getItem:()=> 'foreground-details',setItem(){}},fetcher:()=>{throw Error('No request needed');}});
 t.after(()=>{transport.retire();issueDiagnostics.clear();});
 transport.applyLiveGameUpdate({game:{id:'foreground-game',createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:0,board:{state:{pieces:[],sideToMove:'P1',turnIndex:0}},moves:[],turns:[]},eventSeq:1});
 transport.setConnectionRecovering('foreground-game',true);
 const wait=createForegroundRecoveryWait({setTimer:()=>0,clearTimer(){}}),route={name:'game',gameId:'foreground-game'},doc={hidden:false};
 let inspecting=false;
 const presentation=createRecoveryPresentation(()=>({transport,foregroundRecoveryWait:wait,viewingScope:()=> 'owner',currentRoute:route,document:doc,getCurrentViewedGameId:()=> 'foreground-game',computerSession:null,quietComputerRenewal:()=>false}));
 const render=()=>{const game={...transport.getGameViewModel('foreground-game'),inHistoryMode:inspecting};const required=needsRecoveryAction(game,Date.now(),presentation.options(game));return presentation.incidentId(game,required);};
 assert.equal(render(),null);t.mock.timers.tick(14000);assert.equal(render(),null);
 if(interrupted==='hidden')doc.hidden=true;else inspecting=true;
 assert.equal(render(),null);t.mock.timers.tick(600000);assert.equal(render(),null);
 doc.hidden=false;inspecting=false;assert.equal(render(),null);
 t.mock.timers.tick(14999);assert.equal(render(),null);assert.equal(issueDiagnostics.list().length,0);
 t.mock.timers.tick(1);const id=render();assert.ok(id);
 for(let i=0;i<10;i++)assert.equal(render(),id);
 assert.equal(issueDiagnostics.get(id).events.filter(event=>event.stage==='notice_promoted').length,1);
});

test('promoted recovery uses the current scalar telemetry sanitizer once without leaking local report data',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1000});issueDiagnostics.clear();
 const calls=[],observed=[];let timerId=0;
 const telemetry=createRecoveryTelemetry({budget:{windowStarted:null,batches:0},schedule:()=>++timerId,cancel(){},environment:()=>({visibility:'visible',online:true}),fetcher:async(path,init)=>{calls.push({path,init});return new Response(null,{status:202});}});
 const transport=createLiveTransportStore({storage:{getItem:()=> 'SECRET-owner',setItem(){}},onDiagnostic:event=>{observed.push(event);telemetry.record(event);},fetcher:()=>{throw Error('No request needed');}});
 t.after(()=>{transport.retire();telemetry.retire();issueDiagnostics.clear();});
 const gameId=`game-${'1'.repeat(36)}`;
 transport.applyLiveGameUpdate({game:{id:gameId,createdAt:'2026-01-01',updatedAt:'2026-01-01',gameplayRevision:0,board:{state:{pieces:[],sideToMove:'P1',turnIndex:0,authorization:'SECRET-board'}},moves:[],turns:[]},eventSeq:1});
 transport.setConnectionRecovering(gameId,true);await telemetry.flush();calls.length=0;observed.length=0;
 t.mock.timers.tick(15000);const before=transport.getGameViewModel(gameId);let emissions=0;const unsubscribe=transport.subscribe(()=>emissions++);t.after(unsubscribe);
 const id=transport.ensureRecoveryIncident(gameId);assert.ok(id);for(let i=0;i<10;i++)assert.equal(transport.ensureRecoveryIncident(gameId),id);
 assert.equal(observed.filter(event=>event.stage==='notice_promoted').length,1);assert.equal(emissions,0);
 const after=transport.getGameViewModel(gameId);for(const key of ['gameplayRevision','pendingCommandCount','sharedMutationsBlocked','gameplayMutationsBlocked','canRecordMove','recovering'])assert.equal(after[key],before[key]);
 await telemetry.flush();assert.equal(calls.length,1);
 const {init}=calls[0],body=JSON.parse(init.body);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(body.events.length,1);
 assert.equal(body.events[0].type,'recovery_blocked');assert.doesNotMatch(init.body,/SECRET|authoritativeState|tentativeState|identityId|fingerprint|gameLink/);
 assert.doesNotMatch(issueDiagnostics.text(id),/SECRET/);
});
