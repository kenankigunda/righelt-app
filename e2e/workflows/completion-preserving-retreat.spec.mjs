import {test as base,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {deterministicStateHash,resolveToStability,serializeState} from '../../apps/web/generated/packages/game-engine/src/index.js';
import {ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION,SYNC_TIMING,commandFingerprint,isSyncCommand,isReconcileResponse,isCommandOutcome} from '../../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import {importScenarioGame,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {waitForComputerDecision} from '../support/computer-projection.mjs';
import {isOperationRequest,operationValues} from '../support/shared-request.mjs';
import {makeRetreatScenario,readRetreatCapture,FOLLOW_ACTION,RETREAT_CAPTURE_SHA256} from '../support/retreat-completion-fixture.mjs';
import {installJournalObservations} from '../support/journal-observations.mjs';
import {COMPUTER_UI_FRAME_MEASURE} from '../../apps/web/shell/frame-presentation.js';

// Worker/bootstrap preparation has an explicit fixture budget. The receipt and
// native Follow journeys retain their complete existing 60-second body budget.
const test=base.extend({acceptedRetreat:[async({page,baseURL},use)=>{
 await use(await acceptedComputerRetreat(page,baseURL));
},{timeout:60000}]});

const f=readRetreatCapture(),safe=f.alternatives.find(row=>row.completable);
const computerRetreatWorkflow='the real computer defender records only the completion-preserving retreat';
const computerFollowWorkflow='the real computer retreat permits the completion-preserving automatic Follow';
// Read existing recorder and DOM only. Never drive recovery or submit work.
async function readRetreatDiagnostics(measurementName){
   const match=location.hash.match(/^#\/game\/([^?#/]+)/);
   if(!match)return{available:false,reason:'current-game-id-unavailable'};
   const gameId=decodeURIComponent(match[1]);
   // Live transport already imports this exact module. Read its current
   // in-memory incidents rather than waiting for localStorage persistence.
   const {issueDiagnostics}=await import('/shell/issue-diagnostics.js');
   const fields=['stage','code','operation','receipt','pendingCount','gameplayRevision','appliedEventSeq','advertisedEventSeq','at','generation','elapsedMs','deadlineMs'];
   const pick=value=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
   return{available:true,gameId,journal:window.retreatJournalObservations,presentation:performance.getEntriesByName(measurementName).at(-1)?.detail??null,historyRows:document.querySelectorAll('[data-testid="history-move-item"]').length,reports:issueDiagnostics.list().filter(report=>report.schemaVersion===1&&report.key===`recovery:${gameId}`).map(report=>({schemaVersion:1,startedAt:report.startedAt,resolvedAt:report.resolvedAt,initial:pick(report.initial),events:report.events.map(pick)}))};
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
test.afterEach(async({page},info)=>{
 if(info.status===info.expectedStatus){
  let timer;
  try{
   const journal=await Promise.race([page.evaluate(measurementName=>({...window.retreatJournalObservations,presentation:performance.getEntriesByName(measurementName).at(-1)?.detail??null}),COMPUTER_UI_FRAME_MEASURE),new Promise(resolve=>{timer=setTimeout(()=>resolve({unavailable:'diagnostic-read-timeout'}),2000);})]);
   const path=info.outputPath('native-journal-lifecycle.json');
   await writeFile(path,JSON.stringify(journal??{unavailable:'not-installed'}));
   await info.attach('native-journal-lifecycle',{contentType:'application/json',path});
  }catch{console.warn('[retreat-diagnostic] Journal lifecycle attachment unavailable.');}
  finally{clearTimeout(timer);}
  return;
 }
 if(!['failed','timedOut','interrupted'].includes(info.status))return;
 let snapshot,diagnosticTimer;
 try{
  snapshot=page.isClosed()?{available:false,reason:'page-closed'}:await Promise.race([page.evaluate(readRetreatDiagnostics,COMPUTER_UI_FRAME_MEASURE),new Promise(resolve=>{diagnosticTimer=setTimeout(()=>resolve({available:false,reason:'diagnostic-read-timeout'}),2000);})]);
 }catch(error){snapshot={available:false,reason:'diagnostic-read-unavailable',errorKind:String(error?.name??'Error').slice(0,80)};}
 finally{clearTimeout(diagnosticTimer);}
 try{
  const path=info.outputPath('local-recovery-incidents.json');await writeFile(path,JSON.stringify(snapshot));
  await info.attach('local-recovery-incidents',{contentType:'application/json',path});
 }
 catch{console.warn('[retreat-diagnostic] Diagnostic attachment unavailable; original test failure retained.');}
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
 return {outcome:own[0],game:body.game};
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
async function completedMandatoryFollow(page,id,retreatCommandId){
 await expect.poll(async()=>{
  const game=await current(page,id),index=game.moves.findIndex(move=>move.clientCommandId===retreatCommandId);
  return index>=0&&game.moves.slice(index+1).some(move=>move.action.type==='follow');
 }).toBe(true);
 const game=await current(page,id),index=game.moves.findIndex(move=>move.clientCommandId===retreatCommandId),retreat=game.moves[index];
 expect(retreat).toBeTruthy();expect(capturedHash(retreat.snapshot)).toBe(safe.stateHash);
 const follows=game.moves.slice(index+1).filter(move=>move.action.type==='follow');
 expect(follows).toHaveLength(1);expect(follows[0].action).toEqual(FOLLOW_ACTION);
 expect(follows[0].selectionSnapshot).toEqual(retreat.snapshot);expect(follows[0].computerProof??null).toBeNull();
 expect(follows[0].clientCommandId).not.toBe(retreatCommandId);
 // The next computer turn may already be running. Validate the exact accepted
 // follow frame rather than depending on the live board pausing at that frame.
 completed({board:{state:follows[0].snapshot}});return game;
}
function completed(game){
 expect(game.board.state.continuation).toBeNull();expect(game.board.state.outcome.status).toBe('ongoing');
 const stable=resolveToStability(game.board.state);
 for(const id of ['U2-11','U2-15'])expect(stable.pieces.find(piece=>piece.id===id)).toMatchObject({owner:'P2',supplied:true});
}

test('human retreat excludes the stranded square and automatically completes the mandatory Follow',async({page,baseURL},info)=>{
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
 const rejected=await request(page,`/api/shell/games/${gameId}/apply`,unsafe);expect(rejected.accepted).toBe(false);
 expect((await receipt(page,gameId,unsafe,'rejected')).outcome.reason).toBe('SUPPLY_DESTINATION_UNSUPPLIED');
 const unchanged=await current(page,gameId);expect(unchanged.board).toEqual(pushed.board);expect(unchanged.gameplayRevision).toBe(pushed.gameplayRevision);expect(unchanged.moves).toEqual(pushed.moves);
 // The rejected decision publishes the unchanged authoritative position and
 // restores its mandatory actor. Clicking during that publication can arrive
 // after restoration and deliberately cycle the selected piece's overlay.
 await expect(cell(page,safe.action.from)).toHaveClass(/(?:^|\s)source(?:\s|$)/);
 const {command:retreatCommand}=await submit(page,gameId,safe.action);
 await completedMandatoryFollow(page,gameId,retreatCommand.clientCommandId);
 await expect(page.locator('[data-board-message-action="replay-push-sequence"]')).toBeVisible();
 await page.screenshot({path:info.outputPath('safe-retreat-follow-completed.png')});
 await info.attach('captured-retreat-provenance',{body:JSON.stringify({sha256:RETREAT_CAPTURE_SHA256,provenance:f.provenance,unsafe,receipt:rejected.commandOutcomes},null,2),contentType:'application/json'});
});

async function acceptedComputerRetreat(page,baseURL){
 // This source exists only to branch its recorded decision. Open the actual
 // computer game once, avoiding an unused source runtime and journal lifecycle.
 const {gameId:sourceId}=await importScenarioGame(page,makeRetreatScenario('computer'),baseURL,{open:false});
 const source=await current(page,sourceId);expect(capturedHash(source.board.state)).toBe(safe.stateHash);
 const sourceDecisionId=source.moves.at(-1).moveId;
 const branched=(await request(page,'/api/shell/history/branch',{sourceGameId:sourceId,sourceDecisionId,creatorSide:'p2',computer:{p1:'babs',p2:null},computerModelId:'initial-1554'})).game;
 expect(branched.computer.modelId).toBe('initial-1554');expect(branched.computer.seats).toEqual({p1:'babs',p2:null});
 expect(capturedHash(branched.board.state)).toBe(f.push.afterHash);expect(branched.legalActions).toEqual([safe.action]);
 const sent=page.waitForRequest(req=>req.method()==='POST'&&new URL(req.url()).pathname===`/api/shell/games/${branched.id}/apply`&&Boolean(req.postDataJSON()?.payload?.computer));
 await page.goto(`${baseURL}/#/game/${encodeURIComponent(branched.id)}`);await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',branched.id);
 const accepted=await waitForComputerDecision(page,branched.id,'babs',{guest:true,modelId:'initial-1554'}),command=(await sent).postDataJSON();
 expect(command.payload.action).toEqual(safe.action);await receipt(page,branched.id,command);
 const move=accepted.moves.find(row=>row.clientCommandId===command.clientCommandId);expect(move).toBeTruthy();
 expect(move.action).toEqual(safe.action);expect(move.retreatSemantics).toBe('completion-preserving-retreat-v2');expect(move.computerProof).toEqual(command.payload.computer);
 expect(capturedHash(move.selectionSnapshot)).toBe(f.push.afterHash);expect(capturedHash(move.snapshot)).toBe(safe.stateHash);
 expect(command.expectedState).toEqual(branched.board.state);expect(move.selectionSnapshot).toEqual(branched.board.state);
 return {branched,command,move};
}

// Evidence persistence and live completion are independent journeys. Keep each
// within its existing 60s body budget after separately bounded worker preparation.
test(computerRetreatWorkflow,async({page,acceptedRetreat},info)=>{
 const {branched,command,move}=acceptedRetreat;
 const attempt=(await request(page,`/api/shell/games/${branched.id}/decision-attempt`,{attemptId:move.computerProof.attemptId,kind:'computer'})).attempt;
 expect(attempt.proof).toEqual(move.computerProof);expect(attempt.fingerprint).toBe(deterministicStateHash(branched.board.state));expect(attempt.result.status).toBe('ready');expect(attempt.result.action).toEqual(safe.action);
 expect(attempt.result.legality).toMatchObject({complete:true,unknown:0,indices:[1144]});expect(attempt.result.actionIndex).toBe(1144);
 const archive=await request(page,`/api/shell/games/${branched.id}/decision-history`,{});expect(archive.items.some(item=>item.id===move.moveId)).toBe(true);
 await switchGamePanel(page,'board');
 await page.screenshot({path:info.outputPath('computer-safe-retreat-evidence.png')});
 await info.attach('accepted-computer-retreat',{body:JSON.stringify({command,move,attempt},null,2),contentType:'application/json'});
});

test(computerFollowWorkflow,async({page,acceptedRetreat},info)=>{
 const {branched,command,move}=acceptedRetreat;
 await switchGamePanel(page,'board');
 await completedMandatoryFollow(page,branched.id,command.clientCommandId);
 await page.screenshot({path:info.outputPath('computer-safe-retreat-follow-completed.png')});
 await info.attach('accepted-computer-follow-source',{body:JSON.stringify({command,move},null,2),contentType:'application/json'});
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
 await expect(exactRow).toHaveCount(1);await exactRow.locator('.history-item-info').click();await expect(page.getByTestId('history-inline-preview')).toBeVisible();
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
