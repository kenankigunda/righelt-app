import {test,expect,chromium} from '@playwright/test';
import {browserLaunchOptions} from '../../scripts/playwright-launch-options.mjs';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {selectPlayableAction,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';

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

test('a human destination survives a real pending renewal and needs a fresh confirmation',async({page},info)=>{
 const id=await createComputer(page);await switchGamePanel(page,'board');
 const before=await projected(page,id),action=before.legalActions.find(value=>value.from&&value.to);
 expect(action).toBeTruthy();const target=await selectPlayableAction(page,action);
 const source=page.locator(`[data-testid="game-board"] .cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`);
 let release,original,originalHeaders;const deliveries=[],applies=[];
 const held=new Promise(resolve=>{release=resolve;});
 const pattern=`**/api/shell/games/${id}/**`;
 const readJournal=()=>page.evaluate(envelope=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('righelt.online-commands.v2');open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,read=db.transaction('commands').objectStore('commands').get([envelope.identityId,envelope.gameId,envelope.clientCommandId]);read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=()=>{db.close();resolve(read.result??null);};};
 }),original);
 const observe=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/api/shell/games/${id}/apply`){const envelope=request.postDataJSON();if(!envelope.payload?.computer)applies.push(envelope);}};
 page.on('request',observe);
 await page.route(pattern,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()==='POST'&&path.endsWith('/shared')){
   const envelope=request.postDataJSON();
   if(envelope.payload?.operation==='computer-control'&&envelope.payload.values?.action==='renew'){
    if(!original){original=envelope;originalHeaders=Object.fromEntries(Object.entries(request.headers()).filter(([name])=>name==='content-type'||name.startsWith('x-righelt-')));}
    deliveries.push(envelope);await held;
   }
  }else if(original&&path.endsWith('/reconcile'))await held;
  await route.continue();
 });
 try{
  await expect.poll(()=>Boolean(original)).toBe(true);
  expect(await readJournal()).toEqual(original);
  expect(original.expectedState).toEqual(before.board.state);expect(original.expectedGameplayRevision).toBe(before.gameplayRevision);
  const preClickClasses={source:await source.getAttribute('class'),target:await target.getAttribute('class')};
  await info.attach('held-control-preclick-classes',{contentType:'application/json',body:JSON.stringify(preClickClasses)});
  const fenced=await projected(page,id);expect(fenced.board).toEqual(before.board);expect(fenced.moves).toEqual(before.moves);expect(fenced.gameplayRevision).toBe(before.gameplayRevision);
  expect(applies).toEqual([]);
  await target.click();
  await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);
  await expect(target).toHaveClass(/(?:^|\s)target(?:\s|$)/);
  expect(applies).toEqual([]);expect(await readJournal()).toEqual(original);
  const blocked=await projected(page,id);expect(blocked.board).toEqual(before.board);expect(blocked.moves).toEqual(before.moves);expect(blocked.gameplayRevision).toBe(before.gameplayRevision);
  release();await expect.poll(readJournal).toBe(null);
  const response=await page.request.post(`/api/shell/games/${id}/reconcile`,{headers:originalHeaders,data:{protocolVersion:2,identityId:original.identityId,knownSnapshotEventSeq:0,commands:[original]}});
  expect(response.ok()).toBe(true);const body=await response.json(),outcomes=body.commandOutcomes.filter(value=>value.clientCommandId===original.clientCommandId);
  expect(outcomes).toHaveLength(1);expect(outcomes[0]).toMatchObject({outcome:'accepted',fingerprint:original.fingerprint,gameplayRevision:before.gameplayRevision});
  expect(applies).toEqual([],'settlement must not replay the blocked click');
  await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);await expect(target).toHaveClass(/(?:^|\s)target(?:\s|$)/);await expect(target).not.toHaveClass(/unselectable/);
  await target.click();
  await expect.poll(()=>applies.length).toBe(1);expect(applies[0].payload.action).toEqual(action);
  await expect.poll(async()=>(await projected(page,id)).moves.filter(move=>move.clientCommandId===applies[0].clientCommandId).length).toBe(1);
  const after=await projected(page,id),human=after.moves.filter(move=>move.clientCommandId===applies[0].clientCommandId);
  expect(human).toHaveLength(1);expect(human[0].action).toEqual(action);expect(after.gameplayRevision).toBeGreaterThanOrEqual(before.gameplayRevision+1);
  expect(applies).toHaveLength(1);for(const envelope of deliveries)expect(envelope).toEqual(original);
  await info.attach('blocked-renewal-and-explicit-confirmation',{contentType:'application/json',body:JSON.stringify({original,outcome:outcomes[0],action,submitted:applies[0]},null,2)});
 }finally{release();page.off('request',observe);await page.unrouteAll({behavior:'wait'});}
});

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

// The fault holds admitted delivery BEFORE backend acceptance. It does not
// pretend the server has committed the control or lost an acknowledgement.
test('Home reuse starts Tau while the previous admitted control delivery is unresolved',async({page},info)=>{
 const oldId=await createComputer(page);
 let release,originalEnvelope,originalHeaders,released=false;const deliveries=[];
 const held=new Promise(resolve=>{release=()=>{released=true;resolve();};});
 const pattern=`**/api/shell/games/${oldId}/**`;
 const journalRecord=()=>page.evaluate(envelope=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('righelt.online-commands.v2');open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction('commands'),read=tx.objectStore('commands').get([envelope.identityId,envelope.gameId,envelope.clientCommandId]);
   read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=()=>{const record=read.result;db.close();resolve(record??null);};
  };
 }),originalEnvelope);
 const readOriginalOutcome=async()=>{
  const response=await page.request.post(`/api/shell/games/${oldId}/reconcile`,{headers:originalHeaders,
   data:{protocolVersion:2,identityId:originalEnvelope.identityId,knownSnapshotEventSeq:0,commands:[originalEnvelope]}});
  expect(response.ok()).toBe(true);const body=await response.json();
  const outcomes=body.commandOutcomes.filter(outcome=>outcome.clientCommandId===originalEnvelope.clientCommandId);
  expect(outcomes).toHaveLength(1);expect(outcomes[0].fingerprint).toBe(originalEnvelope.fingerprint);return outcomes[0];
 };
 const expectOriginalUnresolved=async()=>{
  expect(released).toBe(false);expect(await journalRecord()).toEqual(originalEnvelope);
  expect((await readOriginalOutcome()).outcome).toBe('unknown');
  for(const envelope of deliveries)expect(envelope).toEqual(originalEnvelope);
 };
 await page.route(pattern,async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;let control=false;
  if(request.method()==='POST'&&pathname.endsWith('/shared')){
   const envelope=request.postDataJSON();control=envelope.payload?.operation==='computer-control';
   if(control){
    deliveries.push(envelope);
    if(!originalEnvelope&&envelope.payload.values?.action==='renew'){
     originalEnvelope=envelope;
     originalHeaders=Object.fromEntries(Object.entries(request.headers()).filter(([name])=>name==='content-type'||name.startsWith('x-righelt-')));
    }
   }
  }
  if(originalEnvelope&&(control||pathname.endsWith('/reconcile')))await held;
  await route.continue();
 });
 try{
  await page.waitForRequest(request=>{
   if(request.method()!=='POST'||!request.url().endsWith(`/games/${oldId}/shared`))return false;
   return request.postDataJSON().payload?.values?.action==='renew';
  });
  await expect.poll(()=>Boolean(originalEnvelope)).toBe(true);await expectOriginalUnresolved();
  await page.locator('.shell-header-title-link').click();await expect(page.getByTestId('home-create-game')).toBeVisible();
  await page.locator('[data-action="opponent-story"][data-opponent="tau"]').click();await waitForOpponentReady(page);
  const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Play Tau',exact:true}).click();
  const response=await creation;expect(response.ok()).toBe(true);const game=(await response.json()).game;
  expect(game.id).not.toBe(oldId);expect(game.computer.seats).toEqual({p1:null,p2:'tau'});
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);await switchGamePanel(page,'players');
  await expect(page.getByRole('button',{name:'Tau, Blue, Active here',exact:true})).toBeVisible();await expectOriginalUnresolved();
  await switchGamePanel(page,'board');const playable=await projected(page,game.id);
  await submitPlayableAction(page,playable.legalActions.find(action=>action.from&&action.to));
  if((await projected(page,game.id)).canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
  await waitForComputerDecision(page,game.id,'tau',{guest:true,modelId:game.computer.modelId});await expectOriginalUnresolved();
  expect((await projected(page,game.id)).moves.some(move=>move.computerProof?.profile==='tau')).toBe(true);
  // Submit the original envelope once via the native request context. Browser
  // delivery remains held. An expired old lease may explicitly reject renew;
  // that terminal outcome must be shown honestly, never silently discarded.
  const settlement=await page.request.post(`/api/shell/games/${oldId}/shared`,{headers:originalHeaders,data:originalEnvelope});
  expect(settlement.ok()).toBe(true);const body=await settlement.json();
  const outcomes=body.commandOutcomes.filter(outcome=>outcome.clientCommandId===originalEnvelope.clientCommandId);
  expect(outcomes).toHaveLength(1);const terminal=outcomes[0];
  expect(terminal.fingerprint).toBe(originalEnvelope.fingerprint);expect(['accepted','rejected']).toContain(terminal.outcome);
  if(terminal.outcome==='rejected')expect(terminal.reason).toBe('computer_control_changed');
  await info.attach('original-control-terminal-outcome',{contentType:'application/json',body:JSON.stringify({clientCommandId:terminal.clientCommandId,fingerprint:terminal.fingerprint,outcome:terminal.outcome,reason:terminal.reason})});
  release();await expect.poll(journalRecord).toBe(null);
  expect(await readOriginalOutcome()).toEqual(terminal);
  for(const envelope of deliveries)expect(envelope).toEqual(originalEnvelope);
 }finally{release();await page.unrouteAll({behavior:'wait'});}
});
