import {test,expect,chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {COMPUTER_TIMING} from '../../apps/web/generated/packages/shared-types/src/computer-play.js';
import {createNaturalRenewalLeaseObserver} from '../support/natural-renewal-hold.mjs';
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
 await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible({timeout:20000});return game.id;
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
 await expect(next.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible({timeout:25000});
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
 // Setup uses fresh owned authority, then chains only accepted responses.
 // No projection/DOM gap, retry or sleep may turn a refusal into success.
 await page.evaluate(async({id,header})=>{
  const assert=(condition,message)=>{if(!condition)throw Error(`Fresh owned control fixture: ${message}`);};
  const equal=(actual,expected,message)=>assert(JSON.stringify(actual)===JSON.stringify(expected),message);
  const flags=game=>[game.computer.paused,game.computer.manual,game.computer.singleStep,game.computer.takeoverTurn];
  const bootstrap=await fetch('/api/shell/bootstrap');
  assert(bootstrap.status===200,'bootstrap must return200');
  assert((await bootstrap.json()).ok===true,'bootstrap must be ok');
  const storageGeneration=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
  assert(typeof identityId==='string'&&identityId.length>0,'existing guest identity missing');
  const headers={'Content-Type':'application/json',...(storageGeneration?{[header]:storageGeneration}:{})};
  const gameUrl=`/api/shell/games/${id}?identityId=${encodeURIComponent(identityId)}`;
  const validate=(body,label)=>{
   assert(body.ok===true,`${label} must be ok`);assert(body.game?.id===id,`${label} must name exact game`);
   assert(Number.isSafeInteger(body.eventSeq)&&body.eventSeq>=0,`${label} eventSeq must be safe`);
   assert(Number.isSafeInteger(body.game.computer?.generation)&&body.game.computer.generation>=0,`${label} generation must be safe`);
   assert(typeof body.game.computer.lease?.deviceId==='string'&&body.game.computer.lease.deviceId.length>0,`${label} lease device missing`);
   return body;
  };
  // The one initial read supplies the expected generation/device. Every setup
  // mutation thereafter takes its authority from the immediately prior200.
  const initialResponse=await fetch(gameUrl,{headers});
  assert(initialResponse.status===200,'initial game must return200');
  const initial=validate(await initialResponse.json(),'initial game');
  const control=async(action,previous,expectedFlags)=>{
   const previousControl=previous.game.computer;
   const response=await fetch(`/api/shell/games/${id}/computer-control`,{method:'POST',headers,
    body:JSON.stringify({identityId,protocolVersion:2,action,deviceId:previousControl.lease.deviceId,generation:previousControl.generation})});
   assert(response.status===200,`${action} must return200, received${response.status}`);
   const accepted=validate(await response.json(),action);
   assert(accepted.eventSeq>previous.eventSeq,`${action} eventSeq must advance`);
   assert(accepted.game.computer.lease.deviceId===previousControl.lease.deviceId,`${action} lease must belong to exact device`);
   if(action==='acquire'){
    // A live same-device acquire keeps its generation; reclaiming an expired
    // lease advances it once. Neither path bypasses the real server guard.
    assert(accepted.game.computer.generation===previousControl.generation||accepted.game.computer.generation===previousControl.generation+1,'acquire generation must stay or advance once');
    assert(Number.isFinite(accepted.game.computer.lease.expiresAt)&&accepted.game.computer.lease.expiresAt>Date.now(),'acquire must return a fresh owned lease');
   }else assert(accepted.game.computer.generation===previousControl.generation+1,`${action} generation must advance once`);
   equal(flags(accepted.game),expectedFlags,`${action} flags mismatch`);
   return accepted;
  };
  const acquired=await control('acquire',initial,[false,false,false,null]);
  const turnIndex=acquired.game.currentTurn?.index??acquired.game.board.state.turnIndex;
  assert(Number.isSafeInteger(turnIndex)&&turnIndex>=0,'takeover turn must be safe');
  const takeover=await control('takeover',acquired,[false,false,false,turnIndex]);
  const manual=await control('manual',takeover,[false,true,false,turnIndex]);
  const paused=await control('pause',manual,[true,true,false,turnIndex]);
  // The immediately preceding generation is now genuinely stale. This is a
  // real rejected request, not an ignored refusal or a retry of positive setup.
  const refusal=await fetch(`/api/shell/games/${id}/computer-control`,{method:'POST',headers,
   body:JSON.stringify({identityId,protocolVersion:2,action:'pause',deviceId:paused.game.computer.lease.deviceId,generation:manual.game.computer.generation})});
  assert(refusal.status===409,`stale generation must return409, received${refusal.status}`);
  const rejected=await refusal.json();
  assert(rejected.ok===false&&rejected.error==='computer_control_changed','stale generation must explicitly reject computer_control_changed');
  const readbackResponse=await fetch(gameUrl,{headers});
  assert(readbackResponse.status===200,'refusal readback must return200');
  const readback=validate(await readbackResponse.json(),'refusal readback');
  equal(flags(readback.game),[true,true,false,turnIndex],'refusal must preserve intended flags');
  const authoritative=body=>({eventSeq:body.eventSeq,gameId:body.game.id,gameplayRevision:body.game.gameplayRevision,
   computer:body.game.computer,board:body.game.board,moves:body.game.moves,turns:body.game.turns,currentTurn:body.game.currentTurn});
  equal(authoritative(readback),authoritative(paused),'refusal must leave authoritative generation and state unchanged');
 },{id,header:STORAGE_GENERATION_HEADER});
 const card=page.getByRole('button',{name:'Babs, Blue, Computer player, Paused',exact:true});await expect(card).toBeVisible();await card.click();
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
 await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible({timeout:25000});
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
 const elsewhere=other.getByRole('button',{name:'Babs, Blue, Computer player, Active in another tab',exact:true});await expect(elsewhere).toBeVisible();await elsewhere.click();
 await other.getByRole('button',{name:'Resume here',exact:true}).click();
 await expect(other.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible();
 const first=page.getByRole('button',{name:'Babs, Blue, Computer player, Active in another tab',exact:true});await expect(first).toBeVisible();await first.click();
 await page.getByRole('button',{name:'Resume here',exact:true}).click();
 await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible();
 await expect(other.getByRole('button',{name:'Babs, Blue, Computer player, Active in another tab',exact:true})).toBeVisible();
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
  await expect(other.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible({timeout:25000});
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
 await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible({timeout:10000});
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
  await expect(page.getByRole('button',{name:'Tau, Blue, Computer player, Active here',exact:true})).toBeVisible();await expectOriginalUnresolved();
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
 await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Active here',exact:true})).toBeVisible();await expect(pass).toBeVisible();
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
     guidance:label?.textContent.trim()??'',
     activity:card?.getAttribute('data-computer-activity'),activityName:card?.closest('.participant-computer')?.getAttribute('aria-label'),markColor:card?.querySelector('.computer-status-mark')?getComputedStyle(card.querySelector('.computer-status-mark')).backgroundColor:null,
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
  const guidance=samples[0].guidance;expect(guidance).toMatch(/Select a piece or\s*Pass/);
  for(const sample of early){
   expect(sample.gameId).toBe(id);expect(sample.guidance).toBe(guidance);expect(sample.activity).toBe('here');expect(sample.activityName).toBe('Babs, Blue, Computer player, Active here');expect(sample.markColor).toBe('rgb(62, 167, 106)');
   expect(sample.pass).toBe(true);expect(sample.passEnabled).toBe(true);expect(sample.samePass).toBe(true);
   expect(sample.announcement).not.toMatch(/Updating computer play|Needs attention|Reconnecting|Saving/);
   expect(sample.recovery.join(' ')).not.toMatch(/Updating computer play|Needs attention/);expect(sample.reconnecting).not.toBe('true');expect(sample.busy).not.toBe('true');
  }
  await info.attach('quiet-renew-first-send',{contentType:'image/png',body:await page.screenshot({path:info.outputPath('quiet-renew-first-send.png')})});
  await writeFile(info.outputPath('quiet-renew-first-send.json'),JSON.stringify({observerReadyAt,original,sampledAt,early},null,2));
  // Confirmation feedback is separate from intervention. Routine renewal loss
  // and lease expiry keep this card quiet while its admitted intent recovers.
  await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Waiting',exact:true})).toBeVisible();
  await expect(pass).toBeDisabled();
  await pass.evaluate(button=>{
   const samples=[{disabled:button.disabled,hidden:document.hidden,focused:document.hasFocus()}];
   const observer=new MutationObserver(()=>samples.push({disabled:button.disabled,hidden:document.hidden,focused:document.hasFocus()}));
   observer.observe(button,{attributes:true,attributeFilter:['disabled']});
   globalThis.__tabReturnAvailability={button,samples,observer};
  });
  await expect(page.getByTestId('sync-recovery-banner')).toContainText(/updating computer play|retry|details/i);
  await expect.poll(()=>Date.now()).toBeGreaterThanOrEqual(heldAuthority.computer.lease.expiresAt);
  await expect(page.getByRole('button',{name:'Babs, Blue, Computer player, Waiting',exact:true})).toBeVisible();
  await expect(page.locator('[data-computer-activity="attention"]')).toHaveCount(0);
  await info.attach('quiet-renew-expired-lease',{contentType:'image/png',body:await page.screenshot({path:info.outputPath('quiet-renew-expired-lease.png')})});
  expect(await journalRecord()).toEqual(original);expect(writes).toEqual([]);
  const fenced=await projected(page,id);expect(fenced.board).toEqual(before.board);expect(fenced.moves).toEqual(before.moves);expect(fenced.gameplayRevision).toBe(before.gameplayRevision);
  for(const envelope of deliveries)expect(envelope).toEqual(original);
  await page.evaluate(()=>{
   Object.defineProperty(document,'hidden',{configurable:true,value:true});
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(()=>page.evaluate(()=>document.hidden)).toBe(true);
  await pass.evaluate(button=>button.click());expect(writes).toEqual([]);
  release();
  // The first delivery may now have timed out. Submit the exact admitted intent
  // through the existing native request context, never a fresh command ID.
  const response=await page.request.post(`/api/shell/games/${id}/shared`,{headers:originalHeaders,data:original});expect(response.ok()).toBe(true);
  const body=await response.json(),outcomes=body.commandOutcomes.filter(outcome=>outcome.clientCommandId===original.clientCommandId);
  expect(outcomes).toHaveLength(1);expect(outcomes[0]).toMatchObject({outcome:'rejected',reason:'computer_control_changed',fingerprint:original.fingerprint,gameplayRevision:before.gameplayRevision});
  await expect.poll(journalRecord).toBe(null);await expect(pass).toBeVisible();
  const after=await projected(page,id);expect(after.board).toEqual(before.board);expect(after.moves).toEqual(before.moves);expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(writes).toEqual([]);
  await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>page.evaluate(()=>document.hidden)).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.__righeltLiveSyncMetrics?.activeSocketCount??0)).toBeGreaterThan(0);
  await expect(pass).toBeEnabled();
  const tabReturn=await pass.evaluate(button=>{const owner=globalThis.__tabReturnAvailability;owner.observer.disconnect();return {sameButton:owner.button===button,disabled:button.disabled,samples:owner.samples,hidden:document.hidden,focused:document.hasFocus()};});
  expect(tabReturn).toMatchObject({sameButton:true,disabled:false,hidden:false});
  expect(tabReturn.samples.map(({disabled,hidden})=>({disabled,hidden}))).toEqual([
   {disabled:true,hidden:false},
   {disabled:false,hidden:true},
   {disabled:true,hidden:false},
   {disabled:false,hidden:false},
  ]);
  await pass.click();await expect.poll(async()=>(await projected(page,id)).gameplayRevision).toBe(before.gameplayRevision+1);
  const passed=await projected(page,id);expect(passed.moves.at(-1).action).toEqual({type:'pass'});expect(writes).toHaveLength(1);
  await writeFile(info.outputPath('quiet-renew-real-journey.json'),JSON.stringify({observerReadyAt,original,sampledAt,samples,outcome:outcomes[0],tabReturn,writes},null,2));
  await info.attach('quiet-renew-real-journey',{contentType:'application/json',path:info.outputPath('quiet-renew-real-journey.json')});
 }finally{
  try{await writeFile(info.outputPath('quiet-renew-raw-samples.json'),JSON.stringify({observerReadyAt,original,samples},null,2));await info.attach('quiet-renew-raw-samples',{contentType:'application/json',path:info.outputPath('quiet-renew-raw-samples.json')});}catch{}
  release();await page.evaluate(()=>{delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));globalThis.__tabReturnAvailability?.observer?.disconnect();delete globalThis.__tabReturnAvailability;}).catch(()=>{});page.off('console',consoleSample);page.off('request',observeWrite);await page.unrouteAll({behavior:'wait'});}
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
 const leasePreparation=createNaturalRenewalLeaseObserver(page,{minimumRemainingMs:COMPUTER_TIMING.renewAfterMs,maximumRemainingMs:COMPUTER_TIMING.leaseMs});
 const id=await createComputer(page);await switchGamePanel(page,'board');
 const initial=await projected(page,id);await submitPlayableAction(page,initial.legalActions.find(action=>action.from&&action.to));
 if((await projected(page,id)).canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
 await waitForComputerDecision(page,id,'babs',{guest:true,modelId:initial.computer.modelId});
 await expect.poll(async()=>{const game=await projected(page,id);return game.board.state.sideToMove==='P1'&&!game.board.state.continuation;}).toBe(true);
 const before=await projected(page,id),pass=page.locator('#shell-board-preview-label [data-board-message-action="pass"], #shell-board-preview-label [data-board-preview-action="pass"]');
 leasePreparation.bind(before);
 // Let an aged natural renewal settle before arming the original held-renewal window.
 try { await expect.poll(()=>leasePreparation.freshLeaseReady()).toBe(true); }
 catch (error) {
  // This assertion remains primary even if failure evidence or cleanup cannot be retained.
  try { info.annotations.push({type:'natural-renewal-lease-preparation',description:JSON.stringify(leasePreparation.snapshot())}); } catch {}
  try { leasePreparation.dispose(); } catch {}
  throw error;
 }
 let renewal,renewalHeaders,release;const held=new Promise(resolve=>{release=resolve;}),humanRequests=[];
 const observe=request=>{if(request.method()!=='POST'||new URL(request.url()).pathname!==`/api/shell/games/${id}/apply`)return;const value=request.postDataJSON();if(!value.payload?.computer&&value.payload?.action?.type==='pass')humanRequests.push(value);};
 page.on('request',observe);
 await page.route(`**/api/shell/games/${id}/shared`,async route=>{
  const value=route.request().postDataJSON();
  if(!renewal&&value.payload?.operation==='computer-control'&&value.payload.values?.action==='renew'&&leasePreparation.eligible(route.request(),value)){renewal=value;renewalHeaders=Object.fromEntries(Object.entries(route.request().headers()).filter(([name])=>name==='content-type'||name.startsWith('x-righelt-')));await held;}
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
  expect(humanRequests).toHaveLength(0);
  expect(leasePreparation.remainingAtRelease(renewal),'The original held gesture must finish before its captured own lease expires').toBeGreaterThan(0);release();
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
 }finally{release();page.off('request',observe);info.annotations.push({type:'natural-renewal-lease-preparation',description:JSON.stringify(leasePreparation.snapshot())});leasePreparation.dispose();await page.unrouteAll({behavior:'wait'});}
});
