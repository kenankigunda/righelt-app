import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('actual paper lifecycle paints native geometry and gives urgent controls immediate ownership',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/browser-integration/support/notifications.html');
 await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  const [{createNotificationPaper},{createNotificationPatchLifecycle,renderGameAlertStackCard},{renderGameAlertCard}]=await Promise.all([
   import('/apps/web/shell/notification-paper.js'),import('/apps/web/shell/game-alert-presentation.js'),import('/apps/web/shell/game-alert.js')]);
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const paper=createNotificationPaper({document,scope:()=> 'native-paper-visit'});
  const patches=createNotificationPatchLifecycle(paper),region=document.getElementById('shell-game-alerts');
  window.nativePaper={paper,clicks:0,patch(items){patches.patchHtml(region,items.map((item,index)=>renderGameAlertStackCard({gameId:'native-paper',item:{...item,html:renderGameAlertCard(item)},stackIndex:index,totalAlerts:items.length},escape)).join(''));}};
  region.addEventListener('click',event=>{if(event.target.closest('[data-native-retry]'))window.nativePaper.clicks++;});
  window.nativePaper.patch([]);
  window.nativePaper.patch([{key:'information',paperKind:'history-change',body:'Move recorded'}]);
  const surface=region.querySelector('.shell-game-alert'),face=surface.querySelector('.notice-paper-face'),rect=surface.getBoundingClientRect();
  window.nativePaper.initial={clip:surface.style.clipPath,transform:face.style.transform,copyOpacity:surface.querySelector('.shell-game-alert-copy').style.opacity,position:getComputedStyle(face).position,rect:rect.toJSON(),viewport:{width:innerWidth,height:innerHeight}};
 });
 try{
  const initial=await page.evaluate(()=>window.nativePaper.initial);
  expect(initial.clip).toContain('polygon(');expect(initial.transform).toContain('translateZ(54px)');expect(initial.copyOpacity).toBe('0');expect(initial.position).toBe('absolute');
  expect(initial.rect.width).toBeGreaterThan(0);expect(initial.rect.height).toBeGreaterThan(0);expect(initial.rect.left).toBeGreaterThanOrEqual(0);expect(initial.rect.right).toBeLessThanOrEqual(initial.viewport.width);
  const surface=page.locator('[data-notification-id="information"] .shell-game-alert');
  await expect.poll(()=>surface.evaluate(node=>node.style.clipPath)).toBe('');
  await expect(surface).toHaveText('Move recorded');
  await page.screenshot({path:info.outputPath('paper-settled-phone.png')});
  const departure=await page.evaluate(()=>{
   const beforeDeparture=document.querySelector('[data-notification-id="information"] .shell-game-alert').getBoundingClientRect().toJSON(),dpr=devicePixelRatio;
   window.nativePaper.patch([]);
   const host=document.querySelector('.notice-paper-exit');
   return host?{beforeDeparture,dpr,inert:host.inert,hidden:host.getAttribute('aria-hidden'),controls:host.querySelectorAll('button,a,input,[data-action],[id],[aria-live]').length,text:host.textContent,rect:host.getBoundingClientRect().toJSON()}:null;
  });
  expect(departure).not.toBeNull();expect(departure.inert).toBe(true);expect(departure.hidden).toBe('true');expect(departure.controls).toBe(0);expect(departure.text).toBe('Move recorded');
  expect(Number.isFinite(departure.dpr)&&departure.dpr>0).toBe(true);
  const tolerance=Math.max(.5,1/departure.dpr);
  for(const key of ['left','top','width','height'])expect(Math.abs(departure.rect[key]-departure.beforeDeparture[key])).toBeLessThanOrEqual(tolerance);
  await expect(page.locator('.notice-paper-exit')).toHaveCount(0);
  const urgent=await page.evaluate(()=>{
   window.nativePaper.patch([{key:'second-information',paperKind:'undo-outcome',body:'Undo applied'}]);
   window.nativePaper.patch([{key:'urgent',paperKind:'history-change',priority:'urgent',activity:'waiting',body:'Recovery needs attention',action:'<button data-native-retry>Retry now</button>'}]);
   const node=document.querySelector('[data-notification-id="urgent"] .shell-game-alert');
   return {clip:node.style.clipPath,copyOpacity:getComputedStyle(node.querySelector('.shell-game-alert-copy')).opacity,exits:document.querySelectorAll('.notice-paper-exit').length};
  });
  expect(urgent).toEqual({clip:'',copyOpacity:'1',exits:0});
  await page.getByRole('button',{name:'Retry now',exact:true}).press('Enter');
  expect(await page.evaluate(()=>window.nativePaper.clicks)).toBe(1);
  await page.emulateMedia({forcedColors:'active'});
  await expect(page.getByRole('button',{name:'Retry now',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('urgent-forced-colors-phone.png')});
  const proof={initial,departure,urgent};const path=info.outputPath('paper-native-proof.json');await writeFile(path,JSON.stringify(proof,null,2));await info.attach('paper-native-proof',{path,contentType:'application/json'});
 }finally{
  await page.evaluate(()=>window.nativePaper?.paper.retire());
  await expect(page.locator('.notice-paper-exit')).toHaveCount(0);
 }
});
