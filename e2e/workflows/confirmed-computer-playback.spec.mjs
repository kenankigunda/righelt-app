import {ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION,isReconcileResponse} from '../../packages/shared-types/src/sync-protocol.ts';
import {writeFileSync} from 'node:fs';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {test,expect} from '@playwright/test';
import {waitForOpponentReady,readProjectedGame} from '../support/computer-projection.mjs';
const pieces=page=>page.getByTestId('game-board').evaluate(board=>[...board.querySelectorAll('.cell .piece-token[data-piece-id]:not(.ghost):not(.destruction-piece)')].map(token=>({id:token.dataset.pieceId,row:Number(token.closest('.cell').dataset.row),col:Number(token.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)));
for(const motion of ['no-preference','reduce'])test(`computer stays unprojected until confirmation then shows paced movement and releases human control (${motion})`,async({page,context},info)=>{
 await page.emulateMedia({reducedMotion:motion});
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');await expect(page.getByTestId('game-board')).toBeVisible();
 let release,seen;const held=new Promise(resolve=>release=resolve),submitted=new Promise(resolve=>seen=resolve);let command;
 await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;seen();await held;}await route.continue();});
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  const before=await pieces(page);const read=()=>page.evaluate(readProjectedGame,{id:game.id,guest:true});const acknowledged=await read();expect(acknowledged.moves.filter(move=>move.computerProof)).toHaveLength(0);
  await page.evaluate(()=>window.moveNotes=[]);await expect(page.locator('#shell-board-preview-label')).toContainText('saving their move');expect(await pieces(page)).toEqual(before);await expect(page.locator('.computer-replay')).toHaveCount(0);expect(await page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820))).toHaveLength(0);
  // Inspect each presentation atomically, including the short reduced-motion frame.
  // Separate protocol assertions could otherwise straddle its completion.
  await page.evaluate(()=>{window.playbackControlSamples=[];const sample=()=>{if(!document.querySelector('.computer-replay'))return;const label=document.querySelector('#shell-board-preview-label');window.playbackControlSamples.push({message:label?.textContent??'',loadingState:label?.parentElement.querySelector('.board-message-activity')?.dataset.loadingState??null,caption:document.querySelector('#shell-board-turn-indicator')?.textContent??'',contexts:[...document.querySelectorAll('[data-board-context]')].map(node=>({key:node.dataset.boardContext,text:node.textContent??''})),pass:[...(label?.querySelectorAll('button')??[])].some(button=>button.textContent.trim()==='Pass')});};window.playbackControlObserver=new MutationObserver(sample);window.playbackControlObserver.observe(document.querySelector('#game-shell')??document.body,{childList:true,subtree:true,characterData:true});});
  release();await expect.poll(()=>page.evaluate(()=>window.playbackControlSamples.some(sample=>sample.message.includes('making their move'))),{timeout:15000}).toBe(true);
  expect(await page.evaluate(()=>window.playbackControlSamples.some(sample=>sample.pass))).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820).length)).toBe(1);await expect(page.locator('.computer-replay')).toHaveCount(0,{timeout:15000});
  await expect.poll(async()=> (await read()).moves.filter(move=>move.computerProof).length).toBeGreaterThan(0);
  const displayed=(await read()).moves.find(move=>move.clientCommandId===command.clientCommandId);expect(displayed).toBeTruthy();
  const moveNumber=displayed.displayMoveNumber??displayed.index+1;expect(Number.isSafeInteger(moveNumber)).toBe(true);
  const samples=await page.evaluate(()=>window.playbackControlSamples);
  const recorded=samples.find(sample=>sample.message.includes('making their move')&&sample.caption.includes(`Move ${moveNumber}`)&&sample.contexts.some(context=>{try{const key=JSON.parse(context.key);return key.includes('confirmed-frame')&&key.includes(displayed.moveId);}catch{return false;}}));
  expect(recorded,'The actual automatic step must publish its exact recorded move caption and context before presentation completes').toBeTruthy();
  expect(recorded.loadingState,'The next computer actor must not show a processing cue beside the displayed confirmed step').toBe('idle');
  const narration=recorded.contexts.find(context=>{try{return JSON.parse(context.key).includes(displayed.moveId);}catch{return false;}}).text;expect(narration).toContain('Babs');
  for(const point of [displayed.action.from,displayed.action.to].filter(Boolean))expect(narration).toContain(`${point.row}, ${point.col}`);
  await info.attach('automatic-recorded-presentation',{body:JSON.stringify({moveId:displayed.moveId,moveNumber,action:displayed.action,recorded}),contentType:'application/json'});
  expect(await page.evaluate(()=>{window.playbackControlObserver.disconnect();return window.playbackControlSamples.some(sample=>sample.pass);})).toBe(false);
  await page.screenshot({path:info.outputPath('confirmed-computer-final.png')});await info.attach('confirmed-computer-command',{body:JSON.stringify({commandId:command.clientCommandId,attemptId:command.payload.computer.attemptId,before}),contentType:'application/json'});
 }finally{release();}
});

test('unseen update chime stays pending through History and Players and stops after live review',async({page,context},info)=>{
 test.setTimeout(120000); // Keep both real 30-second intervals plus cold preparation and native navigation within the workflow budget.
 const {switchGamePanel}=await import('../support/app.mjs');
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width:390,height:900});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');
 let release,command;const held=new Promise(resolve=>release=resolve);await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;await held;}await route.continue();});
 const notes=frequency=>page.evaluate(value=>window.moveNotes.filter(note=>note.frequency===value),frequency);
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  await switchGamePanel(page,'history');const moveId=await page.getByTestId('history-move-item').first().getAttribute('data-move-id');const row=page.locator(`[data-testid="history-move-item"][data-move-id="${moveId}"]`);
  const recorded=(await page.evaluate(readProjectedGame,{id:game.id,guest:true})).moves.find(move=>move.moveId===moveId);expect(recorded).toBeTruthy();
  const hit=row.locator(':scope > .history-move-hit');await expect(row).toHaveAttribute('data-move-id',recorded.moveId);await expect(hit).toHaveAttribute('data-action','jump-history');await expect(hit).toHaveAttribute('data-game-id',game.id);await expect(hit).toHaveAttribute('data-move-index',String(recorded.index));
  await hit.click();await expect(row).toHaveAttribute('aria-current','true');await expect(row).toHaveClass(/is-selected/);await page.evaluate(()=>window.moveNotes=[]);
  release();await expect.poll(async()=> (await notes(460)).length,{timeout:15000}).toBe(1);await expect.poll(async()=>(await notes(690)).length).toBe(1);expect(await notes(820)).toHaveLength(0);await expect(page.locator('.computer-replay')).toHaveCount(0);await expect(row).toHaveClass(/is-selected/);
  await switchGamePanel(page,'players');expect(await notes(460)).toHaveLength(1);await expect.poll(async()=> (await notes(460)).length,{timeout:35000}).toBe(2);expect(await notes(820)).toHaveLength(0);
  await switchGamePanel(page,'board');await expect(page.locator('.computer-replay')).toHaveCount(0);const seen=await notes(460);await page.waitForTimeout(31000);expect(await notes(460)).toHaveLength(seen.length);expect(await notes(820)).toHaveLength(0);
  await info.attach('unseen-update-notes',{body:JSON.stringify(await page.evaluate(()=>window.moveNotes)),contentType:'application/json'});await page.screenshot({path:info.outputPath('unseen-update-seen-live.png')});
 }finally{release();}
});

for(const refresh of [false,true])test(`lost accepted computer reply reconciles without duplicate movement or command (refresh=${refresh})`,async({page,context},info)=>{
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push(this.frequency.value);return value;};});
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await creation).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');
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
 const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await creation).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');
 let blocked=true,reads=0,firstReadAt,firstConfirmedAt;
 await context.route(/\/api\/shell\/games\/(?![^?]*\/presence(?:\?|$))/,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path===`/api/shell/games/${game.id}/decision-snapshot`){reads++;firstReadAt??=Date.now();if(blocked){await route.fulfill({status:503,json:{ok:false,error:'unavailable'}});return;}}
  const response=await route.fetch();let body;try{body=await response.json();}catch{await route.fulfill({response});return;}
  if(body.game?.id===game.id)for(const move of body.game.moves??[])if(move.computerProof){firstConfirmedAt??=Date.now();delete move.snapshot;delete move.selectionSnapshot;}
  await route.fulfill({response,json:body});
 });
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>reads,{timeout:30000}).toBeGreaterThan(0);
  // Foreground blocking starts when the confirmed update is delivered, before
  // the browser's later decision-snapshot request reaches this route handler.
  expect(firstConfirmedAt).toEqual(expect.any(Number));
  const notice=page.getByTestId('confirmed-playback-recovery');await expect(notice).toHaveCount(0);await expect(notice).toBeVisible({timeout:7000});expect(Date.now()-firstConfirmedAt).toBeGreaterThanOrEqual(3900);
  await expect(notice.getByRole('button',{name:'Retry',exact:true})).toBeVisible({timeout:13000});expect(Date.now()-firstConfirmedAt).toBeGreaterThanOrEqual(14900);await expect(page.locator('[data-computer-activity="attention"]')).toHaveCount(0);
  let retryState;await expect.poll(async()=>{
   retryState=await notice.getByRole('button',{name:'Retry',exact:true}).evaluate(button=>{const card=button.closest('[data-alert-stack-card]'),rect=button.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,hit=document.elementFromPoint(x,y);return {at:Date.now(),activeCardKey:document.querySelector('[data-alert-stack-card].is-active')?.dataset.notificationId,cardKey:card?.dataset.notificationId,stackIndex:card?.dataset.stackIndex,active:Boolean(card?.classList.contains('is-active')),inert:Boolean(button.closest('[inert]')),hidden:Boolean(button.closest('[hidden],[aria-hidden="true"]')),enabled:!button.matches(':disabled'),rect:rect.toJSON(),insideViewport:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,center:{x,y},centerOwned:hit===button||button.contains(hit),hit:hit?.outerHTML.slice(0,600)};});
   return retryState.rect.width>0&&retryState.rect.height>0&&retryState.active&&retryState.enabled&&!retryState.inert&&!retryState.hidden&&retryState.insideViewport&&retryState.centerOwned;
  }).toBe(true);
  expect(retryState.cardKey).toBe(`confirmed-playback-recovery:${game.id}`);expect(retryState.activeCardKey).toBe(retryState.cardKey);
  await info.attach('confirmed-playback-retry-ready',{body:JSON.stringify({...retryState,firstConfirmedAt,foregroundWaitMs:retryState.at-firstConfirmedAt}),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('confirmed-playback-retry-ready.png')});
  blocked=false;await expect(page.locator('.computer-replay')).toBeVisible({timeout:10000});await expect(page.locator('.computer-replay')).toHaveCount(0);await expect(notice).toHaveCount(0);await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toBeEnabled();
  await info.attach('confirmed-frame-read-recovery',{body:JSON.stringify({reads,firstReadDelayMs:firstReadAt-firstConfirmedAt,foregroundWaitMs:Date.now()-firstConfirmedAt}),contentType:'application/json'});
 }finally{blocked=false;}
});

test('readiness recognizes elapsed loading detail while model response headers are pending',async({page,context},info)=>{
 let release;const held=new Promise(resolve=>release=resolve);
 await context.route('**/computer/models/*.onnx',async route=>{const response=await route.fetch();await held;await route.fulfill({response});});
 try{
  await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const ready=waitForOpponentReady(page);ready.catch(()=>{});
  const status=page.locator('[data-story-readiness]');
  await expect(status).toHaveText(/Loading your opponent · [6-9]s/,{timeout:10000});
  const message=await status.textContent();expect(message).not.toMatch(/bytes/);
  release();const receipt=await ready;expect(receipt.detailed).toBe(true);
  await info.attach('preparation-before-response-headers',{contentType:'application/json',body:JSON.stringify({message,receipt})});
 }finally{release();}
});

for(const [width,height,covered] of [[390,450,true],[1440,1100,false]]){
 const utilityTest=test.extend({utilityGame:[async({page},use)=>{
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width,height});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');
  await use(game);
 },{timeout:60000}]});
 utilityTest(`utility visibility keeps computer cues aligned with Live Board (${covered?'center-occluded':'docked'})`,async({page,context,utilityGame:game},info)=>{
 let release,command;const held=new Promise(resolve=>release=resolve);
 await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;await held;}await route.continue();});
 await context.route('**/reconcile',async route=>{if(command&&route.request().postDataJSON()?.commands?.some(item=>item.clientCommandId===command.clientCommandId))await held;await route.continue();});
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  const navigation=page.getByRole('button',{name:'Open navigation menu',exact:true});if(await navigation.isVisible())await navigation.click();await page.getByRole('button',{name:'Debug',exact:true}).click();
  const debug=page.locator('[data-flyout="debug"]');await expect(debug).toBeVisible();await expect.poll(()=>debug.evaluate(element=>element.getAnimations().every(animation=>!animation.pending&&animation.playState!=='running'))).toBe(true);await expect(debug).toHaveCSS('opacity','1');
  if(covered){
   // Opening the native utility may scroll its trigger into view. Establish the wheel fixture explicitly.
   await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
   await page.mouse.move(20,20);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
   await page.mouse.wheel(0,120);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
   await expect.poll(()=>page.getByTestId('game-board').evaluate(board=>{const r=board.getBoundingClientRect(),flyout=document.querySelector('[data-flyout="debug"]'),f=flyout.getBoundingClientRect(),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);return right>left&&bottom>top&&f.left<=(left+right)/2&&f.right>=(left+right)/2&&f.top<=(top+bottom)/2&&f.bottom>=(top+bottom)/2&&flyout.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2))&&!board.closest('[data-testid="game-board-wrap"]').contains(document.elementFromPoint((left+right)/2,(top+bottom)/2));})).toBe(true);
  }else{
   await expect(debug).toHaveCSS('opacity','1');
   expect(await page.getByTestId('game-board').evaluate(board=>{const r=board.getBoundingClientRect();return board.closest('[data-testid="game-board-wrap"]').contains(document.elementFromPoint((Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2));})).toBe(true);
  }
  await page.screenshot({path:info.outputPath(`utility-${covered?'center-occluded':'docked'}-live-board.png`)});await page.evaluate(()=>window.moveNotes=[]);
  release();
  if(covered){
   await expect.poll(()=>page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===460).length),{timeout:15000}).toBe(1);
   expect(await page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820).length)).toBe(0);
  }else{
   await expect.poll(()=>page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820).length),{timeout:15000}).toBeGreaterThan(0);
   expect(await page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===460).length)).toBe(0);
  }
  await expect.poll(async()=>(await page.evaluate(readProjectedGame,{id:game.id,guest:true})).moves.some(move=>move.computerProof)).toBe(true);
  await debug.locator('[data-action="close-debug"]').click();await expect(debug).toHaveCount(0);await expect(page.getByTestId('game-board')).toBeVisible();
 }finally{release();await context.unrouteAll({behavior:'wait'});}
});

if(!covered)utilityTest('a confirmed obsolete computer attempt recovers without a human failure banner or duplicate move',async({page,context,utilityGame:game},info)=>{
 let release,command,rejectedReceipt;const held=new Promise(resolve=>release=resolve),applications=[];
 await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer){applications.push(body);command??=body;if(body.clientCommandId===command.clientCommandId)await held;}await route.continue();});
 await context.route('**/reconcile',async route=>{if(command&&route.request().postDataJSON()?.commands?.some(row=>row.clientCommandId===command.clientCommandId))await held;await route.continue();});
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  expect((await page.evaluate(readProjectedGame,{id:game.id,guest:true})).moves.filter(move=>move.computerProof)).toHaveLength(0);
  await page.evaluate(()=>{window.obsoleteComputerBanners=[];const sample=()=>{for(const node of document.querySelectorAll('[data-testid="sync-failure-banner"]')){const text=node.textContent;if(!window.obsoleteComputerBanners.includes(text))window.obsoleteComputerBanners.push(text);}};window.obsoleteComputerBannerObserver=new MutationObserver(sample);window.obsoleteComputerBannerObserver.observe(document.body,{childList:true,subtree:true,characterData:true});sample();});
  // A separate legitimate owner action changes the lease generation while this
  // exact durable computer command is still unacknowledged. No fake receipt.
  const changed=await page.evaluate(async({id,proof,header})=>{
   const bootstrap=await fetch('/api/shell/bootstrap'),generation=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
   const response=await fetch(`/api/shell/games/${id}/computer-control`,{method:'POST',headers:{'content-type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({identityId,protocolVersion:2,action:'resume-here',deviceId:proof.deviceId,generation:proof.generation})});
   if(!response.ok)throw Error(`Owner authority fixture failed: ${response.status}`);return response.json();
  },{id:game.id,proof:command.payload.computer,header:STORAGE_GENERATION_HEADER});
  expect(changed.game.computer.generation).toBeGreaterThan(command.payload.computer.generation);
  release();
  // Read the exact server receipt independently of whichever native delivery
  // channel wins. Reconcile reports unknown/terminal outcomes; it creates no
  // replacement command and never recomputes the admitted move.
  await expect.poll(async()=>{
   const response=await page.request.post(`/api/shell/games/${game.id}/reconcile`,{headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)},data:{identityId:command.identityId,protocolVersion:2,knownSnapshotEventSeq:0,commands:[command]}});
   expect(response.status()).toBe(200);const body=await response.json();expect(isReconcileResponse(body,game.id,[command])).toBe(true);
   rejectedReceipt=body.commandOutcomes.find(row=>row.clientCommandId===command.clientCommandId);return rejectedReceipt?.outcome;
  },{timeout:15000}).toBe('rejected');
  expect(rejectedReceipt).toMatchObject({clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:'rejected',reason:'computer_control_changed'});
  let final;
  await expect.poll(async()=>{final=await page.evaluate(readProjectedGame,{id:game.id,guest:true});return final.moves.filter(move=>move.computerProof).length;},{timeout:30000}).toBe(1);
  await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toBeEnabled({timeout:15000});
  const banners=await page.evaluate(()=>{window.obsoleteComputerBannerObserver.disconnect();return window.obsoleteComputerBanners;});expect(banners).toEqual([]);
  const confirmed=final.moves.find(move=>move.computerProof);expect(confirmed.clientCommandId).not.toBe(command.clientCommandId);
  expect(confirmed.computerProof.generation,'Same-device recovery must acknowledge the existing generation without waiting for lease expiry').toBe(changed.game.computer.generation);
  for(const attempt of applications.filter(row=>row.clientCommandId===command.clientCommandId))expect(attempt).toEqual(command);
  const receipt={rejected:rejectedReceipt,oldCommandId:command.clientCommandId,newCommandId:confirmed.clientCommandId,oldGeneration:command.payload.computer.generation,forcedGeneration:changed.game.computer.generation,newGeneration:confirmed.computerProof.generation,committedComputerMoves:1,banners};
  writeFileSync(info.outputPath('obsolete-computer-recovery.json'),JSON.stringify(receipt,null,2));await info.attach('obsolete-computer-recovery',{path:info.outputPath('obsolete-computer-recovery.json'),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('obsolete-computer-recovery.png')});
 }finally{release();await page.evaluate(()=>window.obsoleteComputerBannerObserver?.disconnect()).catch(()=>{});await context.unrouteAll({behavior:'wait'});}
});

}

test('initial computer control keeps Pass visible and disabled until acknowledged',async({page,context},info)=>{
 await page.addInitScript(()=>window.WebSocket=undefined);await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 let release,acquisition;const held=new Promise(resolve=>release=resolve),applications=[];
 await context.route('**/shared',async route=>{const body=route.request().postDataJSON();if(body?.payload?.operation==='computer-control'&&body.payload.values?.action==='acquire'){acquisition=body;await held;}await route.continue();});
 page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.endsWith('/apply'))applications.push(request.postDataJSON());});
 try{
  await page.getByRole('button',{name:'Play Babs',exact:true}).click();await expect.poll(()=>Boolean(acquisition)).toBe(true);await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const pass=page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true});await expect(pass).toBeVisible();await expect(pass).toBeDisabled();expect(applications).toHaveLength(0);
  release();await expect(page.locator('[data-computer-activity="here"]')).toHaveText('Active here');await expect(pass).toBeEnabled();expect(applications).toHaveLength(0);
  await info.attach('initial-computer-admission',{body:JSON.stringify({commandId:acquisition.clientCommandId,applicationsBeforeHumanAction:applications.length}),contentType:'application/json'});
 }finally{release();await context.unrouteAll({behavior:'wait'});}
});
