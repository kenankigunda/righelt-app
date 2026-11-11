import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`mature computer hover mirror stays beneath actual notice paint at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:800});
 await page.goto('/browser-integration/support/notifications.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='/apps/web/shell/board-ux.css';
  await new Promise((resolve,reject)=>{sheet.onload=resolve;sheet.onerror=reject;document.head.append(sheet);});
  await document.fonts.ready;window.update([]);
  const main=document.querySelector('.shell-main-content'),app=document.createElement('div');app.id='app';app.className='app-root';main.before(app);app.append(main);
  const route=main.querySelector('main');route.classList.add('game-shell-frame');
  const {SWIPE_EASING_CSS}=await import('/apps/web/shell/navigation-motion.js');document.documentElement.style.setProperty('--shell-game-entry-easing',SWIPE_EASING_CSS);
  Object.assign(app.dataset,{shellLayoutMode:innerWidth<933?'narrow':'wide',shellTransitionActive:'true',shellTransition:'game-entry',shellTransitionPhase:'revealing',shellRoute:'game'});
  const {renderComputerPlayerCard}=await import('/apps/web/shell/computer-player-card.js');
  const {mountHoverTooltips}=await import('/apps/web/shell/hover-tooltip.js');
  const root=document.createElement('div');root.id='tooltip-layer-probe';root.style.cssText=`position:fixed;top:180px;left:${Math.max(8,(innerWidth-300)/2)}px;width:300px;`;
  root.innerHTML=`<ul class="participant-list" data-testid="participants-list"><li>${renderComputerPlayerCard({computerProfile:'horus'},{gameId:'tooltip-probe',side:'P2',activity:{state:'here',label:'Active here',showResume:false}})}</li></ul>`;
  route.append(root);mountHoverTooltips(root);window.tooltipLayerProbe={clicks:0};
 });
 const row=page.getByRole('button',{name:'Horus, Blue, Computer player, Active here',exact:true});await expect(row).toHaveAccessibleName('Horus, Blue, Computer player, Active here');
 await row.hover();const tooltip=page.locator('.hover-tooltip');await expect(tooltip).toHaveText('Horus, Blue, Computer player, Active here');
 await expect.poll(()=>tooltip.evaluate(node=>getComputedStyle(node).opacity)).toBe('1');
 await page.screenshot({path:info.outputPath(`mature-tooltip-alone-${width}.png`)});
 const tooltipRect=await tooltip.boundingBox();expect(tooltipRect).toBeTruthy();
 await page.evaluate(()=>{
  window.update([{key:'processing',activity:'static',body:'<p>Notice owns the foreground.</p><p>Computer activity remains available below it.</p><p>Keep the existing controls and document order.</p><p>Complete report text stays readable.</p>'}]);
  document.querySelector('[data-action="retry"]').addEventListener('click',()=>window.tooltipLayerProbe.clicks++);
 });
 // Native entry into the mirror's geometry keeps it alive while hit testing
 // passes through to the actual notice. Never synthesize hover/focus state.
 await page.mouse.move(tooltipRect.x+tooltipRect.width/2,tooltipRect.y+tooltipRect.height/2);
 await page.locator('.shell-header-status').evaluate(async node=>{
  const finite=node.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime));
  await Promise.all(finite.map(animation=>animation.finished));
 });
 await expect(tooltip).toBeVisible();
 const geometry=await page.evaluate(()=>{
  const tip=document.querySelector('.hover-tooltip'),status=document.querySelector('.shell-header-status'),notice=status.querySelector('.shell-game-alert');
  const a=tip.getBoundingClientRect(),b=notice.getBoundingClientRect();
  const x=Math.ceil(Math.max(a.left+4,b.left+30)),y=Math.ceil(Math.max(a.top+4,b.top+20));
  const right=Math.floor(Math.min(a.right-4,b.right-30)),bottom=Math.floor(Math.min(a.bottom-4,b.bottom-30));
  return {tip:{x:a.x,y:a.y,width:a.width,height:a.height},notice:{x:b.x,y:b.y,width:b.width,height:b.height},clip:{x,y,width:right-x,height:bottom-y},tipLayer:getComputedStyle(tip).zIndex,noticeLayer:getComputedStyle(status).zIndex,tipPointerEvents:getComputedStyle(tip).pointerEvents,tipAnimation:getComputedStyle(tip).animationName,noticeAnimations:status.getAnimations({subtree:true}).filter(animation=>['running','paused'].includes(animation.playState)||animation.pending).map(animation=>animation.animationName),utilityToken:getComputedStyle(document.documentElement).getPropertyValue('--shell-layer-utility').trim()};
 });
 expect(geometry.clip.width).toBeGreaterThanOrEqual(8);expect(geometry.clip.height).toBeGreaterThanOrEqual(6);
 expect(geometry.tipPointerEvents).toBe('none');expect(geometry.tipAnimation).toBe('none');expect(geometry.noticeAnimations).toEqual([]);
 await info.attach('mature-tooltip-notice-geometry',{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
 await page.screenshot({path:info.outputPath(`mature-tooltip-and-notice-${width}.png`)});
 const actual=await page.screenshot({path:info.outputPath(`overlap-tooltip-present-${width}.png`),clip:geometry.clip});
 let baseline;
 await tooltip.evaluate(node=>{node.style.visibility='hidden';});
 try{
  await page.screenshot({path:info.outputPath(`notice-tooltip-hidden-${width}.png`)});
  baseline=await page.screenshot({path:info.outputPath(`overlap-tooltip-hidden-${width}.png`),clip:geometry.clip});
 }finally{await tooltip.evaluate(node=>{node.style.visibility='';});}
 expect(actual.equals(baseline),'opaque mature notice paint must hide the lower hover mirror').toBe(true);
 expect(Number(geometry.tipLayer)).toBe(Number(geometry.utilityToken));expect(Number(geometry.noticeLayer)).toBeGreaterThan(Number(geometry.tipLayer));
 const retry=page.getByRole('button',{name:'Retry',exact:true});await retry.click();expect(await page.evaluate(()=>window.tooltipLayerProbe.clicks)).toBe(1);
 await retry.focus();await page.evaluate(()=>{window.tooltipLayerProbe.focused=document.activeElement;window.update([{key:'processing',activity:'static',body:'Still checking the same move'}]);});
 expect(await page.evaluate(()=>document.activeElement===window.tooltipLayerProbe.focused)).toBe(true);
 await page.evaluate(()=>{const modal=document.createElement('dialog');modal.className='account-dialog';modal.dataset.presentation='modal';modal.innerHTML='<button>Modal action</button>';document.body.append(modal);window.tooltipLayerProbe.modal=modal;modal.showModal();});
 await expect(page.getByRole('button',{name:'Modal action',exact:true})).toBeFocused();
 expect(await retry.evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('dialog')===window.tooltipLayerProbe.modal;})).toBe(true);
 await page.keyboard.press('Escape');await expect(retry).toBeFocused();await retry.press('Enter');expect(await page.evaluate(()=>window.tooltipLayerProbe.clicks)).toBe(2);
});
