import {mkdir,writeFile} from 'node:fs/promises';
import {test, expect} from '@playwright/test';
import {createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,joinAsViewer,makeAnyLegalMove} from '../support/app.mjs';

// Fault controls live at the browser transport boundary, never in production endpoints.
async function wire(page) {
 const fault={receive:false,http:false,loseReply:false, requests:0,snapshots:0,bytes:0,commands:[],latency:100,lastInbound:0};
 await page.routeWebSocket(/\/api\/shell\/games\//, socket=>{
  const server=socket.connectToServer();
  server.onMessage(message=>{
   fault.bytes+=Buffer.byteLength(message);
   let data;try{data=JSON.parse(message);if(fault.legacy){delete data.protocolVersion;message=JSON.stringify(data);}}catch{}
   if(data?.game)fault.snapshots++;
   if(!fault.receive){fault.lastInbound=Date.now();setTimeout(()=>socket.send(message),fault.latency);}
  });
 });
 await page.route('**/api/shell/games/**',async route=>{
  fault.requests++;
  if(fault.legacy && /\/reconcile$/.test(new URL(route.request().url()).pathname)){await route.fulfill({status:404,json:{ok:false,error:"not_found"}});return;}
  if(fault.http || (fault.loseReply && /\/reconcile$/.test(new URL(route.request().url()).pathname))){await route.abort();return;}
  const mutation=route.request().method()==='POST'&&/\/apply$/.test(new URL(route.request().url()).pathname);
  if(mutation)fault.commands.push(route.request().postDataJSON());
  if(mutation&&fault.holdApply){await route.abort();return;}
  const response=await route.fetch({timeout:5000});
  let body=await response.body();
  if(fault.legacy){try{const parsed=JSON.parse(body);if(parsed.game){delete parsed.protocolVersion;body=Buffer.from(JSON.stringify(parsed));}}catch{}}
  fault.bytes+=body.length;
  try{if(JSON.parse(body)?.game)fault.snapshots++;}catch{}
  if(fault.interruptNextRecovery && /\/reconcile$/.test(new URL(route.request().url()).pathname)){
   fault.interruptNextRecovery=false;fault.interruptedRecoveries=(fault.interruptedRecoveries||0)+1;fault.http=true;await route.abort();return;
  }
  if(mutation&&fault.loseReply){await route.abort();return;}
  await new Promise(resolve=>setTimeout(resolve,fault.latency));
  await route.fulfill({response,body});
 });
 return fault;
}
async function party(browser,baseURL) {
 const contexts=await Promise.all([1,2,3].map(()=>browser.newContext()));
 const pages=await Promise.all(contexts.map(c=>c.newPage()));
 const faults=await Promise.all(pages.map(wire));
 const game=await createGameFromHome(pages[0]);
 await openDirectGameLink(pages[1],baseURL,game.gameHash);await requestPlayerJoin(pages[1]);await acceptPendingRequest(pages[0]);
 await openDirectGameLink(pages[2],baseURL,game.gameHash);await joinAsViewer(pages[2]);
 for(const page of pages)await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 faults.forEach(f=>{f.requests=0;f.snapshots=0;f.bytes=0;});
 return {...game,pages,faults,contexts};
}
async function move(page,gameId) {
 const action=await page.evaluate(async gameId=>{
  const identityId=localStorage.getItem("righelt.identity.id.v1");
  const body=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();
  return body.game.legalActions.find(a=>a.from&&a.to);
 },gameId);
 await page.locator(`.cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`).first().click();
 const target=page.locator(`.cell[data-row="${action.to.row}"][data-col="${action.to.col}"]`).first();
 await target.hover();await target.click();
}
async function digest(page) {
 return page.evaluate(()=>({
  board:[...document.querySelectorAll('[data-testid="game-board"] .cell')].map(e=>({r:e.dataset.row,c:e.dataset.col,p:[...e.querySelectorAll('.piece-token')].map(p=>({class:p.className,text:p.textContent}))})),
  history:[...document.querySelectorAll('[data-testid="history-move-item"]')].map(e=>({id:e.dataset.moveId,text:e.querySelector('.history-move-line')?.textContent,undone:e.classList.contains('is-undone')})),
  active:document.querySelector('[data-testid="active-turn-label"]')?.textContent,
 }));
}
async function converged(pages) {
 for(const page of pages)await expect(page.getByTestId("game-board")).toBeVisible();
 const current=await digest(pages[0]);expect(current.board.length).toBe(100);expect(current.board.some(c=>c.p.length)).toBe(true);
 await expect.poll(async()=>{
  const values=await Promise.all(pages.map(digest));values.forEach(v=>{expect(v.board.length).toBe(100);expect(v.board.some(c=>c.p.length)).toBe(true);expect(v.active).toBeTruthy();v.history.forEach(m=>expect(m.id).toBeTruthy());});return values.every(v=>JSON.stringify(v)===JSON.stringify(values[0]));
 },{timeout:25000}).toBe(true);
 for(let i=0;i<pages.length;i++){
  await expect(pages[i].getByTestId('game-role')).toContainText(['Player 1','Player 2','Viewer'][i]);
  await expect(pages[i].getByTestId('sync-recovery-banner')).toHaveCount(0,{timeout:25000});
  await expect(pages[i].getByTestId('history-pending-move-item')).toHaveCount(0);
 }
}
async function evidence(info, name, start, faults, extra={}) {
 const result={fault:name,restoredAt:new Date(start).toISOString(),convergenceMs:Date.now()-start,
  requests:faults.reduce((a,f)=>a+f.requests,0),snapshots:faults.reduce((a,f)=>a+f.snapshots,0),applicationPayloadBytes:faults.reduce((a,f)=>a+f.bytes,0),...extra};
 expect(result.convergenceMs).toBeLessThanOrEqual(25000);
 await mkdir("test-results/sync-recovery",{recursive:true});
 await writeFile(`test-results/sync-recovery/${info.project.name}-${name}.json`,JSON.stringify(result,null,2));
 await info.attach(`recovery-${name}`,{body:JSON.stringify(result,null,2),contentType:'application/json'});
}

test('E01 lost committed response and socket receipt converge automatically',async({browser,baseURL},info)=>{
 const p=await party(browser,baseURL);try{
  await converged(p.pages);
  p.faults[0].receive=true;p.faults[0].loseReply=true;
  await move(p.pages[0],p.gameId);
  await expect(p.pages[0].getByTestId('sync-recovery-banner')).toContainText('Checking your move');
  p.faults[0].receive=false;p.faults[0].loseReply=false;const start=Date.now();
  await converged(p.pages);expect((await digest(p.pages[0])).history).toHaveLength(1);await evidence(info,'lost-response',start,p.faults);
  const ids=p.faults[0].commands.map(c=>c.clientCommandId);expect(new Set(ids).size).toBe(1);
 }finally{await Promise.all(p.contexts.map(async c=>{await c.unrouteAll({behavior:"ignoreErrors"});await Promise.race([c.close(),new Promise(resolve=>setTimeout(resolve,3000))]);}));}
});

test('E02 silent online receive loss triggers watchdog and survives interrupted recovery',async({browser,baseURL},info)=>{
 test.setTimeout(75000);const p=await party(browser,baseURL);try{
  await converged(p.pages);p.faults[1].receive=true;p.faults[1].http=true;
  expect(await p.pages[1].evaluate(()=>navigator.onLine)).toBe(true);
  const loss=p.faults[1].lastInbound;await move(p.pages[0],p.gameId);
  await expect(p.pages[1].getByTestId('sync-recovery-banner')).toContainText('Reconnecting',{timeout:17000});
  const detectionMs=Date.now()-loss;expect(detectionMs).toBeLessThanOrEqual(16000);
  p.faults[1].interruptNextRecovery=true;p.faults[1].http=false;
  await expect.poll(()=>p.faults[1].interruptedRecoveries||0,{timeout:10000}).toBe(1);
  await p.pages[1].waitForTimeout(1000);
  p.faults[1].receive=false;p.faults[1].http=false;const start=Date.now();
  await converged(p.pages);await evidence(info,'silent-online',start,p.faults,{detectionMs});
 }finally{await Promise.all(p.contexts.map(async c=>{await c.unrouteAll({behavior:"ignoreErrors"});await Promise.race([c.close(),new Promise(resolve=>setTimeout(resolve,3000))]);}));}
});

test('E04 reload unresolved journal then visibility resume preserves original ID and roles',async({browser,baseURL},info)=>{
 const p=await party(browser,baseURL);try{
  p.faults[0].receive=true;p.faults[0].loseReply=true;
  await move(p.pages[0],p.gameId);
  await expect(p.pages[0].getByTestId('sync-recovery-banner')).toContainText('Checking');
  const id=p.faults[0].commands[0].clientCommandId;
  expect(await p.pages[0].evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('righelt.online-commands.v2');request.onsuccess=()=>{const db=request.result;const tx=db.transaction('commands');const read=tx.objectStore('commands').getAll();read.onsuccess=()=>resolve(read.result.length);};request.onerror=()=>reject(request.error);}))).toBe(1);
  if(info.project.name==='chromium'){
   const session=await p.contexts[0].newCDPSession(p.pages[0]);
   await session.send('Page.setWebLifecycleState',{state:'frozen'});
   await new Promise(resolve=>setTimeout(resolve,1000));
   await session.send('Page.setWebLifecycleState',{state:'active'});await session.detach();
  }
  await p.pages[0].reload();
  p.faults[0].receive=false;p.faults[0].loseReply=false;const start=Date.now();
  await p.pages[0].evaluate(()=>{
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));
  });
  await converged(p.pages);expect((await digest(p.pages[0])).history).toHaveLength(1);await evidence(info,'reload-resume',start,p.faults);
  expect(p.faults[0].commands.every(c=>c.clientCommandId===id)).toBe(true);
 }finally{await Promise.all(p.contexts.map(async c=>{await c.unrouteAll({behavior:"ignoreErrors"});await Promise.race([c.close(),new Promise(resolve=>setTimeout(resolve,3000))]);}));}
});

test('E06 same identity tabs reconcile one journal without duplicating a committed move',async({browser,baseURL},info)=>{
 const p=await party(browser,baseURL);try{
  const twin=await p.contexts[0].newPage();const tf=await wire(twin);
  await twin.goto(`${baseURL}${p.gameHash}`);await expect(twin.getByTestId('game-role')).toContainText('Player 1');
  p.faults[0].receive=true;p.faults[0].loseReply=true;
  await move(p.pages[0],p.gameId);
  await twin.reload();
  p.faults[0].receive=false;p.faults[0].loseReply=false;const start=Date.now();
  await converged(p.pages);await expect.poll(async()=>JSON.stringify(await digest(twin))).toBe(JSON.stringify(await digest(p.pages[0])));
  expect((await digest(p.pages[0])).history).toHaveLength(1);
  await evidence(info,'same-identity-tabs',start,[...p.faults,tf]);
  expect(new Set([...p.faults[0].commands,...tf.commands].map(c=>c.clientCommandId)).size).toBe(1);
 }finally{await Promise.all(p.contexts.map(async c=>{await c.unrouteAll({behavior:"ignoreErrors"});await Promise.race([c.close(),new Promise(resolve=>setTimeout(resolve,3000))]);}));}
});

for(const phase of ['before','after'])test(`E03 actual Worker restart ${phase} commit resolves the pending sender`,async({browser,baseURL,request},info)=>{
 test.skip(info.project.name!=='chromium','Full runtime fault matrix is Chromium; representative engines cover recovery.');
 test.setTimeout(90000);const p=await party(browser,baseURL);try{
  p.faults[0].holdApply=phase==='before';
  p.faults[0].receive=true;p.faults[0].loseReply=true;
  await move(p.pages[0],p.gameId);
  await expect(p.pages[0].getByTestId('sync-recovery-banner')).toContainText('Checking');
  const response=await request.post(`http://127.0.0.1:${Number(new URL(baseURL).port)+100}/restart`);expect(response.ok()).toBe(true);
  p.faults[0].receive=false;p.faults[0].loseReply=false;p.faults[0].holdApply=false;const start=Date.now();
  await converged(p.pages);expect((await digest(p.pages[0])).history).toHaveLength(1);await evidence(info,`worker-restart-${phase}-commit`,start,p.faults);
 }finally{await Promise.all(p.contexts.map(async c=>{await c.unrouteAll({behavior:"ignoreErrors"});await Promise.race([c.close(),new Promise(resolve=>setTimeout(resolve,3000))]);}));}
});

test('E06 real IndexedDB commits admission atomically across tabs and aborts successful writes',async({page,context})=>{
 await page.goto('/');const twin=await context.newPage();await twin.goto('/');
 const prepare=async page=>page.evaluate(async()=>{
  const {createCommandJournal}=await import('/shell/command-journal.js');
  const {commandFingerprint}=await import('/generated/packages/shared-types/src/sync-protocol.js');
  window.journal=createCommandJournal({databaseName:'pressure-admission'});
  window.admit=async(id,game='game')=>{
   const command={protocolVersion:2,gameId:game,identityId:'identity',clientCommandId:`v2:${id}`,kind:'end_turn',payload:{},expectedState:{board:'board'},expectedGameplayRevision:0,expectedTurnIndex:0};
   command.fingerprint=await commandFingerprint(command);
   try{await window.journal.admit(command);return 'accepted';}catch(e){return e.code||e.message;}
  };
 });
 await prepare(page);await prepare(twin);
 const results=(await Promise.all([page.evaluate(()=>Promise.all(Array.from({length:12},(_,i)=>admit(`a${i}`)))),twin.evaluate(()=>Promise.all(Array.from({length:12},(_,i)=>admit(`b${i}`))))])).flat();
 expect(results.filter(x=>x==='accepted')).toHaveLength(16);
 expect(await page.evaluate(()=>journal.list('identity').then(x=>x.length))).toBe(16);
 const abort=await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(value){const request=original.call(this,value);request.addEventListener('success',()=>this.transaction.abort());return request;};
  const result=await admit('abort-after-success','other');IDBObjectStore.prototype.add=original;
  return {result,records:await journal.list('identity','other')};
 });
 expect(abort.result).toBe('journal_transaction_failed');expect(abort.records).toEqual([]);
 const globalResults=(await Promise.all([page.evaluate(()=>Promise.all(Array.from({length:70},(_,i)=>admit(`global-a${i}`,`a-game-${Math.floor(i/14)}`)))),twin.evaluate(()=>Promise.all(Array.from({length:70},(_,i)=>admit(`global-b${i}`,`b-game-${Math.floor(i/14)}`))))])).flat();
 expect(globalResults.filter(x=>x==='accepted')).toHaveLength(112);
 expect(await page.evaluate(()=>journal.list('identity').then(x=>x.length))).toBe(128);
});

test('E05 intentional history survives disconnection and home navigation',async({browser,baseURL},info)=>{
 test.skip(info.project.name!=='chromium');const p=await party(browser,baseURL);try{
  await move(p.pages[0],p.gameId);await converged(p.pages);
  const history=p.pages[1].getByTestId('history-move-item').first();const selected=await history.getAttribute('data-move-id');
  await history.click();await expect(p.pages[1].getByTestId('history-return-live')).toBeVisible();
  p.faults[1].receive=true;p.faults[1].http=true;
  await move(p.pages[0],p.gameId);await p.pages[1].waitForTimeout(16000);
  expect(await p.pages[1].getByTestId('history-move-item').first().getAttribute('data-move-id')).toBe(selected);
  p.faults[1].receive=false;p.faults[1].http=false;const start=Date.now();
  await expect(p.pages[1].getByTestId('sync-recovery-banner')).toHaveCount(0,{timeout:25000});
  await expect(p.pages[1].getByTestId('history-return-live')).toBeVisible();
  await p.pages[1].getByTestId('history-return-live').click();await converged(p.pages);
  await evidence(info,'history-reconnect',start,p.faults);
  await p.pages[1].goto(baseURL);await expect(p.pages[1].locator(`[data-game-id="${p.gameId}"]`).first()).toBeVisible();
  await p.pages[1].goto(`${baseURL}${p.gameHash}`);await converged(p.pages);
 }finally{await Promise.all(p.contexts.map(c=>c.close()));}
});

test('E07 new client rejects old protocol and one refresh preserves saved game',async({page},info)=>{
 const {gameId}=await createGameFromHome(page);await makeAnyLegalMove(page);const before=await digest(page);
 const fault=await wire(page);fault.legacy=true;let navigation=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigation++;});
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('righelt.sync-v2-refresh')),{timeout:15000}).toBe('1');
 await page.waitForLoadState('domcontentloaded');
 await expect.poll(()=>navigation).toBe(2);
 expect(fault.commands).toHaveLength(0);
 expect(navigation).toBeLessThanOrEqual(2);
 const start=Date.now();fault.legacy=false;await page.reload();
 await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 await expect.poll(async()=>JSON.stringify(await digest(page))).toBe(JSON.stringify(before));
 await evidence(info,'upgrade-refresh',start,[fault],{automaticReloads:navigation-2});
});

test('I10 browser reconnect transfers one current snapshot after205 moves and30 duplicate submissions',async({page},info)=>{
 test.skip(info.project.name!=='chromium');test.setTimeout(120000);
 const {gameId}=await createGameFromHome(page);
 await page.getByRole('button',{name:'Play as both players',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play as both players',exact:true})).toHaveCount(0);
 const result=await page.evaluate(async gameId=>{
  const {commandFingerprint}=await import('/generated/packages/shared-types/src/sync-protocol.js');
  const identityId=localStorage.getItem('righelt.identity.id.v1');
  let current=await (await fetch(`/api/shell/games/${gameId}?identityId=${identityId}`)).json();const duplicates=[];
  for(let i=0;i<205;i++){
   const command={protocolVersion:2,gameId,identityId,clientCommandId:`v2:browser-long-${i}`,kind:'move',payload:{},expectedState:current.game.board.state,expectedGameplayRevision:current.game.gameplayRevision};
   command.fingerprint=await commandFingerprint(command);
   current=await(await fetch(`/api/shell/games/${gameId}/moves`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)})).json();
   if(current.commandOutcomes?.[0]?.outcome!=='accepted')throw new Error(JSON.stringify(current));
   if(i<30)duplicates.push(command);
  }
  for(const command of duplicates){const body=await(await fetch(`/api/shell/games/${gameId}/moves`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)})).json();if(!body.duplicate)throw new Error('duplicate lost');}
  return {duplicates};
 },gameId);
 const fault=await wire(page);const start=Date.now();await page.reload();await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 await page.waitForTimeout(5500);
 // Initial GET owns current state; cursor-aware WebSocket acknowledges unchanged revision.
 expect(fault.snapshots).toBe(1);
 await evidence(info,'long-history',start,[fault],{moves:205,duplicateSubmissions:result.duplicates.length});
});

test('E05 home reload recovers unopened journal games and retains pending card',async({browser,baseURL},info)=>{
 test.skip(info.project.name!=='chromium');const p=await party(browser,baseURL);try{
  p.faults[0].receive=true;p.faults[0].loseReply=true;await move(p.pages[0],p.gameId);
  await expect(p.pages[0].getByTestId('sync-recovery-banner')).toContainText('Checking');
  await p.pages[0].goto(baseURL);
  await expect(p.pages[0].locator(`[data-game-id="${p.gameId}"]`).first()).toContainText(/Recovering/i);
  p.faults[0].receive=false;p.faults[0].loseReply=false;const start=Date.now();
  await expect.poll(()=>p.pages[0].evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('righelt.online-commands.v2');r.onsuccess=()=>{const tx=r.result.transaction('commands');const q=tx.objectStore('commands').count();q.onsuccess=()=>resolve(q.result);};})),{timeout:25000}).toBe(0);
  await expect(p.pages[0].locator(`[data-game-id="${p.gameId}"]`).first()).not.toContainText('Recovering');
  await p.pages[0].goto(`${baseURL}${p.gameHash}`);await converged(p.pages);
  await evidence(info,'home-journal-reload',start,p.faults);
 }finally{await Promise.all(p.contexts.map(c=>c.close()));}
});
