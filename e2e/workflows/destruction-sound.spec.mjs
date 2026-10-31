import {test,expect} from '@playwright/test';
import {installPassiveAudioObservations} from '../support/audio-observations.mjs';
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
test('native audio resumes and advances after a trusted pointer gesture without application code',async({page},info)=>{
 await page.setContent('<button>Start native audio</button>');
 await page.evaluate(()=>{
  window.nativeAudioProof={events:[]};
  document.querySelector('button').addEventListener('pointerdown',event=>{
   const proof=window.nativeAudioProof;
   proof.trusted=event.isTrusted;proof.focused=document.hasFocus();proof.hidden=document.hidden;
   const audio=window.nativeAudioContext=new AudioContext({latencyHint:'interactive'});
   proof.initialState=audio.state;proof.initialTime=audio.currentTime;
   audio.addEventListener('statechange',()=>proof.events.push({kind:'state',state:audio.state,time:audio.currentTime}));
   audio.resume().then(()=>proof.events.push({kind:'resolved',state:audio.state,time:audio.currentTime}),error=>proof.events.push({kind:'rejected',error:String(error)}));
  },{once:true});
 });
 try{
  await page.getByRole('button',{name:'Start native audio'}).click();
  await expect.poll(()=>page.evaluate(()=>window.nativeAudioContext?.state)).toBe('running');
  await expect.poll(()=>page.evaluate(()=>window.nativeAudioContext.currentTime-window.nativeAudioProof.initialTime)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.nativeAudioProof)).toMatchObject({trusted:true,focused:true,hidden:false});
 }finally{
  const proof=await page.evaluate(()=>({...window.nativeAudioProof,state:window.nativeAudioContext?.state,time:window.nativeAudioContext?.currentTime}));
  await info.attach('Native audio baseline',{body:JSON.stringify(proof,null,2),contentType:'application/json'});
  // Do not await a native close promise when diagnosing an unresponsive backend.
  await page.evaluate(()=>{void window.nativeAudioContext?.close().catch(()=>{});});
 }
});
const withObservedAudio=async(browser,info,run)=>{
 const ownerContext=await browser.newContext({viewport:{width:1440,height:1100}}),viewerContext=await browser.newContext({viewport:{width:1440,height:1100}});
 await ownerContext.addInitScript(installPassiveAudioObservations);await viewerContext.addInitScript(installPassiveAudioObservations);
 await ownerContext.addInitScript(instrument);await viewerContext.addInitScript(instrument);
 const owner=await ownerContext.newPage(),viewer=await viewerContext.newPage();
 const observations={owner:[],viewer:[]};
 const retain=async(label,page,phase)=>{observations[label].push({phase,...await page.evaluate(()=>({timeline:window.passiveAudioObservations,probe:window.destructionAudioProbe,ui:window.passiveAudioUiState?.()})).catch(error=>({readError:String(error)}))});};
 try{await run({owner,viewer,retain});}finally{
  try{
   for(const [label,page]of[['owner',owner],['viewer',viewer]]){
    await retain(label,page,'final');
    const path=info.outputPath(`audio-observations-${label}.json`);await writeFile(path,JSON.stringify(observations[label],null,2));await info.attach(`Passive native audio ${label}`,{path,contentType:'application/json'});
   }
  }finally{await closeContextQuietly(ownerContext);await closeContextQuietly(viewerContext);}
 }
};
const sendEndTurn=(page,gameId,body,generation)=>page.evaluate(async({gameId,body,generation,header})=>{
 const response=await fetch(`/api/shell/games/${gameId}/end-turn`,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
},{gameId,body,generation,header:STORAGE_GENERATION_HEADER});

test('real audio destruction batches deduplicate local receipts while mute and replays stay silent',async({browser,baseURL,browserName},info)=>{
 await withObservedAudio(browser,info,async({owner,viewer,retain})=>{
  const first=await importScenarioGame(owner,scenario,baseURL);await switchGamePanel(owner,'board');
  await openDirectGameLink(viewer,baseURL,first.gameHash);await joinAsViewer(viewer);await switchGamePanel(viewer,'board');
  await owner.bringToFront();await expect.poll(()=>owner.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);
  const viewerInitiallyActive=await viewer.evaluate(()=>document.hasFocus()&&!document.hidden);
  // Browser automation can keep both isolated windows active. Assert against
  // the real gate and record it; do not invent a background-silence result.
  await submitPlayableAction(owner,fixture.action);await expect(owner.getByTestId('history-move-item')).toHaveCount(1);
  expect(await crackStarts(owner)).toHaveLength(0);
  await retain('owner',owner,'before-first-end-turn');await retain('viewer',viewer,'before-first-end-turn');
  const endRequest=owner.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/end-turn'));
  await owner.locator('[data-board-preview-action="end-turn"]').click();const request=await endRequest;
  await expect.poll(async()=>(await projected(owner,first.gameId)).moves[0].destroyedPieces.length).toBe(2);
  await expect.poll(async()=>(await projected(viewer,first.gameId)).moves[0].destroyedPieces.length).toBe(2);
  await expect.poll(async()=>(await crackStarts(owner)).length).toBe(1);expect(await crackStarts(viewer)).toHaveLength(viewerInitiallyActive?1:0);
  expect((await crackStarts(owner))[0]).toMatchObject({focused:true,hidden:false,audioContextState:'running'});
  const command=request.postDataJSON(),generation=request.headers()[STORAGE_GENERATION_HEADER.toLowerCase()];
  const beforeDuplicate=await projected(owner,first.gameId);
  for(let i=0;i<2;i++){const duplicate=await sendEndTurn(owner,first.gameId,command,generation);expect(duplicate.status).toBe(200);expect(duplicate.body).toMatchObject({accepted:true,duplicate:true,clientCommandId:command.clientCommandId});}
  expect((await projected(owner,first.gameId)).gameplayRevision).toBe(beforeDuplicate.gameplayRevision);expect(await crackStarts(owner)).toHaveLength(1);
  // Reload/history/replay are informational and must not reproduce destruction audio.
  await retain('owner',owner,'local-confirmed-and-duplicates');await retain('viewer',viewer,'local-confirmed-and-duplicates');
  await viewer.bringToFront();await viewer.reload();await expect(viewer.getByTestId('game-shell')).toBeVisible();expect(await crackStarts(viewer)).toHaveLength(0);
  await switchGamePanel(viewer,'history');await viewer.getByTestId('history-move-item').first().locator(':scope > .history-move-hit').click();await expect(viewer.locator('#shell-board .history-destruction-piece')).toHaveCount(2);expect(await crackStarts(viewer)).toHaveLength(0);
  await returnToLive(viewer);await switchGamePanel(viewer,'board');await viewer.emulateMedia({reducedMotion:'reduce'});
  await viewer.locator('#shell-board-preview-label').getByRole('button',{name:'Show me again',exact:true}).click();await expect(viewer.locator('.computer-replay')).toBeVisible();
  await viewer.locator('#shell-board-preview-label').getByRole('button',{name:'Stop replay',exact:true}).click();expect(await crackStarts(viewer)).toHaveLength(0);
  // Deliberate in-app mute persists; no system output setting is read or changed.
  await retain('owner',owner,'before-mute');await retain('viewer',viewer,'history-and-replay');
  await owner.bringToFront();await owner.getByRole('button',{name:'Mute sound',exact:true}).click();
  const muted=await importScenarioGame(owner,{...scenario,id:'b71f581c-6cfe-4c5a-9827-1687a23ace33'},baseURL);await owner.bringToFront();
  await submitPlayableAction(owner,fixture.action);await owner.locator('[data-board-preview-action="end-turn"]').click();await expect.poll(async()=>(await projected(owner,muted.gameId)).moves[0].destroyedPieces.length).toBe(2);
  expect(await crackStarts(owner)).toHaveLength(0);expect(await owner.evaluate(()=>localStorage.getItem('righelt.device.sound-enabled'))).toBe('false');
  await retain('owner',owner,'muted-confirmed');
  await owner.reload();await expect(owner.getByTestId('game-shell')).toBeVisible();await expect(owner.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();expect(await crackStarts(owner)).toHaveLength(0);
  const proof=JSON.stringify({browserName,localCracks:1,initialViewerActive:viewerInitiallyActive,initialViewerCracks:viewerInitiallyActive?1:0,nativeBackgroundObserved:!viewerInitiallyActive,duplicateCracks:0,reloadHistoryReplayCracks:0,mutedCracks:0,systemMute:'unchanged; no audible audition claimed'},null,2);
  await writeFile(info.outputPath('audio-receipt-proof.json'),proof);
  await info.attach('Real WebAudio local destruction receipt proof',{path:info.outputPath('audio-receipt-proof.json'),contentType:'application/json'});
 });
});

test('real audio remote finalization deduplicates its durable receipt while its owner stays muted',async({browser,baseURL,browserName},info)=>{
 await withObservedAudio(browser,info,async({owner,viewer})=>{
  // A confirmed remote action can sound on the foreground viewer, even though
  // its muted owner performs the authenticated request without taking focus.
  const remote=await importScenarioGame(owner,{...scenario,id:'b71f581c-6cfe-4c5a-9827-1687a23ace34'},baseURL);await owner.bringToFront();
  await owner.getByRole('button',{name:'Mute sound',exact:true}).click();
  await expect(owner.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();
  await submitPlayableAction(owner,fixture.action);
  await openDirectGameLink(viewer,baseURL,remote.gameHash);await joinAsViewer(viewer);await switchGamePanel(viewer,'board');
  await viewer.bringToFront();
  await expect.poll(()=>viewer.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);
  // A trusted gesture starts native resume asynchronously. The sound contract
  // intentionally skips cues while suspended instead of replaying them later.
  // Establish the audible viewer before sending the remote confirmation,
  // including browsers that construct the context already running.
  await expect.poll(()=>viewer.evaluate(()=>window.passiveAudioObservations.findLast(event=>event.state)?.state)).toBe('running');
  const ownerRemoteActive=await owner.evaluate(()=>document.hasFocus()&&!document.hidden);

  const remoteRequest=owner.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/end-turn'));
  await owner.evaluate(()=>document.querySelector('[data-board-preview-action="end-turn"]').click());
  const capturedRemote=await remoteRequest;
  const remoteCommand=capturedRemote.postDataJSON(),generation=capturedRemote.headers()[STORAGE_GENERATION_HEADER.toLowerCase()];
  expect(await viewer.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(true);expect(await owner.evaluate(()=>document.hasFocus()&&!document.hidden)).toBe(ownerRemoteActive);
  await expect.poll(async()=>(await projected(viewer,remote.gameId)).moves[0].destroyedPieces.length).toBe(2);await expect.poll(async()=>(await crackStarts(viewer)).length).toBe(1);
  expect((await crackStarts(viewer))[0]).toMatchObject({focused:true,hidden:false,audioContextState:'running'});
  expect(await crackStarts(owner)).toHaveLength(0);
  // WebSocket acceptance can intentionally abort the owner's in-flight HTTP
  // request. The same immutable command must return its durable accepted receipt.
  const remoteDuplicate=await sendEndTurn(owner,remote.gameId,remoteCommand,generation);expect(remoteDuplicate.status).toBe(200);expect(remoteDuplicate.body).toMatchObject({accepted:true,duplicate:true,clientCommandId:remoteCommand.clientCommandId});expect(await crackStarts(viewer)).toHaveLength(1);
  const proof=JSON.stringify({browserName,ownerRemoteActive,focusSetup:'Actual document APIs recorded without overrides; native background proof remains a gap when both windows report active',duplicateCracks:0,mutedCracks:0,remoteForeground:await crackStarts(viewer),systemMute:'unchanged; no audible audition claimed'},null,2);
  await writeFile(info.outputPath('audio-remote-receipt-proof.json'),proof);
  await info.attach('Real WebAudio remote destruction receipt proof',{path:info.outputPath('audio-remote-receipt-proof.json'),contentType:'application/json'});
 });
});
