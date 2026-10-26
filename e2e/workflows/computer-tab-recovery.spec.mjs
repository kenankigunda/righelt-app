import {test,expect,chromium} from '@playwright/test';
import {browserLaunchOptions} from '../../scripts/playwright-launch-options.mjs';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision} from '../support/computer-projection.mjs';

const guestRequest=(page,route,body)=>page.evaluate(async({route,body,header})=>{
 const bootstrap=await fetch('/api/shell/bootstrap');const generation=bootstrap.headers.get(header);
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
 if(!response.ok)throw Error(`Local computer fixture failed: ${response.status}`);
 return response.json();
},{route,body,header:STORAGE_GENERATION_HEADER});
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const createComputer=async page=>{
 await page.goto('/');await expect(page.getByTestId('home-create-game')).toBeVisible();
 const {game}=await guestRequest(page,'/api/shell/games',{selfPlayMode:true,computer:{p1:null,p2:'babs'}});
 await page.goto(`/#/game/${game.id}`);await switchGamePanel(page,'players');
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:20000});return game.id;
};

test('closing the original tab automatically restores computer play in a new tab with the same owner',async({page,context},info)=>{
 const id=await createComputer(page);const next=await context.newPage();await page.close();
 await next.goto(`/#/game/${id}`);await switchGamePanel(next,'players');
 await expect(next.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:25000});
 const submissions=[];next.on('request',request=>{if(request.method()!=='POST')return;try{const value=request.postDataJSON();if(value?.payload?.computer)submissions.push(value);}catch{}});
 const game=await projected(next,id);await switchGamePanel(next,'board');
 await submitPlayableAction(next,game.legalActions.find(action=>action.from&&action.to));
 if((await projected(next,id)).canEndTurn)await next.locator('[data-board-preview-action="end-turn"]').click();
 await waitForComputerDecision(next,id,'babs',{guest:true,modelId:game.computer.modelId});
 const finished=await projected(next,id);expect(finished.moves.some(move=>move.computerProof)).toBe(true);
 expect(new Set(finished.moves.map(move=>move.moveId)).size).toBe(finished.moves.length);
 expect(submissions.length).toBeGreaterThan(0);
 const identities=new Map();for(const submission of submissions){const key=submission.expectedGameplayRevision;const original=identities.get(key);if(original)expect(submission).toEqual(original);else identities.set(key,submission);}
 expect(new Set(finished.moves.filter(move=>move.computerProof).map(move=>move.computerProof.attemptId)).size).toBe(finished.moves.filter(move=>move.computerProof).length);
 await switchGamePanel(next,'players');await next.screenshot({path:info.outputPath('computer-resumed-new-tab.png')});
});

test('player card deliberately restores paused manual play and lost acknowledgement keeps one resume intent',async({page},info)=>{
 const id=await createComputer(page);
 for(const action of ['takeover','manual','pause']){
  const game=await projected(page,id);
  await guestRequest(page,`/api/shell/games/${id}/computer-control`,{action,deviceId:game.computer.lease.deviceId,generation:game.computer.generation});
 }
 const card=page.getByRole('button',{name:'Babs, Blue, Paused',exact:true});await expect(card).toBeVisible();await card.click();
 const resume=page.getByRole('button',{name:'Resume here',exact:true});await expect(resume).toBeEnabled();
 const sent=[];let dropped=false;
 await page.route(`**/api/shell/games/${id}/shared`,async route=>{
  const envelope=route.request().postDataJSON();
  if(envelope.payload?.values?.action==='resume-here'){
   sent.push(envelope);
   if(!dropped){dropped=true;await route.fetch();await route.abort();return;}
  }
  await route.continue();
 });
 await resume.click();
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:25000});
 await expect(page.getByRole('button',{name:'Resume here',exact:true})).toHaveCount(0);
 const game=await projected(page,id);
 expect([game.computer.paused,game.computer.manual,game.computer.singleStep,game.computer.takeoverTurn]).toEqual([false,false,false,null]);
 expect(sent.length).toBeGreaterThan(0);for(const envelope of sent)expect(envelope).toEqual(sent[0]);
 await expect.poll(()=>page.evaluate(id=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('righelt.online-commands.v2');request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('commands'),read=tx.objectStore('commands').getAll();read.onsuccess=()=>{const pending=read.result.filter(command=>command.gameId===id).length;db.close();resolve(pending);};read.onerror=()=>{db.close();reject(read.error);};};
 }),id)).toBe(0);
 await page.screenshot({path:info.outputPath('computer-card-resumed.png')});
});

test('competing tabs transfer control deliberately without changing seats or model',async({page,context},info)=>{
 const id=await createComputer(page),before=await projected(page,id),other=await context.newPage();
 await other.goto(`/#/game/${id}`);await switchGamePanel(other,'players');
 const elsewhere=other.getByRole('button',{name:'Babs, Blue, Active in another tab',exact:true});await expect(elsewhere).toBeVisible();await elsewhere.click();
 await other.getByRole('button',{name:'Resume here',exact:true}).click();
 await expect(other.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible();
 const first=page.getByRole('button',{name:'Babs, Blue, Active in another tab',exact:true});await expect(first).toBeVisible();await first.click();
 await page.getByRole('button',{name:'Resume here',exact:true}).click();
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible();
 await expect(other.getByRole('button',{name:'Babs, Blue, Active in another tab',exact:true})).toBeVisible();
 const after=await projected(page,id);expect(after.computer.generation).toBe(before.computer.generation+2);
 expect(after.computer.seats).toEqual(before.computer.seats);expect(after.computer.modelId).toBe(before.computer.modelId);expect(after.gameplayRevision).toBe(before.gameplayRevision);
 await page.screenshot({path:info.outputPath('computer-competing-tabs.png')});
});

test('abrupt browser termination releases authority after lease expiry',async({browser,browserName,baseURL})=>{
 test.skip(browserName!=='chromium','The isolated process termination probe uses Chromium.');
 const server=await chromium.launchServer({headless:true,...browserLaunchOptions('chromium')});let restored;
 try {
  const original=await chromium.connect(server.wsEndpoint()),owner=await original.newContext({baseURL}),page=await owner.newPage();
  const id=await createComputer(page),before=await projected(page,id),storageState=await owner.storageState();
  const exited=new Promise(resolve=>server.process().once('exit',(code,signal)=>resolve({code,signal}))),disconnected=new Promise(resolve=>original.once('disconnected',resolve));
  await server.kill();await disconnected;expect((await exited).signal).toBe('SIGKILL');
  restored=await browser.newContext({baseURL,storageState});const other=await restored.newPage();
  await other.goto(`/#/game/${id}`);await switchGamePanel(other,'players');
  await expect(other.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:25000});
  const after=await projected(other,id);expect(after.computer.generation).toBeGreaterThan(before.computer.generation);expect(after.gameplayRevision).toBe(before.gameplayRevision);
 } finally {await restored?.close();await server.close();}
});

// This proves actual JavaScript suspension. Native OS background/freeze behavior
// remains a separate acceptance gap; Page.setWebLifecycleState emitted no events.
test('a suspended JavaScript renderer reacquires authority when resumed',async({page,context,browserName})=>{
 test.skip(browserName!=='chromium','The observed debugger suspension probe uses Chromium.');
 const id=await createComputer(page),initial=await projected(page,id),identity=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
 const read=async()=>{const response=await context.request.get(`/api/shell/games/${id}?identityId=${encodeURIComponent(identity)}`);expect(response.ok()).toBe(true);return (await response.json()).game;};
 const cdp=await context.newCDPSession(page),signals=[];let paused=false,before;
 cdp.on('Debugger.paused',()=>{paused=true;signals.push('paused');});cdp.on('Debugger.resumed',()=>signals.push('resumed'));
 await cdp.send('Debugger.enable');
 try {
  const stopped=new Promise(resolve=>cdp.once('Debugger.paused',resolve));await cdp.send('Debugger.pause');await stopped;
  before=await read();expect(before.computer.generation).toBe(initial.computer.generation);expect(before.computer.lease.deviceId).toBe(initial.computer.lease.deviceId);expect(before.computer.lease.expiresAt).toBeGreaterThan(Date.now());
  await expect.poll(async()=>{const control=(await read()).computer;expect(control.generation).toBe(before.computer.generation);expect(control.lease?.deviceId).toBe(before.computer.lease.deviceId);expect(control.lease?.expiresAt).toBe(before.computer.lease.expiresAt);return control.lease.expiresAt<=Date.now();},{timeout:25000}).toBe(true);
 } finally {
  if(paused){const resumed=new Promise(resolve=>cdp.once('Debugger.resumed',resolve));await cdp.send('Debugger.resume');await resumed;}
  await cdp.send('Debugger.disable');await test.info().attach('suspension-events',{body:JSON.stringify(signals),contentType:'application/json'});
 }
 expect(signals).toEqual(['paused','resumed']);
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:10000});
 await expect.poll(async()=>(await read()).computer.lease.expiresAt,{timeout:10000}).toBeGreaterThan(before.computer.lease.expiresAt);
 expect((await read()).gameplayRevision).toBe(initial.gameplayRevision);
});
