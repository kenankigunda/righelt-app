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
