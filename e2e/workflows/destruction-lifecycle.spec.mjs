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
  const nodes=[...document.querySelectorAll('#shell-board .removal-piece')];
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

for (const mobile of [false,true]) test(`turn-end losses animate once for player and viewer and persist in history (${mobile?'phone':'desktop'})`,async({createOwnedContext,baseURL},testInfo)=>{
 const owner=await createOwnedContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},hasTouch:mobile});
 const observer=await createOwnedContext({viewport:{width:1440,height:1100}});
 const page=await owner.newPage(), viewer=await observer.newPage();
 let retainedMotionWitness=null;
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
  await viewer.evaluate(armDestructionWitness,{key:'viewer-count',count:2});
  await end.click();
  const effects=p=>p.locator('#shell-board .removal-piece');
  const [motion]=await Promise.all([page.evaluate(()=>window.destructionMotionProof),observedCount(viewer,'viewer-count')]);
  retainedMotionWitness=motion.witness;
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
  await page.getByTestId('history-move-item').first().click();
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
  await Promise.all([page,viewer].map(p=>disposeDestructionWitnesses(p).catch(()=>{})));
  const witness=retainedMotionWitness??await page.evaluate(()=>window.destructionMotionWitness??null).catch(error=>({readError:String(error)}));
  await testInfo.attach('destruction-motion-witness',{body:JSON.stringify(witness,null,2),contentType:'application/json'});
 }
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
