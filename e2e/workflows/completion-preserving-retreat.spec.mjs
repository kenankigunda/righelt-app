import {installCaseReadiness,finishCaseReadiness,attachNodeReadiness} from '../support/readiness-diagnostics.mjs';
import {performance} from 'node:perf_hooks';
import {installClientSettlementObserver} from '../support/client-settlement-observer.mjs';
import {installBoardAdmissionDiagnostics,createComputerRecoveryJSONRead,readComputerRecoverySnapshot,runComputerRecoveryPersistence,COMPUTER_RECOVERY_FIXTURE_BUDGET_MS} from '../support/board-admission-diagnostics.mjs';
import {test as base,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {deterministicStateHash,resolveToStability,serializeState} from '../../apps/web/generated/packages/game-engine/src/index.js';
import {ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION,SYNC_TIMING,commandFingerprint,isSyncCommand,isReconcileResponse,isCommandOutcome} from '../../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import {importScenarioGame,submitPlayableAction,switchGamePanel,ensureActionActorSelected} from '../support/app.mjs';
import {waitForComputerDecision} from '../support/computer-projection.mjs';
import {isOperationRequest,operationValues} from '../support/shared-request.mjs';
import {makeRetreatScenario,readRetreatCapture,FOLLOW_ACTION,RETREAT_CAPTURE_SHA256} from '../support/retreat-completion-fixture.mjs';
import {installJournalObservations} from '../support/journal-observations.mjs';
import {COMPUTER_UI_FRAME_MEASURE} from '../../apps/web/shell/frame-presentation.js';

// Worker/bootstrap preparation has an explicit fixture budget. The receipt and
// native Follow journeys retain their complete existing 60-second body budget.
const test=base.extend({
 computerRecoveryAdmission:[async({page,baseURL},use,info)=>{
  if(![computerRetreatWorkflow,computerFollowWorkflow].includes(info.title)){await use();return;}
  const setupStarted=performance.now();
  const diagnostic=await installBoardAdmissionDiagnostics(page,info,{baseURL,computerSessionRecovery:true});
  const setupElapsedMs=performance.now()-setupStarted;
  try{await use(diagnostic);}finally{await runComputerRecoveryPersistence(diagnostic,{setupElapsedMs});}
 },{timeout:COMPUTER_RECOVERY_FIXTURE_BUDGET_MS}],
 // Shared 5s fixture slot covers setup AND teardown, separate from the 60s body.
 // Depending on page makes this persistence precede base-page teardown.
 humanAdmission:[async({page,baseURL},use,testInfo)=>{
  if(testInfo.title!=='human retreat excludes the stranded square and automatically completes the mandatory Follow')throw Error('Human admission fixture title mismatch');
  const settlement=await installClientSettlementObserver(page,testInfo);
  const diagnostic=await installBoardAdmissionDiagnostics(page,testInfo,{baseURL,targetRow:3,targetCol:0,moduleTransform:settlement.transform});
  try{await use(settlement);}finally{
   const saved=await Promise.allSettled([settlement.persist(),diagnostic.persist()]);
   const failed=saved.find(result=>result.status==='rejected');
   if(failed){if(testInfo.status===testInfo.expectedStatus)throw failed.reason;console.error('[board-admission-diagnostic] fixture-persistence-incomplete');}
  }
 },{timeout:5000}],readinessMeasurement:[async({context,baseURL},use,info)=>{
 if(info.title!==computerFollowWorkflow){await use();return;}
 const dispose=await installCaseReadiness(context,baseURL);
 try{await use();}finally{await finishCaseReadiness(dispose,info);}
},{auto:true}],acceptedRetreat:[async({page,baseURL,computerRecoveryAdmission},use,info)=>{
 const accepted=await acceptedComputerRetreat(page,baseURL,computerRecoveryAdmission,{captureFollow:info.title===computerFollowWorkflow});
 try{await use(accepted);if(info.status===info.expectedStatus)accepted.followCapture?.assertSingle();}
 finally{accepted.followCapture?.dispose();}
},{timeout:60000}],
 followEvidence:[async({page},use,info)=>{
 let evidence;
 await use(value=>{evidence=value;});
 if(!evidence)return;
 await page.screenshot({path:info.outputPath('computer-safe-retreat-follow-completed.png')});
 await info.attach('accepted-computer-follow-source',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
},{timeout:20000}]});


const f=readRetreatCapture(),safe=f.alternatives.find(row=>row.completable);
const computerRetreatWorkflow='the real computer defender records only the completion-preserving retreat';
const computerFollowWorkflow='the real computer retreat permits the completion-preserving automatic Follow';
// Read existing recorder and DOM only. Never drive recovery or submit work.
async function readRetreatDiagnostics(input){
   const {measurementName,recoveryRead}=typeof input==='string'?{measurementName:input}:input;
   let readinessPage;
   try{readinessPage=globalThis.__righeltReadinessFreeze?.();}catch{readinessPage={incomplete:true,reason:'snapshot-unavailable'};}

   const match=location.hash.match(/^#\/game\/([^?#/]+)/);
   if(!match)return{available:false,reason:'current-game-id-unavailable',...(readinessPage?{readinessPage}:{})};
   const gameId=decodeURIComponent(match[1]);
   // Live transport already imports this exact module. Read its current
   // in-memory incidents rather than waiting for localStorage persistence.
   const {issueDiagnostics}=await import('/shell/issue-diagnostics.js');
   const fields=['stage','code','operation','receipt','pendingCount','gameplayRevision','appliedEventSeq','advertisedEventSeq','at','generation','elapsedMs','deadlineMs'];
   const pick=value=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
   return{available:true,gameId,...(recoveryRead?{boardRecovery:{...recoveryRead,gameId,documentNonce:globalThis.__boardAdmissionRecoveryDocument??null,timeOrigin:performance.timeOrigin,observation:globalThis.__boardAdmissionObservation??null}}:{}),...(readinessPage?{readinessPage}:{}),journal:window.retreatJournalObservations,presentation:performance.getEntriesByName(measurementName).at(-1)?.detail??null,historyRows:document.querySelectorAll('[data-testid="history-move-item"]').length,reports:issueDiagnostics.list().filter(report=>report.schemaVersion===1&&report.key===`recovery:${gameId}`).map(report=>({schemaVersion:1,startedAt:report.startedAt,resolvedAt:report.resolvedAt,initial:pick(report.initial),events:report.events.map(pick)}))};
}

// Capture identity is explicitly minimal-artifact. Search and command
// fingerprints below retain the exact full authoritative state instead.
const capturedHash=state=>{
 const minimal=resolveToStability(structuredClone(state),{artifactMode:'minimal'});
 const originalCore=JSON.parse(serializeState(state)),minimalCore=JSON.parse(serializeState(minimal));
 delete originalCore.artifacts;delete minimalCore.artifacts;
 expect(minimalCore,'Capture-domain conversion must preserve every non-artifact authoritative field').toEqual(originalCore);
 return deterministicStateHash(minimal);
};
const board=page=>page.getByTestId('game-board');
const cell=(page,at)=>board(page).locator(`.cell[data-row="${at.row}"][data-col="${at.col}"]`);
test.beforeEach(async({page})=>{await page.addInitScript(installJournalObservations);});
test.afterEach(async({page,computerRecoveryAdmission},info)=>{
 const finalRecovery=computerRecoveryAdmission?.finalRecoveryHandoff;
 let recoveryRead,delivered=false;
 try{recoveryRead=finalRecovery?.begin(page,{bindingDelivery:info.status===info.expectedStatus});}catch(error){finalRecovery?.failed('read-missing');throw error;}
 const deliver=value=>{
  if(!finalRecovery)return;
  delivered=true;
  if(value?.unavailable==='diagnostic-read-timeout'||value?.reason==='diagnostic-read-timeout')finalRecovery.journalTimedOut();
  else if(!value?.boardRecovery)finalRecovery.failed('read-missing');
 };
 if(info.status===info.expectedStatus){
  let timer,originalCall,primaryReadError;
  try{
   originalCall=finalRecovery?finalRecovery.startBindingRead(page):page.evaluate(createComputerRecoveryJSONRead(readComputerRecoverySnapshot),{measurementName:COMPUTER_UI_FRAME_MEASURE,recoveryRead}).then(JSON.parse);
   originalCall.catch(()=>{}); // Own every same-hook transport failure immediately.
   const originalRead=originalCall;
   const journal=await Promise.race([originalRead,new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:'diagnostic-read-timeout'}),2000);})]);
   deliver(journal);
   const path=info.outputPath('native-journal-lifecycle.json');
   await writeFile(path,JSON.stringify(attachNodeReadiness(journal??{unavailable:'not-installed'})));
   await info.attach('native-journal-lifecycle',{contentType:'application/json',path});
  }catch(error){primaryReadError=error;finalRecovery?.failed('read-failed');console.warn('[retreat-diagnostic] Journal lifecycle attachment unavailable.');if(info.title===computerFollowWorkflow)console.warn('[readiness] incomplete: first-read-or-persistence-unavailable');if(finalRecovery)throw error;}
  finally{clearTimeout(timer);
   // Payload AND browser-publisher completion share the original absolute2s.
   // Await the original public configuration settlement in this SAME hook
   // before the unchanged5s persistence fixture can consume the evidence.
   if(finalRecovery&&originalCall){
    const failures=primaryReadError?[primaryReadError]:[];
    try{await originalCall;}catch(error){if(!failures.includes(error))failures.push(error);}
    try{await finalRecovery.completeOriginalRead();}catch(error){if(!failures.includes(error))failures.push(error);}
    if(failures.length){finalRecovery.failed('read-failed');if(failures.length===1)throw failures[0];throw new AggregateError(failures,'Final recovery delivery, configuration and cleanup failed');}
   }
  }
  return;
 }
 if(!['failed','timedOut','interrupted'].includes(info.status))return;
 let snapshot,diagnosticTimer;
 try{
  const originalRead=page.isClosed()?null:page.evaluate(readRetreatDiagnostics,{measurementName:COMPUTER_UI_FRAME_MEASURE,recoveryRead});
  if(originalRead)finalRecovery?.retain(page,originalRead);
  snapshot=originalRead?await Promise.race([originalRead,new Promise(resolve=>{diagnosticTimer=setTimeout(()=>resolve({available:false,reason:'diagnostic-read-timeout'}),2000);})]):{available:false,reason:'page-closed'};
 }catch(error){snapshot={available:false,reason:'diagnostic-read-unavailable',errorKind:String(error?.name??'Error').slice(0,80)};}
 finally{clearTimeout(diagnosticTimer);}
 deliver(snapshot);
 snapshot=attachNodeReadiness(snapshot);
 try{
  const path=info.outputPath('local-recovery-incidents.json');await writeFile(path,JSON.stringify(snapshot));
  await info.attach('local-recovery-incidents',{contentType:'application/json',path});
 }
 catch{console.warn('[retreat-diagnostic] Diagnostic attachment unavailable; original test failure retained.');if(info.title===computerFollowWorkflow)console.warn('[readiness] incomplete: persistence-unavailable');}
 if(![computerRetreatWorkflow,computerFollowWorkflow].includes(info.title)||!snapshot?.available)return;
 const started=Date.now(),maximumDrainMs=20000,samples=[];
 while(Date.now()-started<maximumDrainMs&&!page.isClosed()){
  let timer;
  try{
   const sample=await Promise.race([
    page.evaluate(readRetreatDiagnostics,COMPUTER_UI_FRAME_MEASURE).then(value=>({ok:true,value}),()=>({ok:false,reason:'diagnostic-read-unavailable'})),
    new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,reason:'diagnostic-read-timeout'}),Math.min(2000,maximumDrainMs-(Date.now()-started)));}),
   ]);
   samples.push({elapsedMs:Date.now()-started,...sample});
   if(!sample.ok)break; // Never overlap an unresolved browser read.
  }finally{clearTimeout(timer);}
  const remaining=maximumDrainMs-(Date.now()-started);
  if(remaining>0)await new Promise(resolve=>setTimeout(resolve,Math.min(1000,remaining)));
 }
 try{
  const path=info.outputPath('failed-retreat-drain.json');
  await writeFile(path,JSON.stringify({diagnosticOnly:true,originalStatus:info.status,maximumDrainMs,elapsedMs:Date.now()-started,samples}));
  await info.attach('failed-retreat-drain',{contentType:'application/json',path});
 }catch{console.warn('[retreat-diagnostic] Drain attachment unavailable; original test failure retained.');}
});
async function request(page,route,body){
 const result=await page.evaluate(async({route,body,header,version})=>{
  const identityId=localStorage.getItem('righelt.identity.id.v1');if(!identityId)throw Error('Native fixture identity missing');
  const response=await fetch(body===undefined?`${route}?identityId=${encodeURIComponent(identityId)}`:route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',[header]:String(version)},...(body===undefined?{}:{body:JSON.stringify({protocolVersion:2,identityId,...body})})});
  return {status:response.status,body:await response.json()};
 },{route,body,header:ACTION_CONTRACT_HEADER,version:ACTION_CONTRACT_VERSION});
 expect(result.status).toBe(200);expect(result.body.ok).toBe(true);return result.body;
}
const current=async(page,id)=>(await request(page,`/api/shell/games/${id}`)).game;
async function atHash(page,id,hash){
 await expect.poll(async()=>capturedHash((await current(page,id)).board.state)).toBe(hash);
 return current(page,id);
}
async function receipt(page,id,command,outcome='accepted'){
 expect(isSyncCommand(command)).toBe(true);
 // Current shared Undo envelopes omit this optional gameplay version. Actual
 // action commands must advertise the new retreat contract exactly.
 expect(command.actionContractVersion).toBe(command.kind==='shared'?undefined:3);
 expect(command.gameId).toBe(id);expect(await commandFingerprint(command)).toBe(command.fingerprint);
 let body;
 await expect.poll(async()=>{
  body=await request(page,`/api/shell/games/${id}/reconcile`,{knownSnapshotEventSeq:0,commands:[command]});
  expect(isReconcileResponse(body,id,[command])).toBe(true);
  return body.commandOutcomes.find(row=>row.clientCommandId===command.clientCommandId)?.outcome;
 },{timeout:SYNC_TIMING.confirmationBudgetMs}).toBe(outcome);
 const own=body.commandOutcomes.filter(row=>row.clientCommandId===command.clientCommandId);expect(own).toHaveLength(1);
 expect(isCommandOutcome(own[0],command)).toBe(true);
 expect(own[0]).toMatchObject({outcome,fingerprint:command.fingerprint,identityId:command.identityId});
 expect(body.game?.id).toBe(id);expect(body.game.gameplayRevision).toBe(body.gameplayRevision);
 if(outcome==='accepted')expect(own[0].gameplayRevision).toBe(body.gameplayRevision);
 return {outcome:own[0],game:body.game,eventSeq:body.eventSeq};
}
async function submit(page,id,action){
 const sent=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===`/api/shell/games/${id}/apply`);
 await submitPlayableAction(page,action);const command=(await sent).postDataJSON();expect(command.payload.action).toEqual(action);
 const acknowledged=await receipt(page,id,command);return {command,game:acknowledged.game};
}
async function claimBoth(page){
 await switchGamePanel(page,'players');
 const control=page.locator('[data-action="play-as-both-players"]');await expect(control).toBeVisible();await control.click();
 await expect(page.getByTestId('game-role')).toContainText('both');await switchGamePanel(page,'board');
}
async function noClosure(page,game){
 expect(game.canEndTurn).toBe(false);expect(game.legalActions.some(a=>a.type==='pass'||a.type==='end_turn')).toBe(false);
 await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-action="end-turn"],[data-board-preview-action="end-turn"]').filter({visible:true})).toHaveCount(0);
}
// Passive observation only: never intercept, synthesize or resend a command.
function captureMandatoryFollow(page,id){
 const commands=[];
 const observe=req=>{
  if(req.method()!=='POST'||new URL(req.url()).pathname!==`/api/shell/games/${id}/apply`)return;
  const command=req.postDataJSON();
  if(command?.payload?.action?.type==='follow')commands.push(command);
 };
 page.on('request',observe);
 return {commands,
  assertSingle(){expect(commands,'Exactly one native Follow command must be observed').toHaveLength(1);},
  dispose(){page.off('request',observe);}};
}
async function completedMandatoryFollow(page,id,retreatCommandId,capture){
 // Preserve the original 10s observation budget and the unchanged main receipt
 // contract. The same accepted reconciliation supplies every final-frame check.
 await expect.poll(()=>capture.commands.length,{timeout:10000}).toBe(1);
 capture.assertSingle();
 const command=capture.commands[0];
 expect(command.gameId).toBe(id);expect(command.kind).toBe('action');
 expect(command.payload.action).toEqual(FOLLOW_ACTION);
 expect(command.payload.computer).toBeUndefined();
 expect(command.clientCommandId).not.toBe(retreatCommandId);
 const acknowledged=await receipt(page,id,command);
 capture.assertSingle();
 const game=acknowledged.game,index=game.moves.findIndex(move=>move.clientCommandId===retreatCommandId),retreat=game.moves[index];
 expect(retreat).toBeTruthy();expect(capturedHash(retreat.snapshot)).toBe(safe.stateHash);
 const follows=game.moves.slice(index+1).filter(move=>move.action.type==='follow');
 expect(follows).toHaveLength(1);expect(follows[0].action).toEqual(FOLLOW_ACTION);
 expect(follows[0].clientCommandId).toBe(command.clientCommandId);
 expect(follows[0].selectionSnapshot).toEqual(retreat.snapshot);expect(follows[0].computerProof??null).toBeNull();
 expect(follows[0].clientCommandId).not.toBe(retreatCommandId);
 expect(game.board.state).toEqual(follows[0].snapshot);
 completed(game);completed({board:{state:follows[0].snapshot}});return game;
}
function completed(game){
 expect(game.board.state.continuation).toBeNull();expect(game.board.state.outcome.status).toBe('ongoing');
 const stable=resolveToStability(game.board.state);
 for(const id of ['U2-11','U2-15'])expect(stable.pieces.find(piece=>piece.id===id)).toMatchObject({owner:'P2',supplied:true});
}

test('human retreat excludes the stranded square and automatically completes the mandatory Follow',async({page,baseURL,humanAdmission},info)=>{
 const {gameId}=await importScenarioGame(page,makeRetreatScenario('human'),baseURL);await claimBoth(page);
 await atHash(page,gameId,f.push.beforeHash);await submit(page,gameId,f.push.action);
 const pushed=await atHash(page,gameId,f.push.afterHash);expect(pushed.legalActions).toEqual([safe.action]);await noClosure(page,pushed);
 expect(pushed.board.state.pieces.some(piece=>piece.id==='U1-28')).toBe(true);
 // Exercise the real invalid target with native events. A blocked preview may
 // explain the rule, but it must never submit a gameplay command.
 const wrong=[];const observe=req=>{if(req.method()==='POST'&&new URL(req.url()).pathname===`/api/shell/games/${gameId}/apply`)wrong.push(req.postDataJSON());};
 page.on('request',observe);
 try{
  await expect(cell(page,f.retreat.action.to)).not.toHaveClass(/(?:^|\s)target(?:\s|$)/);
  await cell(page,f.retreat.action.to).hover();await expect(cell(page,f.retreat.action.to)).not.toHaveClass(/(?:^|\s)target(?:\s|$)/);
  await cell(page,f.retreat.action.to).click();await cell(page,f.retreat.action.to).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(wrong).toEqual([]);await atHash(page,gameId,f.push.afterHash);
 }finally{page.off('request',observe);}
 const identityId=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
 const unsafe={protocolVersion:2,actionContractVersion:3,gameId,identityId,clientCommandId:`v2:${crypto.randomUUID()}`,kind:'action',payload:{action:f.retreat.action},expectedState:pushed.board.state,expectedGameplayRevision:pushed.gameplayRevision};
 unsafe.fingerprint=await commandFingerprint(unsafe);
 const clientScope=await humanAdmission.scope(gameId);
 const rejected=await request(page,`/api/shell/games/${gameId}/apply`,unsafe);expect(rejected.accepted).toBe(false);
 const settlementDeadline=performance.now()+SYNC_TIMING.confirmationBudgetMs;
 const rejectedReceipt=await receipt(page,gameId,unsafe,'rejected');expect(rejectedReceipt.outcome.reason).toBe('SUPPLY_DESTINATION_UNSUPPLIED');
 const unchangedResponse=await request(page,`/api/shell/games/${gameId}`),unchanged=unchangedResponse.game;expect(unchanged.board).toEqual(pushed.board);expect(unchanged.gameplayRevision).toBe(pushed.gameplayRevision);expect(unchanged.moves).toEqual(pushed.moves);
 const rejectedOutcomes=rejected.commandOutcomes.filter(row=>row.clientCommandId===unsafe.clientCommandId);expect(rejectedOutcomes).toHaveLength(1);expect(isCommandOutcome(rejectedOutcomes[0],unsafe)).toBe(true);
 const knownSeqs=[rejected.eventSeq,rejectedOutcomes[0].eventSeq,rejectedReceipt.eventSeq,rejectedReceipt.outcome.eventSeq,unchangedResponse.eventSeq];
 expect(knownSeqs.every(value=>Number.isSafeInteger(value)&&value>=0)).toBe(true);
 await humanAdmission.wait(clientScope,Math.max(...knownSeqs),settlementDeadline);
 // Clicking an empty unhighlighted square deliberately clears selection.
 // Resume through the actual pushed-piece control before selecting its move.
 await ensureActionActorSelected(cell(page,safe.action.from));
 const followCapture=captureMandatoryFollow(page,gameId);
 try{
 const retreatCommand=await submit(page,gameId,safe.action);
 await completedMandatoryFollow(page,gameId,retreatCommand.command.clientCommandId,followCapture);
 await expect(page.locator('[data-board-context]').filter({hasText:'Push sequence'}).getByRole('button',{name:'Show me again',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('safe-retreat-follow-completed.png')});
 await info.attach('captured-retreat-provenance',{body:JSON.stringify({sha256:RETREAT_CAPTURE_SHA256,provenance:f.provenance,unsafe,receipt:rejected.commandOutcomes},null,2),contentType:'application/json'});
 followCapture.assertSingle();
 }finally{followCapture.dispose();}
});

async function acceptedComputerRetreat(page,baseURL,computerRecoveryAdmission,{captureFollow=false}={}){
 // This source exists only to branch its recorded decision. Open the actual
 // computer game once, avoiding an unused source runtime and journal lifecycle.
 const {gameId:sourceId}=await importScenarioGame(page,makeRetreatScenario('computer'),baseURL,{open:false});
 const source=await current(page,sourceId);expect(capturedHash(source.board.state)).toBe(safe.stateHash);
 const sourceDecisionId=source.moves.at(-1).moveId;
 const branched=(await request(page,'/api/shell/history/branch',{sourceGameId:sourceId,sourceDecisionId,creatorSide:'p2',computer:{p1:'babs',p2:null},computerModelId:'initial-1554'})).game;
 computerRecoveryAdmission.finalRecoveryHandoff.bindGame(branched.id);
 expect(branched.computer.modelId).toBe('initial-1554');expect(branched.computer.seats).toEqual({p1:'babs',p2:null});
 expect(capturedHash(branched.board.state)).toBe(f.push.afterHash);expect(branched.legalActions).toEqual([safe.action]);
 const sent=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===`/api/shell/games/${branched.id}/apply`&&Boolean(req.postDataJSON()?.payload?.computer));
 const followCapture=captureFollow?captureMandatoryFollow(page,branched.id):null;
 try{
 await page.goto(`${baseURL}/#/game/${encodeURIComponent(branched.id)}`);await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',branched.id);
 const accepted=await waitForComputerDecision(page,branched.id,'babs',{guest:true,modelId:'initial-1554'}),command=(await sent).postDataJSON();
 expect(command.payload.action).toEqual(safe.action);
 const move=accepted.moves.find(row=>row.clientCommandId===command.clientCommandId);expect(move).toBeTruthy();
 expect(move.action).toEqual(safe.action);expect(move.retreatSemantics).toBe('completion-preserving-retreat-v2');expect(move.computerProof).toEqual(command.payload.computer);
 expect(capturedHash(move.selectionSnapshot)).toBe(f.push.afterHash);expect(capturedHash(move.snapshot)).toBe(safe.stateHash);
 expect(command.expectedState).toEqual(branched.board.state);expect(move.selectionSnapshot).toEqual(branched.board.state);
 return {branched,command,move,followCapture};
 }catch(error){followCapture?.dispose();throw error;}
}

// Evidence persistence and live completion are independent journeys. Keep each
// within their unchanged 60s bodies after separately bounded worker preparation.
test(computerRetreatWorkflow,async({page,acceptedRetreat},info)=>{
 const {branched,command,move}=acceptedRetreat;
 await receipt(page,branched.id,command);
 const attempt=(await request(page,`/api/shell/games/${branched.id}/decision-attempt`,{attemptId:move.computerProof.attemptId,kind:'computer'})).attempt;
 expect(attempt.proof).toEqual(move.computerProof);expect(attempt.fingerprint).toBe(deterministicStateHash(branched.board.state));expect(attempt.result.status).toBe('ready');expect(attempt.result.action).toEqual(safe.action);
 expect(attempt.result.legality).toMatchObject({complete:true,unknown:0,indices:[1144]});expect(attempt.result.actionIndex).toBe(1144);
 const archive=await request(page,`/api/shell/games/${branched.id}/decision-history`,{});expect(archive.items.some(item=>item.id===move.moveId)).toBe(true);
 await info.attach('accepted-computer-retreat',{body:JSON.stringify({command,move,attempt},null,2),contentType:'application/json'});
});

test(computerFollowWorkflow,async({page,acceptedRetreat,followEvidence})=>{
 const {branched,command,move,followCapture}=acceptedRetreat;
 await receipt(page,branched.id,command);
 await switchGamePanel(page,'board');
 await completedMandatoryFollow(page,branched.id,command.clientCommandId,followCapture);
 followEvidence({command,move});
});

test('a retained stranded Follow stays ongoing and its move-row Undo restores live Board',async({page,baseURL},info)=>{
 await page.setViewportSize({width:390,height:740});
 const {gameId}=await importScenarioGame(page,makeRetreatScenario('retained'),baseURL);await claimBoth(page);
 const retained=await atHash(page,gameId,f.retreat.afterHash);
 expect(retained.board.state.outcome.status).toBe('ongoing');expect(retained.board.state.continuation.phase).toBe('follow');expect(retained.legalActions).toEqual([]);
 expect(retained.board.state.pieces.some(piece=>piece.id==='U1-28')).toBe(true);await noClosure(page,retained);
 expect(retained.moves.map(move=>move.action)).toEqual([f.push.action,f.retreat.action]);expect(retained.moves.map(move=>move.retreatSemantics)).toEqual(['geometric-retreat-v1','geometric-retreat-v1']);
 await page.screenshot({path:info.outputPath('retained-stranded-follow.png')});
 const target=retained.moves.at(-1);await switchGamePanel(page,'history');
 // The immutable row identity remains available when the action markup changes.
 const exactRow=page.locator(`[data-testid="history-move-item"][data-move-id="${target.moveId}"]`);
 await expect(exactRow).toHaveCount(1);await exactRow.locator(':scope > .history-move-hit').click();await expect(page.getByTestId('history-inline-preview')).toBeVisible();
 const sent=page.waitForRequest(req=>isOperationRequest(req,'revert-request'));
 await exactRow.locator('[data-action="revert-to-move"]').click();const nativeRequest=await sent,command=nativeRequest.postDataJSON();
 expect(command.kind).toBe('shared');expect(command.payload.operation).toBe('revert-request');expect(operationValues(nativeRequest).targetMoveId).toBe(target.moveId);
 expect(command.expectedGameplayRevision).toBe(retained.gameplayRevision);expect(command.expectedState).toEqual(retained.board.state);
 await receipt(page,gameId,command);
 const restored=await atHash(page,gameId,f.push.afterHash);expect(restored.lastRestoration.decisionId).toBe(target.moveId);expect(restored.legalActions).toEqual([safe.action]);
 expect(restored.moves.map(move=>move.moveId)).toEqual(retained.moves.map(move=>move.moveId));expect(restored.moves.find(move=>move.moveId===target.moveId).undone).toBe(true);
 expect(restored.moves.map(move=>move.action)).toEqual(retained.moves.map(move=>move.action));expect(restored.board.state.pieces.some(piece=>piece.id==='U1-28')).toBe(true);
 await expect(page.locator('[data-action="switch-game-panel"][data-panel="board"]')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);
 await expect(board(page)).toBeVisible();await page.screenshot({path:info.outputPath('stranded-undo-restores-live.png')});
 await info.attach('retained-undo-receipt',{body:JSON.stringify({command,originalMoves:retained.moves,restoration:restored.lastRestoration},null,2),contentType:'application/json'});
});
