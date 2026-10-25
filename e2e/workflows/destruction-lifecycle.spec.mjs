import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {importScenarioGame,openDirectGameLink,joinAsViewer,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url)));
const scenario={formatVersion:2,id:'af0a1f18-1cb2-47a8-b203-4b5598f96893',title:'Turn-end destruction regression',description:'Deferred supply losses from the reported game',incorrect:false,initialState:fixture.initialState,moves:[],resultingState:fixture.initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'};

for (const mobile of [false,true]) test(`turn-end losses animate once for player and viewer and persist in history (${mobile?'phone':'desktop'})`,async({browser,baseURL},testInfo)=>{
 const owner=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},hasTouch:mobile});
 const observer=await browser.newContext({viewport:{width:1440,height:1100}});
 const page=await owner.newPage(), viewer=await observer.newPage();
 try{
  const {gameId,gameHash}=await importScenarioGame(page,scenario,baseURL);
  await switchGamePanel(page,'board');
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  await submitPlayableAction(page,fixture.action);
  await expect(page.getByTestId('history-move-item')).toHaveCount(1);
  const end=page.locator('[data-board-preview-action="end-turn"]');
  await expect(end).toBeVisible();
  await end.click();
  const effects=p=>p.locator('#shell-board .removal-piece');
  for(const p of [page,viewer])await expect(effects(p)).toHaveCount(2);
  const capture=()=>effects(page).evaluateAll(nodes=>nodes.map(n=>({duration:n.getAnimations()[0]?.effect.getComputedTiming().activeDuration,current:n.getAnimations()[0]?.currentTime})));
  const first=await capture();expect(first.every(x=>x.duration===2400)).toBe(true);
  await expect.poll(async()=>{const next=await capture();return next.length===2&&next.every((x,i)=>x.current>first[i].current);}).toBe(true);
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
   await expect(preview.locator('.removal-piece,.history-destruction-piece')).toHaveCount(0);
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
 }finally{await owner.close();await observer.close();}
});

const projectFixture=JSON.parse(fs.readFileSync(new URL('../../packages/game-engine/test/fixtures/destruction-project.json',import.meta.url)));
test('screenshot project plays five supply-loss effects on both connected clients',async({browser,baseURL},testInfo)=>{
 const owner=await browser.newContext({viewport:{width:1440,height:1100}}),observer=await browser.newContext({viewport:{width:1440,height:1100}});
 const page=await owner.newPage(),viewer=await observer.newPage();
 try{
  const {gameHash}=await importScenarioGame(page,{...scenario,id:'cb925f15-ccdf-4183-9dc8-bffbddb145bf',initialState:projectFixture.initialState,resultingState:projectFixture.initialState},baseURL);
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  await submitPlayableAction(page,projectFixture.action);
  for(const p of [page,viewer])await expect(p.locator('#shell-board .removal-piece')).toHaveCount(5);
  await page.screenshot({path:testInfo.outputPath('project-removals.png')});
  for(const p of [page,viewer]){
   await expect(p.locator('#shell-board .removal-piece')).toHaveCount(0);
   await expect(p.getByTestId('history-destruction-item')).toHaveCount(5);
  }
 }finally{await owner.close();await observer.close();}
});
