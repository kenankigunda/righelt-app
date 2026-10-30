import {test,expect} from '@playwright/test';
import {waitForOpponentReady,readProjectedGame} from '../support/computer-projection.mjs';
const pieces=page=>page.getByTestId('game-board').evaluate(board=>[...board.querySelectorAll('.cell .piece-token[data-piece-id]:not(.ghost):not(.destruction-piece)')].map(token=>({id:token.dataset.pieceId,row:Number(token.closest('.cell').dataset.row),col:Number(token.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)));
for(const motion of ['no-preference','reduce'])test(`computer stays unprojected until confirmation then shows paced movement and releases human control (${motion})`,async({page,context},info)=>{
 await page.emulateMedia({reducedMotion:motion});
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.getByTestId('game-board')).toBeVisible();
 let release,seen;const held=new Promise(resolve=>release=resolve),submitted=new Promise(resolve=>seen=resolve);let command;
 await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;seen();await held;}await route.continue();});
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  const before=await pieces(page);const read=()=>page.evaluate(readProjectedGame,{id:game.id,guest:true});const acknowledged=await read();expect(acknowledged.moves.filter(move=>move.computerProof)).toHaveLength(0);
  await page.evaluate(()=>window.moveNotes=[]);await expect(page.locator('#shell-board-preview-label')).toContainText('saving their move');expect(await pieces(page)).toEqual(before);await expect(page.locator('.computer-replay')).toHaveCount(0);expect(await page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820))).toHaveLength(0);
  // Inspect each presentation atomically, including the short reduced-motion frame.
  // Separate protocol assertions could otherwise straddle its completion.
  await page.evaluate(()=>{window.playbackControlSamples=[];const sample=()=>{if(!document.querySelector('.computer-replay'))return;const label=document.querySelector('#shell-board-preview-label');window.playbackControlSamples.push({message:label?.textContent??'',pass:[...(label?.querySelectorAll('button')??[])].some(button=>button.textContent.trim()==='Pass')});};window.playbackControlObserver=new MutationObserver(sample);window.playbackControlObserver.observe(document.querySelector('#game-shell')??document.body,{childList:true,subtree:true,characterData:true});});
  release();await expect.poll(()=>page.evaluate(()=>window.playbackControlSamples.some(sample=>sample.message.includes('making their move'))),{timeout:15000}).toBe(true);
  expect(await page.evaluate(()=>window.playbackControlSamples.some(sample=>sample.pass))).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820).length)).toBe(1);await expect(page.locator('.computer-replay')).toHaveCount(0,{timeout:15000});
  await expect.poll(async()=> (await read()).moves.filter(move=>move.computerProof).length).toBeGreaterThan(0);
  expect(await page.evaluate(()=>{window.playbackControlObserver.disconnect();return window.playbackControlSamples.some(sample=>sample.pass);})).toBe(false);
  await page.screenshot({path:info.outputPath('confirmed-computer-final.png')});await info.attach('confirmed-computer-command',{body:JSON.stringify({commandId:command.clientCommandId,attemptId:command.payload.computer.attemptId,before}),contentType:'application/json'});
 }finally{release();}
});

test('unseen update chime stays pending through History and Players and stops after live review',async({page,context},info)=>{
 test.setTimeout(120000); // Keep both real 30-second intervals plus cold preparation and native navigation within the workflow budget.
 const {switchGamePanel}=await import('../support/app.mjs');
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width:390,height:900});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 let release,command;const held=new Promise(resolve=>release=resolve);await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;await held;}await route.continue();});
 const notes=frequency=>page.evaluate(value=>window.moveNotes.filter(note=>note.frequency===value),frequency);
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  await switchGamePanel(page,'history');const moveId=await page.getByTestId('history-move-item').first().getAttribute('data-move-id');const row=page.locator(`[data-testid="history-move-item"][data-move-id="${moveId}"]`);await row.locator('.history-item-info').click();await expect(row).toHaveClass(/is-selected/);await page.evaluate(()=>window.moveNotes=[]);
  release();await expect.poll(async()=> (await notes(460)).length,{timeout:15000}).toBe(1);await expect.poll(async()=>(await notes(690)).length).toBe(1);expect(await notes(820)).toHaveLength(0);await expect(page.locator('.computer-replay')).toHaveCount(0);await expect(row).toHaveClass(/is-selected/);
  await switchGamePanel(page,'players');expect(await notes(460)).toHaveLength(1);await expect.poll(async()=> (await notes(460)).length,{timeout:35000}).toBe(2);expect(await notes(820)).toHaveLength(0);
  await switchGamePanel(page,'board');await expect(page.locator('.computer-replay')).toHaveCount(0);const seen=await notes(460);await page.waitForTimeout(31000);expect(await notes(460)).toHaveLength(seen.length);expect(await notes(820)).toHaveLength(0);
  await info.attach('unseen-update-notes',{body:JSON.stringify(await page.evaluate(()=>window.moveNotes)),contentType:'application/json'});await page.screenshot({path:info.outputPath('unseen-update-seen-live.png')});
 }finally{release();}
});

for(const refresh of [false,true])test(`lost accepted computer reply reconciles without duplicate movement or command (refresh=${refresh})`,async({page,context},info)=>{
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push(this.frequency.value);return value;};});
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await creation).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 const applications=[],attempts=[];let accepted,blocked=true,reads=0;
 await context.route(/\/api\/shell\/games\/(?![^?]*\/presence(?:\?|$))/,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,body=request.method()==='POST'?request.postDataJSON():null;
  if(path===`/api/shell/games/${game.id}/apply`&&body?.payload?.computer){applications.push(body);const response=await route.fetch();accepted=await response.json();await route.abort();return;}
  if(path.endsWith('/decision-attempt')&&body?.operation==='write'&&body?.kind==='computer')attempts.push(body);
  if(accepted&&blocked&&(path===`/api/shell/games/${game.id}`||path.endsWith('/reconcile'))){reads++;await route.fulfill({status:503,json:{ok:false,error:'unavailable'}});return;}
  await route.continue();
 });
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(accepted),{timeout:30000}).toBe(true);await expect.poll(()=>reads).toBeGreaterThan(0);
  expect(accepted.commandOutcomes.some(outcome=>outcome.clientCommandId===applications[0].clientCommandId&&outcome.outcome==='accepted')).toBe(true);const decision=accepted.game.moves.find(move=>move.clientCommandId===applications[0].clientCommandId);expect(decision?.computerProof).toBeTruthy();
  await expect(page.locator(`[data-testid="history-move-item"][data-move-id="${decision.moveId}"]`)).toHaveCount(0);await expect(page.locator('.computer-replay')).toHaveCount(0);await page.evaluate(()=>window.moveNotes=[]);
  blocked=false;
  if(refresh){await page.reload();await expect(page.getByTestId('game-board')).toBeVisible();await expect(page.locator(`[data-testid="history-move-item"][data-move-id="${decision.moveId}"]`)).toBeVisible();await expect(page.locator('.computer-replay')).toHaveCount(0);expect(await page.evaluate(()=>window.moveNotes.filter(frequency=>frequency===820))).toHaveLength(0);}
  else{await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.locator('.computer-replay')).toBeVisible({timeout:15000});await expect(page.locator('.computer-replay')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.moveNotes.filter(frequency=>frequency===820).length)).toBe(1);}
  await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toBeEnabled({timeout:15000});expect(applications.length).toBeGreaterThan(0);expect(new Set(applications.map(value=>value.clientCommandId)).size).toBe(1);for(const value of applications)expect(value).toEqual(applications[0]);expect(attempts).toHaveLength(1);
  await info.attach('lost-accepted-computer-reply',{body:JSON.stringify({refresh,commandId:applications[0].clientCommandId,attemptId:attempts[0].attemptId,decisionId:decision.moveId,reads}),contentType:'application/json'});
 }finally{blocked=false;}
});

test('lean confirmed frames recover automatically with foreground grace and no false intervention',async({page,context},info)=>{
 await page.addInitScript(()=>window.WebSocket=undefined);await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await creation).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 let blocked=true,reads=0,firstReadAt;
 await context.route(/\/api\/shell\/games\/(?![^?]*\/presence(?:\?|$))/,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path===`/api/shell/games/${game.id}/decision-snapshot`){reads++;firstReadAt??=Date.now();if(blocked){await route.fulfill({status:503,json:{ok:false,error:'unavailable'}});return;}}
  const response=await route.fetch();let body;try{body=await response.json();}catch{await route.fulfill({response});return;}
  if(body.game?.id===game.id)for(const move of body.game.moves??[])if(move.computerProof){delete move.snapshot;delete move.selectionSnapshot;}
  await route.fulfill({response,json:body});
 });
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>reads,{timeout:30000}).toBeGreaterThan(0);
  const notice=page.getByTestId('confirmed-playback-recovery');await expect(notice).toHaveCount(0);await expect(notice).toBeVisible({timeout:7000});expect(Date.now()-firstReadAt).toBeGreaterThanOrEqual(3900);
  await expect(notice.getByRole('button',{name:'Retry',exact:true})).toBeVisible({timeout:13000});expect(Date.now()-firstReadAt).toBeGreaterThanOrEqual(14900);await expect(page.locator('[data-computer-activity="attention"]')).toHaveCount(0);
  blocked=false;await expect(page.locator('.computer-replay')).toBeVisible({timeout:10000});await expect(page.locator('.computer-replay')).toHaveCount(0);await expect(notice).toHaveCount(0);await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toBeEnabled();
  await info.attach('confirmed-frame-read-recovery',{body:JSON.stringify({reads,foregroundWaitMs:Date.now()-firstReadAt}),contentType:'application/json'});
 }finally{blocked=false;}
});
