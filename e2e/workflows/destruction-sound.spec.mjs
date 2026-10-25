import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {importScenarioGame,openDirectGameLink,joinAsViewer,submitPlayableAction,switchGamePanel,returnToLive,closeContextQuietly} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
const fixture=JSON.parse(await readFile(new URL('../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url),'utf8'));
const scenario={formatVersion:2,id:'b71f581c-6cfe-4c5a-9827-1687a23ace32',title:'Destruction audio receipt regression',description:'Deferred supply loss audio',incorrect:false,initialState:fixture.initialState,moves:[],resultingState:fixture.initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'};
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const crackStarts=page=>page.evaluate(()=>window.destructionAudioProbe.cracks);
const instrument=()=>{
 const native=AudioBufferSourceNode.prototype.start;
 window.destructionAudioProbe={cracks:[],sources:0};
 AudioBufferSourceNode.prototype.start=function(...args){
  const result=Reflect.apply(native,this,args);
  const buffer=this.buffer;window.destructionAudioProbe.sources++;
  // The production cue is a deterministic mono130ms fracture. Its first sample
  // is rate independent; ordinary/random incoming and navigation cues differ.
  if(buffer?.numberOfChannels===1&&Math.abs(buffer.duration-.13)<1/buffer.sampleRate&&Math.abs(buffer.getChannelData(0)[0]-(-.43989384174346924))<1e-8)
   window.destructionAudioProbe.cracks.push({focused:document.hasFocus(),hidden:document.hidden,audioContextState:this.context.state,length:buffer.length,sampleRate:buffer.sampleRate});
  return result;
 };
};
test('real audio destruction batches deduplicate local receipts and remote finalization while mute and replays stay silent',async({browser,baseURL,browserName},info)=>{
 const ownerContext=await browser.newContext({viewport:{width:1440,height:1100}}),viewerContext=await browser.newContext({viewport:{width:1440,height:1100}});
 await ownerContext.addInitScript(instrument);await viewerContext.addInitScript(instrument);
 const owner=await ownerContext.newPage(),viewer=await viewerContext.newPage();
 try{
  const first=await importScenarioGame(owner,scenario,baseURL);await switchGamePanel(owner,'board');
  await openDirectGameLink(viewer,baseURL,first.gameHash);await joinAsViewer(viewer);await switchGamePanel(viewer,'board');
  await owner.bringToFront();await expect.poll(()=>owner.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);
  const viewerInitiallyActive=await viewer.evaluate(()=>document.hasFocus()&&!document.hidden);
  // Browser automation can keep both isolated windows active. Assert against
  // the real gate and record it; do not invent a background-silence result.
  await submitPlayableAction(owner,fixture.action);await expect(owner.getByTestId('history-move-item')).toHaveCount(1);
  expect(await crackStarts(owner)).toHaveLength(0);
  const endRequest=owner.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/end-turn'));
  await owner.locator('[data-board-preview-action="end-turn"]').click();const request=await endRequest;
  await expect.poll(async()=>(await projected(owner,first.gameId)).moves[0].destroyedPieces.length).toBe(2);
  await expect.poll(async()=>(await projected(viewer,first.gameId)).moves[0].destroyedPieces.length).toBe(2);
  await expect.poll(async()=>(await crackStarts(owner)).length).toBe(1);expect(await crackStarts(viewer)).toHaveLength(viewerInitiallyActive?1:0);
  expect((await crackStarts(owner))[0]).toMatchObject({focused:true,hidden:false,audioContextState:'running'});
  const command=request.postDataJSON(),generation=request.headers()[STORAGE_GENERATION_HEADER.toLowerCase()];
  const send=(page,gameId,body)=>page.evaluate(async({gameId,body,generation,header})=>{
   const response=await fetch(`/api/shell/games/${gameId}/end-turn`,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify(body)});
   return {status:response.status,body:await response.json()};
  },{gameId,body,generation,header:STORAGE_GENERATION_HEADER});
  const beforeDuplicate=await projected(owner,first.gameId);
  for(let i=0;i<2;i++){const duplicate=await send(owner,first.gameId,command);expect(duplicate.status).toBe(200);expect(duplicate.body).toMatchObject({accepted:true,duplicate:true,clientCommandId:command.clientCommandId});}
  expect((await projected(owner,first.gameId)).gameplayRevision).toBe(beforeDuplicate.gameplayRevision);expect(await crackStarts(owner)).toHaveLength(1);
  // Reload/history/replay are informational and must not reproduce destruction audio.
  await viewer.bringToFront();await viewer.reload();await expect(viewer.getByTestId('game-shell')).toBeVisible();expect(await crackStarts(viewer)).toHaveLength(0);
  await switchGamePanel(viewer,'history');await viewer.getByTestId('history-move-item').first().locator('.history-move-line').click();await expect(viewer.locator('#shell-board .history-destruction-piece')).toHaveCount(2);expect(await crackStarts(viewer)).toHaveLength(0);
  await returnToLive(viewer);await switchGamePanel(viewer,'board');await viewer.emulateMedia({reducedMotion:'reduce'});
  await viewer.locator('#shell-board-preview-label').getByRole('button',{name:'Show me again',exact:true}).click();await expect(viewer.locator('.computer-replay')).toBeVisible();
  await viewer.locator('#shell-board-preview-label').getByRole('button',{name:'Stop replay',exact:true}).click();expect(await crackStarts(viewer)).toHaveLength(0);
  // Deliberate in-app mute persists; no system output setting is read or changed.
  await owner.bringToFront();await owner.getByRole('button',{name:'Mute sound',exact:true}).click();
  const muted=await importScenarioGame(owner,{...scenario,id:'b71f581c-6cfe-4c5a-9827-1687a23ace33'},baseURL);await owner.bringToFront();
  await submitPlayableAction(owner,fixture.action);await owner.locator('[data-board-preview-action="end-turn"]').click();await expect.poll(async()=>(await projected(owner,muted.gameId)).moves[0].destroyedPieces.length).toBe(2);
  expect(await crackStarts(owner)).toHaveLength(0);expect(await owner.evaluate(()=>localStorage.getItem('righelt.device.sound-enabled'))).toBe('false');
  await owner.reload();await expect(owner.getByTestId('game-shell')).toBeVisible();await expect(owner.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();expect(await crackStarts(owner)).toHaveLength(0);
  // A confirmed remote action can sound on the foreground viewer, even though
  // its muted owner performs the authenticated request without taking focus.
  const remote=await importScenarioGame(owner,{...scenario,id:'b71f581c-6cfe-4c5a-9827-1687a23ace34'},baseURL);await owner.bringToFront();await submitPlayableAction(owner,fixture.action);
  await openDirectGameLink(viewer,baseURL,remote.gameHash);await joinAsViewer(viewer);await switchGamePanel(viewer,'board');
  await viewer.bringToFront();
  await expect.poll(()=>viewer.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);
  const ownerRemoteActive=await owner.evaluate(()=>document.hasFocus()&&!document.hidden);

  const remoteRequest=owner.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/end-turn'));
  await owner.evaluate(()=>document.querySelector('[data-board-preview-action="end-turn"]').click());
  const capturedRemote=await remoteRequest;
  const remoteCommand=capturedRemote.postDataJSON();
  expect(await viewer.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);expect(await owner.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(ownerRemoteActive);
  await expect.poll(async()=>(await projected(viewer,remote.gameId)).moves[0].destroyedPieces.length).toBe(2);await expect.poll(async()=>(await crackStarts(viewer)).length).toBe(1);
  expect((await crackStarts(viewer))[0]).toMatchObject({focused:true,hidden:false,audioContextState:'running'});
  expect(await crackStarts(owner)).toHaveLength(0);
  // WebSocket acceptance can intentionally abort the owner's in-flight HTTP
  // request. The same immutable command must return its durable accepted receipt.
  const remoteDuplicate=await send(owner,remote.gameId,remoteCommand);expect(remoteDuplicate.status).toBe(200);expect(remoteDuplicate.body).toMatchObject({accepted:true,duplicate:true,clientCommandId:remoteCommand.clientCommandId});expect(await crackStarts(viewer)).toHaveLength(1);
  const proof=JSON.stringify({browserName,localCracks:1,initialViewerActive:viewerInitiallyActive,initialViewerCracks:viewerInitiallyActive?1:0,nativeBackgroundObserved:!viewerInitiallyActive,ownerRemoteActive,focusSetup:'Actual document APIs recorded without overrides; native background proof remains a gap when both windows report active',duplicateCracks:0,reloadHistoryReplayCracks:0,mutedCracks:0,remoteForeground:await crackStarts(viewer),systemMute:'unchanged; no audible audition claimed'},null,2);
  await writeFile(info.outputPath('audio-receipt-proof.json'),proof);
  await info.attach('Real WebAudio destruction receipt proof',{path:info.outputPath('audio-receipt-proof.json'),contentType:'application/json'});
 }finally{await closeContextQuietly(ownerContext);await closeContextQuietly(viewerContext);}
});
