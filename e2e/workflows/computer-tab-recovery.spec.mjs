import {test,expect,chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
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

test('a human destination survives fresh renewal and its first confirmation reaches one receipt',async({page},info)=>{
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
    // Later lease periods may create new commands after this one settles.
    // While the original remains in the journal, every retry must retain it.
    if(envelope.clientCommandId===original.clientCommandId)expect(envelope).toEqual(original);
    else expect(await readJournal(),'A new renewal must wait for the original journal settlement').toBe(null);
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
  await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);await expect(target).toHaveClass(/(?:^|\s)target(?:\s|$)/);
  await target.click();
  const pendingAction=()=>page.evaluate(id=>new Promise((resolve,reject)=>{
   const open=indexedDB.open('righelt.online-commands.v2');open.onerror=()=>reject(open.error);
   open.onsuccess=()=>{const db=open.result,read=db.transaction('commands').objectStore('commands').getAll();read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=()=>{db.close();resolve(read.result.filter(value=>value.gameId===id&&value.kind==='action'));};};
  }),id);
  await expect.poll(pendingAction).toHaveLength(1);const admitted=(await pendingAction())[0];
  expect(admitted.payload.action).toEqual(action);expect(admitted.expectedGameplayRevision).toBe(before.gameplayRevision);
  expect(admitted.predecessor).toEqual({clientCommandId:original.clientCommandId,fingerprint:original.fingerprint});
  await expect(page.getByTestId('history-pending-move-item')).toHaveCount(1);
  expect(applies).toEqual([]);expect(await readJournal()).toEqual(original);
  const blocked=await projected(page,id);expect(blocked.board).toEqual(before.board);expect(blocked.moves).toEqual(before.moves);expect(blocked.gameplayRevision).toBe(before.gameplayRevision);
  for(const envelope of deliveries)expect(envelope).toEqual(original);
  release();await expect.poll(readJournal).toBe(null);
  await expect.poll(()=>applies.length).toBe(1);expect(applies[0]).toEqual(admitted);
  await expect.poll(async()=>(await projected(page,id)).moves.filter(move=>move.clientCommandId===admitted.clientCommandId).length).toBe(1);
  const response=await page.request.post(`/api/shell/games/${id}/reconcile`,{headers:originalHeaders,data:{protocolVersion:2,identityId:original.identityId,knownSnapshotEventSeq:0,commands:[original,admitted]}});
  expect(response.ok()).toBe(true);const body=await response.json(),outcomes=body.commandOutcomes.filter(value=>value.clientCommandId===original.clientCommandId);
  expect(outcomes).toHaveLength(1);expect(outcomes[0]).toMatchObject({outcome:'accepted',fingerprint:original.fingerprint,gameplayRevision:before.gameplayRevision});
  expect(body.commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:admitted.clientCommandId,fingerprint:admitted.fingerprint,outcome:'accepted',gameplayRevision:before.gameplayRevision+1}));
  const after=await projected(page,id),human=after.moves.filter(move=>move.clientCommandId===applies[0].clientCommandId);
  expect(human).toHaveLength(1);expect(human[0].action).toEqual(action);expect(after.gameplayRevision).toBeGreaterThanOrEqual(before.gameplayRevision+1);
  expect(applies).toHaveLength(1);
  const renewalById=new Map();
  for(const envelope of deliveries){const first=renewalById.get(envelope.clientCommandId);if(first)expect(envelope).toEqual(first);else renewalById.set(envelope.clientCommandId,envelope);}
  await info.attach('fresh-renewal-and-first-confirmation',{contentType:'application/json',body:JSON.stringify({original,outcome:outcomes[0],action,submitted:applies[0]},null,2)});
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

// Observe before admission so renewal-onset flashes cannot hide behind the hold.
// The >=4s copy/deadline boundaries are deterministic CPU cases, not a native race.
test('a routine human-turn renewal stays quiet until real control becomes uncertain',async({page},info)=>{
 const id=await createComputer(page);await switchGamePanel(page,'board');
 const initial=await projected(page,id);expect(initial.computer.modelId).toBe('initial-1554');
 await submitPlayableAction(page,initial.legalActions.find(action=>action.from&&action.to));
 if((await projected(page,id)).canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
 await waitForComputerDecision(page,id,'babs',{guest:true,modelId:'initial-1554'});
 await expect.poll(async()=>{const g=await projected(page,id);return g.board.state.sideToMove==='P1'&&!g.board.state.continuation;}).toBe(true);
 const before=await projected(page,id);expect(before.legalActions.some(action=>action.type==='pass')).toBe(true);
 const pass=page.locator('#shell-board-preview-label [data-board-message-action="pass"], #shell-board-preview-label [data-board-preview-action="pass"]');
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible();await expect(pass).toBeVisible();
 expect(before.computer.lease.expiresAt).toBeGreaterThan(Date.now());
 let release,original,originalHeaders,observerReadyAt=null;const deliveries=[],writes=[],samples=[];
 const held=new Promise(resolve=>{release=resolve;});const pattern=`**/api/shell/games/${id}/**`;
 const journalRecord=()=>page.evaluate(envelope=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('righelt.online-commands.v2');open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,read=db.transaction('commands').objectStore('commands').get([envelope.identityId,envelope.gameId,envelope.clientCommandId]);read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=()=>{db.close();resolve(read.result??null);};};
 }),original);
 const prefix='quiet-renew-readonly:';
 const consoleSample=message=>{if(message.text().startsWith(prefix))samples.push(JSON.parse(message.text().slice(prefix.length)));};
 const observeWrite=request=>{if(request.method()==='POST'&&new RegExp(`/games/${id}/(apply|end-turn)$`).test(new URL(request.url()).pathname))writes.push(request.postDataJSON());};
 page.on('console',consoleSample);page.on('request',observeWrite);
 await page.route(pattern,async route=>{
  const request=route.request(),pathname=new URL(request.url()).pathname;let renewal=false;
  if(request.method()==='POST'&&pathname.endsWith('/shared')){
   const envelope=request.postDataJSON();renewal=envelope.payload?.operation==='computer-control'&&envelope.payload.values?.action==='renew';
   if(renewal&&observerReadyAt!==null&&envelope.submittedAt>=observerReadyAt){
    if(!original){original=envelope;originalHeaders=Object.fromEntries(Object.entries(request.headers()).filter(([name])=>name==='content-type'||name.startsWith('x-righelt-')));}
    deliveries.push(envelope);await held;
   }
  }else if(original&&pathname.endsWith('/reconcile'))await held;
  try{await route.continue();}catch(error){if(!request.failure())throw error;}
 });
 try{
  // Read-only observer persists in its closure, not in app state or a test hook.
  // Console samples are raw synchronous DOM reads, including the admission onset.
  observerReadyAt=await page.evaluate(({prefix,id})=>{
   let firstPass=null;
   const read=()=>{
    const label=document.querySelector('#shell-board-preview-label'),card=document.querySelector('[data-computer-activity]'),wrap=document.querySelector('[data-testid="game-board-wrap"]');
    const pass=label?.querySelector('[data-board-message-action="pass"], [data-board-preview-action="pass"]');if(!firstPass)firstPass=pass;
    return {at:Date.now(),gameId:document.querySelector('[data-testid="game-shell"]')?.getAttribute('data-game-id'),
     narration:label?[...label.childNodes].filter(node=>node.nodeType!==1||node.tagName!=='BUTTON').map(node=>node.textContent).join('').trim():'',
     activity:card?.getAttribute('data-computer-activity'),activityText:card?.textContent.trim(),connected:!!card?.querySelector('.is-connected'),
     announcement:document.querySelector('#shell-sync-announcement')?.textContent??'',
     reconnecting:wrap?.getAttribute('data-reconnecting'),busy:wrap?.getAttribute('aria-busy'),
     recovery:[...document.querySelectorAll('[data-testid="sync-recovery-banner"]')].map(node=>node.textContent),
     pass:!!pass,passEnabled:!!pass&&!pass.disabled,samePass:pass===firstPass};
   };
   window.readQuietRenewalFixture=read;
   let last='',count=0;const emit=()=>{const value=read(),key=JSON.stringify({...value,at:0});if(key!==last){last=key;count++;console.debug(prefix+JSON.stringify(count<=500?value:{at:Date.now(),overflow:true}));}};
   const observer=new MutationObserver(emit);observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});emit();
   // This owned passive observer expires even if an assertion fails; closing the
   // test page also disposes it. It never changes DOM, clock or app authority.
   setTimeout(()=>{observer.disconnect();delete window.readQuietRenewalFixture;},25000);
   if(read().gameId!==id)throw Error('Observer armed on the wrong game');return Date.now();
  },{prefix,id});
  await expect.poll(()=>Boolean(original)).toBe(true);expect(original.submittedAt).toBeGreaterThanOrEqual(observerReadyAt);
  expect(await journalRecord()).toEqual(original);expect(original.payload.values.action).toBe('renew');
  expect(original.expectedGameplayRevision).toBe(before.gameplayRevision);expect(original.expectedState).toEqual(before.board.state);
  const heldAuthority=await projected(page,id);expect(heldAuthority.computer.generation).toBe(original.payload.values.generation);
  expect(heldAuthority.computer.lease.deviceId).toBe(original.payload.values.deviceId);expect(heldAuthority.computer.lease.expiresAt).toBeGreaterThan(Date.now());
  // One comfortably short first-send interval, not the 4..5s native timing race.
  // Stable narration/actions can produce no deduplicated mutation sample.
  // Take an independent read-only first-send snapshot even in that quiet case.
  const firstSend=await page.evaluate(submittedAt=>new Promise(resolve=>setTimeout(()=>resolve(window.readQuietRenewalFixture()),Math.max(0,submittedAt+1000-Date.now()))),original.submittedAt);
  const sampledAt=firstSend.at;samples.push(firstSend);
  expect(sampledAt-original.submittedAt).toBeLessThan(5000);
  await expect(pass).toBeVisible();await expect(pass).toBeEnabled();expect(await journalRecord()).toEqual(original);
  const early=samples.filter(sample=>sample.at>=original.submittedAt&&sample.at<=sampledAt);
  expect(early.length).toBeGreaterThan(0);expect(samples.some(sample=>sample.overflow)).toBe(false);
  const narration=samples[0].narration;expect(narration).toMatch(/Babs /);
  for(const sample of early){
   expect(sample.gameId).toBe(id);expect(sample.narration).toBe(narration);expect(sample.activity).toBe('here');expect(sample.activityText).toBe('Active here');expect(sample.connected).toBe(true);
   expect(sample.pass).toBe(true);expect(sample.passEnabled).toBe(true);expect(sample.samePass).toBe(true);
   expect(sample.announcement).not.toMatch(/Updating computer play|Needs attention|Reconnecting|Saving/);
   expect(sample.recovery.join(' ')).not.toMatch(/Updating computer play|Needs attention/);expect(sample.reconnecting).not.toBe('true');expect(sample.busy).not.toBe('true');
  }
  await info.attach('quiet-renew-first-send',{contentType:'image/png',body:await page.screenshot({path:info.outputPath('quiet-renew-first-send.png')})});
  await writeFile(info.outputPath('quiet-renew-first-send.json'),JSON.stringify({observerReadyAt,original,sampledAt,early},null,2));
  // Real request timeout and real server lease expiry must restore attention.
  await expect(page.getByRole('button',{name:'Babs, Blue, Needs attention',exact:true})).toBeVisible();
  await expect(pass).toBeDisabled();
  await expect(page.getByTestId('sync-recovery-banner')).toContainText(/updating computer play|retry|details/i);
  await expect.poll(()=>Date.now()).toBeGreaterThanOrEqual(heldAuthority.computer.lease.expiresAt);
  await expect(page.getByRole('button',{name:'Babs, Blue, Needs attention',exact:true})).toBeVisible();
  await info.attach('quiet-renew-expired-lease',{contentType:'image/png',body:await page.screenshot({path:info.outputPath('quiet-renew-expired-lease.png')})});
  expect(await journalRecord()).toEqual(original);expect(writes).toEqual([]);
  const fenced=await projected(page,id);expect(fenced.board).toEqual(before.board);expect(fenced.moves).toEqual(before.moves);expect(fenced.gameplayRevision).toBe(before.gameplayRevision);
  for(const envelope of deliveries)expect(envelope).toEqual(original);
  release();
  // The first delivery may now have timed out. Submit the exact admitted intent
  // through the existing native request context, never a fresh command ID.
  const response=await page.request.post(`/api/shell/games/${id}/shared`,{headers:originalHeaders,data:original});expect(response.ok()).toBe(true);
  const body=await response.json(),outcomes=body.commandOutcomes.filter(outcome=>outcome.clientCommandId===original.clientCommandId);
  expect(outcomes).toHaveLength(1);expect(outcomes[0]).toMatchObject({outcome:'rejected',reason:'computer_control_changed',fingerprint:original.fingerprint,gameplayRevision:before.gameplayRevision});
  await expect.poll(journalRecord).toBe(null);await expect(pass).toBeVisible();
  const after=await projected(page,id);expect(after.board).toEqual(before.board);expect(after.moves).toEqual(before.moves);expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(writes).toEqual([]);
  await writeFile(info.outputPath('quiet-renew-real-journey.json'),JSON.stringify({observerReadyAt,original,sampledAt,samples,outcome:outcomes[0],writes},null,2));
  await info.attach('quiet-renew-real-journey',{contentType:'application/json',path:info.outputPath('quiet-renew-real-journey.json')});
 }finally{
  try{await writeFile(info.outputPath('quiet-renew-raw-samples.json'),JSON.stringify({observerReadyAt,original,samples},null,2));await info.attach('quiet-renew-raw-samples',{contentType:'application/json',path:info.outputPath('quiet-renew-raw-samples.json')});}catch{}
  release();page.off('console',consoleSample);page.off('request',observeWrite);await page.unrouteAll({behavior:'wait'});}
});


for (const fault of ['manifest unavailable', 'evidence response lost', 'evidence write unavailable']) test(`computer play automatically recovers when ${fault}`, async ({ page }, info) => {
  const id = await createComputer(page);
  const initial = await projected(page, id);
  let injected = false, manifestRequests = 0, lostWrite = null;
  const evidenceReads = [], writes = [], submissions = [];
  const observe = request => {
    if (request.method() !== 'POST') return;
    try { const body = request.postDataJSON(); if (body?.payload?.computer) submissions.push(body); } catch {}
  };
  page.on('request', observe);
  await page.route('**/computer/runtime/manifest.json', async route => {
    manifestRequests++;
    if (fault === 'manifest unavailable' && !injected) { injected = true; await route.fulfill({ status: 503, body: 'Temporary failure' }); }
    else await route.continue();
  });
  await page.route(`**/api/shell/games/${id}/decision-attempt`, async route => {
    const body = route.request().postDataJSON();
    if (body.operation === 'read') evidenceReads.push(body);
    else writes.push(body);
    if (fault !== 'manifest unavailable' && !injected && body.operation === 'write' && body.attempt?.outcome === 'ready') {
      injected = true; lostWrite = structuredClone(body);
      if (fault === 'evidence write unavailable') {
        // Fail before backend persistence, unlike the lost-response variant.
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ok:false,error:'local_api_unavailable'}) });
      } else {
        const persisted = await route.fetch(); expect(persisted.ok()).toBe(true);
        await route.abort('failed');
      }
    } else await route.continue();
  });
  try {
    await switchGamePanel(page, 'board');
    await submitPlayableAction(page, initial.legalActions.find(action => action.from && action.to));
    if ((await projected(page, id)).canEndTurn) await page.locator('[data-board-preview-action="end-turn"]').click();
    await waitForComputerDecision(page, id, 'babs', { guest: true, modelId: initial.computer.modelId });
    expect(injected).toBe(true);
    const result = await projected(page, id);
    const moves = result.moves.filter(move => move.computerProof);
    expect(moves.length).toBeGreaterThan(0);
    expect(new Set(moves.map(move => move.moveId)).size).toBe(moves.length);
    const byRevision = new Map();
    for (const envelope of submissions) {
      const first = byRevision.get(envelope.expectedGameplayRevision);
      if (first) expect(envelope).toEqual(first);
      else byRevision.set(envelope.expectedGameplayRevision, envelope);
    }
    if (fault === 'manifest unavailable') expect(manifestRequests).toBeGreaterThanOrEqual(2);
    else {
      expect(evidenceReads.some(read => read.attemptId === lostWrite.attemptId)).toBe(true);
      const sameAttemptWrites = writes.filter(write => write.attemptId === lostWrite.attemptId);
      for (const write of sameAttemptWrites) expect(write).toEqual(lostWrite);
      if (fault === 'evidence write unavailable') expect(sameAttemptWrites.length).toBeGreaterThanOrEqual(2);
      expect(moves.filter(move => move.computerProof.attemptId === lostWrite.attemptId)).toHaveLength(1);
    }
    const evidence = { fault, injected, manifestRequests, lostWrite, evidenceReads, submissions, moves };
    await writeFile(info.outputPath('automatic-computer-recovery.json'), JSON.stringify(evidence, null, 2));
    await page.screenshot({path:info.outputPath('automatic-computer-recovery.png')});
    await info.attach('automatic-computer-recovery', { contentType: 'application/json', body: JSON.stringify(evidence, null, 2) });
  } finally { page.off('request', observe); await page.unrouteAll({ behavior: 'wait' }); }
});

test('an explicit human Pass during fresh renewal reaches one authoritative receipt',async({page},info)=>{
 const id=await createComputer(page);await switchGamePanel(page,'board');
 const initial=await projected(page,id);await submitPlayableAction(page,initial.legalActions.find(action=>action.from&&action.to));
 if((await projected(page,id)).canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
 await waitForComputerDecision(page,id,'babs',{guest:true,modelId:initial.computer.modelId});
 await expect.poll(async()=>{const game=await projected(page,id);return game.board.state.sideToMove==='P1'&&!game.board.state.continuation;}).toBe(true);
 const before=await projected(page,id),pass=page.locator('#shell-board-preview-label [data-board-message-action="pass"], #shell-board-preview-label [data-board-preview-action="pass"]');
 let renewal,renewalHeaders,release;const held=new Promise(resolve=>{release=resolve;}),humanRequests=[];
 const observe=request=>{if(request.method()!=='POST'||new URL(request.url()).pathname!==`/api/shell/games/${id}/apply`)return;const value=request.postDataJSON();if(!value.payload?.computer&&value.payload?.action?.type==='pass')humanRequests.push(value);};
 page.on('request',observe);
 await page.route(`**/api/shell/games/${id}/shared`,async route=>{
  const value=route.request().postDataJSON();
  if(!renewal&&value.payload?.operation==='computer-control'&&value.payload.values?.action==='renew'){renewal=value;renewalHeaders=Object.fromEntries(Object.entries(route.request().headers()).filter(([name])=>name==='content-type'||name.startsWith('x-righelt-')));await held;}
  await route.continue();
 });
 const journal=()=>page.evaluate(id=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('righelt.online-commands.v2');open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{const db=open.result,read=db.transaction('commands').objectStore('commands').getAll();read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=()=>{db.close();resolve(read.result.filter(value=>value.gameId===id));};};
 }),id);
 try{
  await expect.poll(()=>Boolean(renewal)).toBe(true);await expect(pass).toBeEnabled();
  await pass.click();
  await expect.poll(async()=>(await journal()).filter(value=>value.kind==='action'&&value.payload?.action?.type==='pass')).toHaveLength(1);
  const admitted=(await journal()).find(value=>value.kind==='action'&&value.payload?.action?.type==='pass');
  expect(admitted.expectedGameplayRevision).toBe(before.gameplayRevision);expect(admitted.expectedState).toEqual(before.board.state);
  expect(admitted.predecessor).toEqual({clientCommandId:renewal.clientCommandId,fingerprint:renewal.fingerprint});
  await expect(page.getByTestId('history-pending-move-item').filter({hasText:'PASS'})).toHaveCount(1);
  expect(humanRequests).toHaveLength(0);release();
  // WebSocket acknowledgement may settle and cancel the HTTP delivery. Read
  // the same durable receipts without resubmitting either command.
  await expect.poll(async()=>(await projected(page,id)).moves.filter(move=>move.clientCommandId===admitted.clientCommandId)).toHaveLength(1);
  const response=await page.request.post(`/api/shell/games/${id}/reconcile`,{headers:renewalHeaders,data:{protocolVersion:2,identityId:renewal.identityId,knownSnapshotEventSeq:0,commands:[renewal,admitted]}});
  expect(response.status()).toBe(200);const body=await response.json();
  expect(body.commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:renewal.clientCommandId,fingerprint:renewal.fingerprint,outcome:'accepted',gameplayRevision:before.gameplayRevision}));
  expect(body.commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:admitted.clientCommandId,fingerprint:admitted.fingerprint,outcome:'accepted',gameplayRevision:before.gameplayRevision+1}));
  expect(body.game.moves.filter(move=>move.clientCommandId===admitted.clientCommandId)).toHaveLength(1);expect(humanRequests).toEqual([admitted]);
  await expect.poll(async()=>(await journal()).some(value=>value.clientCommandId===admitted.clientCommandId)).toBe(false);
  await writeFile(info.outputPath('quiet-renew-explicit-pass.json'),JSON.stringify({beforeRevision:before.gameplayRevision,renewal,admitted,outcomes:body.commandOutcomes,humanRequests},null,2));
 }finally{release();page.off('request',observe);await page.unrouteAll({behavior:'wait'});}
});
