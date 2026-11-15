import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importScenarioGame,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {installPassiveAudioObservations} from '../support/audio-observations.mjs';
import {installRemovalOnsetTrace} from '../support/removal-onset-trace.mjs';

const turnEndFixture=JSON.parse(await readFile(new URL('../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url),'utf8'));
const projectFixture=JSON.parse(await readFile(new URL('../../packages/game-engine/test/fixtures/destruction-project.json',import.meta.url),'utf8'));
const nineFixture=structuredClone(projectFixture);
for(const [index,[row,col]] of [[0,[0,0]],[1,[0,2]],[2,[0,4]],[3,[0,6]]])nineFixture.initialState.pieces.push({id:`T166-${index}`,owner:'P2',kind:'unit',position:{row,col},supplied:false,commanded:false});

const cases=[
 {title:'two casualties at turn settlement',count:2,fixture:turnEndFixture,endTurn:true,id:'c9f296dd-18ee-4d2c-97cc-73978cfb4212'},
 {title:'five casualties at project settlement',count:5,fixture:projectFixture,endTurn:false,id:'8c1519f2-782a-4455-bcda-e80e1432f5a5'},
 {title:'nine simultaneous casualties at project settlement',count:9,fixture:nineFixture,endTurn:false,id:'1a41945d-b1b5-4d94-a39e-d38b5dd47e6c'},
];

const scenarioFor=value=>({formatVersion:2,id:value.id,title:`T-166 ${value.title}`,description:'Test-owned removal onset timing fixture',incorrect:false,initialState:value.fixture.initialState,moves:[],resultingState:value.fixture.initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'});

function armNativeRemovalTrace(expectedCount){
 let first=null,painted=false,advanced=false,frameId=null;
 const mark=(phase,fields={})=>{try{globalThis.__righeltRemovalTraceMark?.(phase,fields);}catch{}};
 const inspect=()=>{
  const nodes=[...document.querySelectorAll('#shell-board .removal-piece')];
  if(nodes.length!==expectedCount)return;
  const animations=nodes.map(node=>node.getAnimations()[0]),times=animations.map(animation=>animation?.currentTime);
  if(!first&&animations.every(Boolean)&&times.every(time=>typeof time==='number')){
   first={nodes,animations,times};
   mark('removal-dom-observed',{removalCount:nodes.length});
  }
 };
 const frame=()=>{
  frameId=null;inspect();
  if(first&&!painted){painted=true;mark('paint-opportunity',{removalCount:expectedCount});}
  if(first&&!advanced){
   const current=first.nodes.map(node=>node.getAnimations()[0]);
   const times=current.map(animation=>animation?.currentTime);
   if(current.every((animation,index)=>animation===first.animations[index])&&times.every((time,index)=>typeof time==='number'&&typeof first.times[index]==='number'&&time>first.times[index])){
    advanced=true;mark('native-animation-advanced',{removalCount:expectedCount});observer.disconnect();return;
   }
  }
  frameId=requestAnimationFrame(frame);
 };
 const observer=new MutationObserver(inspect);observer.observe(document,{childList:true,subtree:true});frameId=requestAnimationFrame(frame);
 globalThis.__righeltRemovalTraceMotionDispose=()=>{observer.disconnect();if(frameId!==null)cancelAnimationFrame(frameId);};
}

for(const value of cases)test(`records one-clock confirmed removal onset for ${value.title}`,async({page,baseURL},info)=>{
 const disposeTrace=await installRemovalOnsetTrace(page.context(),baseURL);
 await page.context().addInitScript(installPassiveAudioObservations);
 let receipt;
 try{
  await importScenarioGame(page,scenarioFor(value),baseURL);await switchGamePanel(page,'board');
  const selfPlay=page.getByRole('button',{name:'Play both sides',exact:true});
  await expect(selfPlay).toBeVisible();await selfPlay.click();
  if(value.endTurn){
   await submitPlayableAction(page,value.fixture.action);
   await expect(page.getByTestId('history-move-item')).toHaveCount(1);
  }
  expect(await page.evaluate(count=>globalThis.__righeltRemovalTraceArm?.({expectedCount:count}),value.count)).toBe(true);
  await page.evaluate(armNativeRemovalTrace,value.count);
  if(value.endTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
  else await submitPlayableAction(page,value.fixture.action);
  await expect(page.locator('#shell-board .removal-piece')).toHaveCount(value.count);
  await expect(page.getByTestId('history-destruction-item')).toHaveCount(value.count);
  await expect.poll(()=>page.evaluate(()=>globalThis.__righeltRemovalTraceSnapshot?.().records.some(row=>row.phase==='native-animation-advanced'))).toBe(true);
  const trace=await page.evaluate(()=>globalThis.__righeltRemovalTraceSnapshot?.());
  await info.attach(`T-166 ${value.count}-casualty one-clock trace`,{body:JSON.stringify(trace,null,2),contentType:'application/json'});
  const afterInput=trace.records.findIndex(row=>row.phase==='input-activated'),afterAuthoritative=trace.records.findIndex((row,index)=>index>afterInput&&row.phase==='authoritative-subscriber');
  expect(afterInput).toBeGreaterThanOrEqual(0);expect(afterAuthoritative).toBeGreaterThan(afterInput);
  const after=trace.records.slice(afterAuthoritative);
  expect(after.some(row=>row.phase==='board-commit-exit'&&row.removalCount===0)).toBe(true);
  expect(after.some(row=>row.phase==='visual-commit-entry')).toBe(true);
  expect(after.some(row=>row.phase==='board-commit-exit'&&row.removalCount===value.count)).toBe(true);
  expect(after.some(row=>row.phase==='cue-schedule-entry')).toBe(true);
  expect(after.some(row=>row.phase==='audio-source-start'&&Math.abs(row.duration-.13)<.001)).toBe(true);
  expect(after.some(row=>row.phase==='paint-opportunity'&&row.removalCount===value.count)).toBe(true);
  expect(after.some(row=>row.phase==='native-animation-advanced'&&row.removalCount===value.count)).toBe(true);
  expect(after.some(row=>row.phase==='board-commit-exit'&&row.actionable===true)).toBe(true);
  expect(trace).toMatchObject({schemaVersion:1,expectedCount:value.count,dropped:0,incomplete:false});
 }finally{
  await page.evaluate(()=>globalThis.__righeltRemovalTraceMotionDispose?.()).catch(()=>{});
  receipt=await disposeTrace();
  await info.attach(`T-166 ${value.count}-casualty transform receipt`,{body:JSON.stringify(receipt,null,2),contentType:'application/json'});
 }
 expect(receipt?.incomplete).toBe(false);
});
