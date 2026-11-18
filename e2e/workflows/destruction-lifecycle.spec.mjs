import {test as base,expect} from '@playwright/test';
import fs from 'node:fs';
import {importScenarioGame,openDirectGameLink,joinAsViewer,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
// Context cleanup has its own bounded fixture clock, separate from the
// unchanged 60s behavioral assertions. Both owned contexts must still close.
const test=base.extend({createOwnedContext:[async({browser},use)=>{
 const owned=[];
 try{await use(async options=>{const context=await browser.newContext(options);owned.push(context);return context;});}
 finally{await Promise.all(owned.map(context=>context.close()));}
},{timeout:60000}]});
const fixture=JSON.parse(fs.readFileSync(new URL('../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url)));
const scenario={formatVersion:2,id:'af0a1f18-1cb2-47a8-b203-4b5598f96893',title:'Turn-end destruction regression',description:'Deferred supply losses from the reported game',incorrect:false,initialState:fixture.initialState,moves:[],resultingState:fixture.initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'};

// Observe the finite cue at DOM delivery, then prove native clock advancement
// on a later animation frame. Board renders may legitimately replace tokens.
function armDestructionWitness({key,count,signatures=null}) {
 const witnesses=window.destructionWitnesses??={};
 if(witnesses[key])throw Error(`Duplicate destruction witness: ${key}`);
 const witness={startedAt:performance.now(),frames:[],outcome:'pending',replacements:0};
 let candidate=null,lastLogical=null,frameId=null,settled=false,resolveProof,rejectProof;
 const nodeIds=new WeakMap(),animationIds=new WeakMap();let nextNodeId=0,nextAnimationId=0;
 const promise=new Promise((resolve,reject)=>{resolveProof=resolve;rejectProof=reject;});
 promise.catch(()=>{}); // Own early rejection, while the caller still awaits the original promise.
 const stop=()=>{observer.disconnect();if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;};
 const finish=(message,result)=>{if(settled)return;settled=true;stop();witness.outcome=message?'failed':signatures?'advanced':'observed';if(message){witness.message=message;rejectProof(Error(message));}else resolveProof(result);};
 const inspect=source=>{
  if(settled)return;
  const nodes=[...document.querySelectorAll('#shell-board .removal-piece:not(.pending-removal-piece)')];
  if(!signatures){if(nodes.length===count)finish(null,{count});return;}
  const entries=nodes.map(node=>{
   const animation=node.getAnimations()[0],timing=animation?.effect?.getComputedTiming(),cell=node.closest('[data-row][data-col]');
   if(!nodeIds.has(node))nodeIds.set(node,++nextNodeId);
   if(animation&&!animationIds.has(animation))animationIds.set(animation,++nextAnimationId);
   const nativeTime=typeof animation?.currentTime==='number'?animation.currentTime:null;
   return {node,animation,sample:{signature:`${cell?.dataset.row},${cell?.dataset.col}:${node.getAttribute('aria-label')}`,pieceId:node.getAttribute('data-piece-id'),nodeId:nodeIds.get(node),animationId:animation?animationIds.get(animation):null,duration:timing?.activeDuration,nativeTime,elapsed:nativeTime===null?null:nativeTime-(timing?.delay??0),playState:animation?.playState}};
  }).sort((a,b)=>a.sample.signature.localeCompare(b.sample.signature));
  const samples=entries.map(entry=>entry.sample),at=performance.now();
  if(samples.length||candidate){witness.frames.push({at,source,samples});if(witness.frames.length>32)witness.frames.shift();}
  if(entries.length!==count){if(candidate)finish('Destruction effect expired before advancing');return;}
  if(!samples.every((sample,index)=>sample.signature===signatures[index]&&sample.pieceId&&sample.duration===2400)) {finish('Destruction effect identity or duration changed');return;}
  // A just-created CSSAnimation may not yet have a currentTime. It cannot prove motion.
  if(samples.some(sample=>sample.nativeTime===null)){return;}
  if(samples.some(sample=>!Number.isFinite(sample.nativeTime)||!Number.isFinite(sample.elapsed)||sample.playState!=='running')){finish('Destruction native animation is not running');return;}
  const sameInstances=entries.map((entry,index)=>Boolean(candidate&&entry.node===candidate[index].node&&entry.animation===candidate[index].animation));
  const same=candidate&&sameInstances.every(Boolean);
  // The adapter re-primes replacement tokens with integer Date.now elapsed.
  // Compare that integer phase across replacement only; one native instance
  // retains the strict fractional clock/reset and advancement checks.
  if(lastLogical&&samples.some((sample,index)=>sample.pieceId!==lastLogical[index].pieceId||(sameInstances[index]?sample.elapsed<lastLogical[index].elapsed:Math.floor(sample.elapsed)<Math.floor(lastLogical[index].elapsed)))){finish('Destruction logical timeline reset');return;}
  lastLogical=samples;
  if(candidate&&!same)witness.replacements++;
  if(!same){candidate=entries;witness.first={at,samples};return;}
  if(samples.some((sample,index)=>sample.nativeTime<candidate[index].sample.nativeTime)){finish('Destruction native timeline reset');return;}
  // Retiming or replacement alone is not motion. Only a later native frame on
  // the same objects can establish native currentTime advancement.
  if(source==='frame'&&samples.every((sample,index)=>sample.nativeTime>candidate[index].sample.nativeTime)){
   witness.next={at,samples};finish(null,{first:candidate.map(entry=>entry.sample),next:samples,witness});
  }
 };
 const observer=new MutationObserver(()=>{try{inspect('mutation');}catch(error){finish(String(error));}});
 observer.observe(document.documentElement,{childList:true,subtree:true});
 const frame=()=>{frameId=null;try{inspect('frame');}catch(error){finish(String(error));}if(!settled)frameId=requestAnimationFrame(frame);};
 witnesses[key]={promise,witness,dispose:()=>finish('Destruction witness disposed before proof')};
 if(signatures){window.destructionMotionProof=promise;window.destructionMotionWitness=witness;frameId=requestAnimationFrame(frame);}
 inspect('armed');
}
const observedCount=(page,key)=>expect.poll(()=>page.evaluate(key=>window.destructionWitnesses[key].witness.outcome,key)).toBe('observed');
const disposeDestructionWitnesses=page=>page.evaluate(()=>{for(const entry of Object.values(window.destructionWitnesses??{}))entry.dispose();});
const REDUCED_MOTION_SETTLEMENT_MS=800;
function armNoRemovalCommitWitness(key){
 const records=[];
 const observer=new MutationObserver(mutations=>{
  for(const mutation of mutations)for(const node of mutation.addedNodes){
   if(node.nodeType!==Node.ELEMENT_NODE)continue;
   const removals=[...(node.matches?.('.removal-piece')?[node]:[]),...(node.querySelectorAll?.('.removal-piece')??[])].filter(piece=>piece.closest('#shell-board'));
   if(removals.length)records.push({at:performance.now(),count:removals.length});
  }
 });
 observer.observe(document.documentElement,{childList:true,subtree:true});
 (window.noRemovalCommitWitnesses??={})[key]={records,dispose:()=>observer.disconnect()};
}
const readNoRemovalCommitWitness=(page,key)=>page.evaluate(key=>structuredClone(window.noRemovalCommitWitnesses[key].records),key);
const disposeNoRemovalCommitWitness=(page,key)=>page.evaluate(key=>window.noRemovalCommitWitnesses[key].dispose(),key);
function armHistorySelectionClaimWitness(key){
 const record={episodes:[],samples:[]};let visible=false;
 const inspect=source=>{
  const count=document.querySelectorAll('#shell-board .removal-piece:not(.pending-removal-piece)').length;
  const pending=Boolean(document.querySelector('[data-history-selection-episode-pending="true"]'));
  record.samples.push({source,count,pending});
  if(count>0&&!visible)record.episodes.push({count,pending});
  visible=count>0;
 };
 const observer=new MutationObserver(()=>inspect('mutation'));
 observer.observe(document.documentElement,{childList:true,subtree:true});
 (window.historySelectionClaimWitnesses??={})[key]={record,dispose:()=>observer.disconnect()};
 inspect('armed');
}
const readHistorySelectionClaimWitness=(page,key)=>page.evaluate(key=>structuredClone(window.historySelectionClaimWitnesses[key].record),key);
const disposeHistorySelectionClaimWitness=(page,key)=>page.evaluate(key=>window.historySelectionClaimWitnesses[key].dispose(),key);

function armSettlementRetentionWitness(){
 const record={samples:[],expectedPieceIds:['U1-2','U1-3']},seenFlashing=new Set();let frameId,done=false,resolve,reject;
 const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});
 const sample=()=>{
  if(done)return;
  const flashing=[...document.querySelectorAll('#shell-board .removal-piece:not(.pending-removal-piece)')];
  const visible=record.expectedPieceIds.filter(id=>[...document.querySelectorAll('#shell-board [data-piece-id]')].some(node=>node.dataset.pieceId===id&&Number(getComputedStyle(node).opacity)>0));
  const confirmedFlashIds=flashing.map(node=>node.dataset.pieceId);
  for(const id of confirmedFlashIds)seenFlashing.add(id);
  const entry={at:performance.now(),visible,confirmedFlashIds};record.samples.push(entry);
  if(record.expectedPieceIds.some(id=>!seenFlashing.has(id)&&!visible.includes(id))){done=true;reject(Error('A pending turn-settlement piece disappeared before its confirmed flash: '+JSON.stringify(entry)));return;}
  if(record.expectedPieceIds.every(id=>seenFlashing.has(id))){done=true;resolve(record);return;}
  frameId=requestAnimationFrame(sample);
 };
 window.settlementRetentionWitness={record,promise,dispose:()=>{done=true;cancelAnimationFrame(frameId);}};sample();
}

for (const mobile of [false,true]) test(`turn-end losses animate once for player and viewer and persist in history (${mobile?'phone':'desktop'})`,async({createOwnedContext,baseURL},testInfo)=>{
 const owner=await createOwnedContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},hasTouch:mobile});
 const observer=await createOwnedContext({viewport:{width:1440,height:1100}});
 const page=await owner.newPage(), viewer=await observer.newPage();
 let retainedMotionWitness=null,retainedSettlementWitness=null;
 try{
  const {gameId,gameHash}=await importScenarioGame(page,scenario,baseURL);
  await switchGamePanel(page,'board');
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  await submitPlayableAction(page,fixture.action);
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
  const end=page.locator('[data-board-preview-action="end-turn"]');
  await expect(end).toBeVisible();
  // Arm the visual witness before the finite effect starts. Waiting for the
  // second client's delivery first can consume the owner's entire 2400ms cue.
  await page.bringToFront();
  await page.evaluate(armDestructionWitness,{key:'owner-motion',count:2,signatures:['6,4:Red unit','7,4:Red unit']});
  await page.evaluate(armSettlementRetentionWitness);
  await viewer.evaluate(armDestructionWitness,{key:'viewer-count',count:2});
  await end.click();
  const effects=p=>p.locator('#shell-board .removal-piece');
  const [motion]=await Promise.all([page.evaluate(()=>window.destructionMotionProof),observedCount(viewer,'viewer-count'),page.evaluate(()=>window.settlementRetentionWitness.promise)]);
  retainedMotionWitness=motion.witness;
  retainedSettlementWitness=await page.evaluate(()=>window.settlementRetentionWitness.record);
  expect(motion.first.map(sample=>sample.signature)).toEqual(['6,4:Red unit','7,4:Red unit']);
  expect(motion.next.map(sample=>sample.signature)).toEqual(motion.first.map(sample=>sample.signature));
  expect(motion.next.every((sample,index)=>sample.duration===2400&&sample.pieceId===motion.first[index].pieceId&&sample.nodeId===motion.first[index].nodeId&&sample.animationId===motion.first[index].animationId&&sample.nativeTime>motion.first[index].nativeTime&&sample.elapsed>motion.first[index].elapsed)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('turn-end-removals.png')});
  for(const p of [page,viewer])await expect(effects(p)).toHaveCount(0);
  const read=()=>page.evaluate(async id=>{const identityId=localStorage.getItem('righelt.identity.id.v1');return (await(await fetch(`/api/shell/games/${id}?identityId=${identityId}`)).json()).game;},gameId);
  await expect.poll(async()=> (await read()).moves[0].destroyedPieces.length).toBe(2);
  const saved=await read();expect(saved.moves[0].destroyedPieces.map(r=>r.position)).toEqual([{row:6,col:4},{row:7,col:4}]);
  expect(saved.moves[0].snapshot.pieces.some(p=>p.id==='U1-2'||p.id==='U1-3')).toBe(false);
  await page.reload();await expect(page.getByTestId('game-shell')).toBeVisible();
  await switchGamePanel(page,'board');
  await expect(effects(page)).toHaveCount(0);
  await switchGamePanel(page,'history');
  await expect(page.getByTestId('history-destruction-item')).toHaveCount(2);
  const selectedTurn=page.getByTestId('history-turn').filter({hasText:'Turn 1'});await selectedTurn.locator(':scope > .history-turn-hit').click();await expect(selectedTurn.locator(':scope > .history-turn-heading')).toHaveAttribute('aria-current','true');
  if(mobile){
   const preview=page.getByTestId('history-inline-preview');
   await expect(preview.locator('.cell')).toHaveCount(100);
   const renderedIds=()=>preview.locator('.piece-token[data-piece-id]:not(.move-ghost):not(.removal-piece):not(.history-destruction-piece)').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-piece-id')).sort());
   await expect.poll(renderedIds).toEqual(saved.moves[0].snapshot.pieces.map(piece=>piece.id).sort());
   await expect(preview.locator('.removal-piece')).toHaveCount(0);
   await expect(preview.locator('.history-destruction-piece')).toHaveCount(2);
   await expect(page.getByTestId('history-destruction-item')).toHaveCount(2);
   await page.screenshot({path:testInfo.outputPath('history-removals.png')});
   await switchGamePanel(page,'board');
   await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);
   await expect(effects(page)).toHaveCount(0);
   await expect(page.locator('#shell-board .history-destruction-piece')).toHaveCount(0);
  }else{
   await expect(effects(page)).toHaveCount(2);
   await expect(page.locator('#shell-board .history-destruction-piece')).toHaveCount(2);
   await page.screenshot({path:testInfo.outputPath('history-removals.png')});
  }
 }finally{
  await page.evaluate(()=>window.settlementRetentionWitness?.dispose()).catch(()=>{});
  const retention=retainedSettlementWitness??await page.evaluate(()=>window.settlementRetentionWitness?.record??null).catch(error=>({readError:String(error)}));
  fs.writeFileSync(testInfo.outputPath('settlement-retention-frames.json'),JSON.stringify(retention,null,2));
  await Promise.all([page,viewer].map(p=>disposeDestructionWitnesses(p).catch(()=>{})));
  const witness=retainedMotionWitness??await page.evaluate(()=>window.destructionMotionWitness??null).catch(error=>({readError:String(error)}));
  await testInfo.attach('destruction-motion-witness',{body:JSON.stringify(witness,null,2),contentType:'application/json'});
 }
});

test('accepted-only History selection claim survives transport settlement and stays single-use',async({page,baseURL})=>{
 await importScenarioGame(page,{...scenario,id:'129bbc34-1f60-4d7d-8f5b-45d8ec88a7b1'},baseURL);
 await switchGamePanel(page,'board');
 await submitPlayableAction(page,fixture.action);
 const end=page.locator('[data-board-preview-action="end-turn"]');
 await expect(end).toBeVisible();await end.click();
 await expect(page.getByTestId('history-destruction-item')).toHaveCount(2);
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(0,{timeout:5000});
 await switchGamePanel(page,'history');
 const turnHit=()=>page.getByTestId('history-turn').filter({hasText:'Turn 1'}).locator(':scope > .history-turn-hit');

 await page.evaluate(armHistorySelectionClaimWitness,'accepted');
 await turnHit().click();
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(2);
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(0,{timeout:5000});
 await expect(page.locator('#shell-board .history-destruction-piece')).toHaveCount(2);
 const accepted=await readHistorySelectionClaimWitness(page,'accepted');
 expect(accepted.episodes).toEqual([{count:2,pending:false}]);
 await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
 await page.waitForTimeout(250);
 expect((await readHistorySelectionClaimWitness(page,'accepted')).episodes).toEqual([{count:2,pending:false}]);
 await disposeHistorySelectionClaimWitness(page,'accepted');

 await page.getByTestId('history-return-live').click();
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 await page.evaluate(armHistorySelectionClaimWitness,'superseded');
 await page.evaluate(()=>{
  const hit=document.querySelector('[data-testid="history-turn"] .history-turn-hit');
  if(!(hit instanceof HTMLElement))throw Error('Missing turn target');
  hit.click();
  if(hit.isConnected)hit.click();
  else document.querySelector('[data-testid="history-turn"] .history-turn-hit')?.click();
 });
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(2);
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(0,{timeout:5000});
 expect((await readHistorySelectionClaimWitness(page,'superseded')).episodes).toEqual([{count:2,pending:false}]);
 await disposeHistorySelectionClaimWitness(page,'superseded');

 await page.getByTestId('history-return-live').click();
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 await page.evaluate(armHistorySelectionClaimWitness,'lifecycle');
 await page.evaluate(()=>{
  const hit=document.querySelector('[data-testid="history-turn"] .history-turn-hit');
  if(!(hit instanceof HTMLElement))throw Error('Missing turn target');
  hit.click();window.dispatchEvent(new PageTransitionEvent('pagehide'));
 });
 await page.waitForTimeout(500);
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(0);
 expect((await readHistorySelectionClaimWitness(page,'lifecycle')).episodes).toEqual([]);
 await disposeHistorySelectionClaimWitness(page,'lifecycle');
});

test('reduced motion never commits removal frames and settles active effects and History promptly',async({page,baseURL})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await importScenarioGame(page,{...scenario,id:'f90fdb4c-00dd-4d44-a87f-a708e31a8621'},baseURL);
 await switchGamePanel(page,'board');
 await submitPlayableAction(page,fixture.action);
 const end=page.locator('[data-board-preview-action="end-turn"]');
 await expect(end).toBeVisible();
 await page.evaluate(armNoRemovalCommitWitness,'live-reduced');
 await end.click();
 const liveEffects=page.locator('#shell-board .removal-piece');
 await expect(page.getByTestId('history-destruction-item')).toHaveCount(2);
 expect(await readNoRemovalCommitWitness(page,'live-reduced')).toEqual([]);
 await disposeNoRemovalCommitWitness(page,'live-reduced');
 await expect(liveEffects).toHaveCount(0,{timeout:REDUCED_MOTION_SETTLEMENT_MS});

 await switchGamePanel(page,'history');
 await page.evaluate(armNoRemovalCommitWitness,'history-reduced');
 const selectedMove=page.getByTestId('history-move-item').first();await selectedMove.locator(':scope > .history-move-hit').click();await expect(selectedMove).toHaveAttribute('aria-current','true');
 await expect(page.locator('#shell-board .history-destruction-piece')).toHaveCount(2,{timeout:REDUCED_MOTION_SETTLEMENT_MS});
 expect(await readNoRemovalCommitWitness(page,'history-reduced')).toEqual([]);
 await disposeNoRemovalCommitWitness(page,'history-reduced');
 await expect(page.locator('#shell-board .removal-piece')).toHaveCount(0,{timeout:REDUCED_MOTION_SETTLEMENT_MS});

 await page.emulateMedia({reducedMotion:'no-preference'});
 await importScenarioGame(page,{...scenario,id:'5f236940-50c9-4bf4-a078-6388d99f1817'},baseURL);
 await switchGamePanel(page,'board');
 await submitPlayableAction(page,fixture.action);
 const secondEnd=page.locator('[data-board-preview-action="end-turn"]');
 await expect(secondEnd).toBeVisible();await secondEnd.click();
 await expect(liveEffects).toHaveCount(2);
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(liveEffects).toHaveCount(0,{timeout:REDUCED_MOTION_SETTLEMENT_MS});
});

const projectFixture=JSON.parse(fs.readFileSync(new URL('../../packages/game-engine/test/fixtures/destruction-project.json',import.meta.url)));
test('screenshot project plays five supply-loss effects on both connected clients',async({createOwnedContext,baseURL},testInfo)=>{
 const owner=await createOwnedContext({viewport:{width:1440,height:1100}}),observer=await createOwnedContext({viewport:{width:1440,height:1100}});
 const page=await owner.newPage(),viewer=await observer.newPage();
  const {gameHash}=await importScenarioGame(page,{...scenario,id:'cb925f15-ccdf-4183-9dc8-bffbddb145bf',initialState:projectFixture.initialState,resultingState:projectFixture.initialState},baseURL);
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  try{
  await Promise.all([page,viewer].map(p=>p.evaluate(armDestructionWitness,{key:'project-count',count:5})));
  await submitPlayableAction(page,projectFixture.action);
  await Promise.all([page,viewer].map(p=>observedCount(p,'project-count')));
  await page.screenshot({path:testInfo.outputPath('project-removals.png')});
  for(const p of [page,viewer]){
   await expect(p.locator('#shell-board .removal-piece')).toHaveCount(0);
   await expect(p.getByTestId('history-destruction-item')).toHaveCount(5);
  }
  }finally{await Promise.all([page,viewer].map(p=>disposeDestructionWitnesses(p).catch(()=>{})));}
});
