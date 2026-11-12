import {test as base,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {importScenarioGame} from '../support/app.mjs';
import {installInitialLoadReplacement,validateInitialLoadObservation,readInitialLoadObservation,settleInitialLoadResources} from '../support/initial-load-replacement.mjs';
import {SYNC_TIMING} from '../../packages/shared-types/src/sync-protocol.ts';
const test=base.extend({initialLoadInverseRecipe:[null,{option:true}]});
const initialState=JSON.parse(readFileSync(new URL('../../packages/game-engine/test/fixtures/game-loading-rush.json',import.meta.url),'utf8'));
const expectedPieces=initialState.pieces.map(piece=>({id:piece.id,row:piece.position.row,col:piece.position.col})).sort((a,b)=>a.id.localeCompare(b.id));
const boardPieces=page=>page.getByTestId('game-board').locator('[data-piece-id]').evaluateAll(nodes=>nodes.map(node=>({id:node.getAttribute('data-piece-id'),row:Number(node.closest('.cell').dataset.row),col:Number(node.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)));
const scenario={formatVersion:2,id:'85241980-65fc-4b88-b978-c42726181040',title:'Saved board search regression',description:'Exact saved rules position',incorrect:false,initialState,moves:[],resultingState:initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'};
test('initial position-first load accepts a browser pageshow replacement without a false load failure',async({page,context,baseURL,initialLoadInverseRecipe},info)=>{
 let owner,primary=null,observation=null,relay=null,expected=null,documentNonce=null;const failureCaptureErrors=[];
 const imported=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/shell/scenarios/import');imported.catch(()=>{});
 try{
  const{gameId,gameHash}=await importScenarioGame(page,scenario,baseURL,{open:false});const response=await imported;expect(response.status()).toBe(200);expected=await response.json();expect(expected.game.id).toBe(gameId);expect(expected.game.currentSnapshot.pieces.map(piece=>({id:piece.id,row:piece.position.row,col:piece.position.col})).sort((a,b)=>a.id.localeCompare(b.id))).toEqual(expectedPieces);expect(expected.game.myRole).toBe('Player 2');
  owner=await installInitialLoadReplacement(page,{baseURL,gameId,eventSeq:expected.eventSeq,identityId:response.request().postDataJSON().identityId,engine:info.project.name,inverseRecipe:initialLoadInverseRecipe});
  await page.goto(`/?initial-load-replacement=${encodeURIComponent(gameId)}${gameHash}`,{waitUntil:'domcontentloaded'});
  await expect.poll(()=>{owner.assertHealthy();return owner.snapshot().assetRequested;}).toBe(true);await expect.poll(()=>{owner.assertHealthy();return owner.snapshot().sockets[0]?.hasStateSync;}).toBe(true);
  await expect(page.getByTestId('game-board').locator('[data-piece-id]')).toHaveCount(initialState.pieces.length);await expect.poll(()=>boardPieces(page)).toEqual(expectedPieces);
  const wrap=page.getByTestId('game-board-wrap');await expect(wrap).toHaveAttribute('aria-busy','true');await owner.position();
  const before=await page.evaluate(()=>globalThis.__initialLoadReplacementObservation.snapshot());validateInitialLoadObservation(before,{beforeRelease:true,requestMs:SYNC_TIMING.requestTimeoutMs});documentNonce=before.documentNonce;
  owner.releaseAsset();
  await expect.poll(()=>{owner.assertHealthy();return owner.snapshot().rows.some(row=>row.kind==='real-reconcile200-held');}).toBe(true);await expect.poll(()=>{owner.assertHealthy();return owner.snapshot().replacementReady;}).toBe(true);
  owner.releaseReplacement();await expect.poll(()=>{owner.assertHealthy();return owner.snapshot().readCancelled;}).toBe(true);owner.releaseRead();await expect.poll(()=>{owner.assertHealthy();return owner.snapshot().readHandled;}).toBe(true);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',gameId);await expect(page.getByTestId('position-load-error')).toHaveCount(0);
  await expect(wrap).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#shell-board-preview-label')).not.toContainText('Loading play');await expect(page.locator('#app')).toHaveAttribute('data-shell-transition-phase','idle');
  await expect(page.getByTestId('game-role')).toContainText('Guest');await expect(page.getByTestId('history-move-item')).toHaveCount(0);await expect(page.getByTestId('game-board').locator('[data-piece-id]')).toHaveCount(initialState.pieces.length);await expect.poll(()=>boardPieces(page)).toEqual(expectedPieces);
  observation=await page.evaluate(readInitialLoadObservation);
  validateInitialLoadObservation(observation.native,{requestMs:SYNC_TIMING.requestTimeoutMs,documentNonce});expect(observation.lastError.present).toBe(false);relay=owner.snapshot();expect(relay.errors).toEqual([]);expect(relay.dropped).toBe(0);expect(relay.reconcileCount).toBe(1);expect(relay.legacyReads).toBe(0);expect(relay.sharedWrites).toBe(0);expect(relay.sockets).toHaveLength(2);
  await page.screenshot({path:info.outputPath('initial-load-replacement-ready.png')});
 }catch(error){primary=error;try{await page.screenshot({path:info.outputPath('initial-load-replacement-original-failure.png')});}catch(captureError){failureCaptureErrors.push(captureError);}throw error;}
 finally{
  // No second browser read on failure. Missing observation remains incomplete.
  const settled=await settleInitialLoadResources(owner,context),secondary=[...failureCaptureErrors,...settled.errors];relay=settled.relay;
  try{await writeFile(info.outputPath('initial-load-replacement-evidence.json'),JSON.stringify({version:1,observation,observationIncomplete:!observation,relay,cleanup:settled.cleanup,expected:{gameId:expected?.game?.id??null,eventSeq:expected?.eventSeq??null},primary:primary?{name:primary.name}:null,secondary:secondary.map(e=>({name:e.name})),clockDomains:'Browser event/fetch starts use one document performance clock. Node relay rows use ordinal order only. No cross-clock subtraction.'},null,2)+'\n',{mode:0o600});}catch(error){secondary.push(error);}
  if(secondary.length)throw new AggregateError([...(primary?[primary]:[]),...secondary],'Initial-load regression cleanup/evidence incomplete');
 }
});
