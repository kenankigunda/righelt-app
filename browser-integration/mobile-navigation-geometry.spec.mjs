import {test,expect} from '@playwright/test';
import {settleMobileNavigationRow} from './support/mobile-navigation-geometry.mjs';

test.use({viewport:{width:390,height:740}});
test('navigation row waits for its original finite transition before strict geometry and hits',async({page},info)=>{
 await page.goto('/browser-integration/support/board-message.html');
 await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>{
  const nav=document.createElement('nav');nav.className='shell-mobile-tabbar';nav.dataset.visible='false';
  nav.innerHTML='<button type="button" class="mobile-nav-reveal" data-mobile-nav-reveal aria-label="Show game navigation"></button><div class="mobile-nav-controls" data-mobile-nav-controls>'+['Players','Board','History'].map(label=>`<button type="button" class="shell-mobile-tab">${label}</button>`).join('')+'</div>';
  document.querySelector('#app').append(nav);
  nav.querySelector('[data-mobile-nav-controls]').getBoundingClientRect();
  nav.dataset.visible='true';
  const row=nav.querySelector('[data-mobile-nav-controls]');row.getBoundingClientRect();
  // Capture and pause in the same render turn, before an external round trip.
  window.originalNavigationTransitions=row.getAnimations();
  window.originalNavigationTransitions.forEach(animation=>{animation.pause();animation.currentTime=90;});
 });
 const nav=page.locator('.shell-mobile-tabbar');
 const original=await nav.evaluate(node=>({revealAnimations:node.querySelector('[data-mobile-nav-reveal]').getAnimations({subtree:true}).length,row:node.querySelector('[data-mobile-nav-controls]').getAnimations().map(animation=>({name:animation.transitionProperty,end:animation.effect.getComputedTiming().endTime,playState:animation.playState}))}));
 expect(original.revealAnimations).toBe(0);expect(original.row.some(animation=>animation.name==='transform'&&animation.end===180&&animation.playState==='paused')).toBe(true);
 let settled=false;
 const pending=settleMobileNavigationRow(nav).then(()=>{settled=true;});
 await page.route('**/controlled-navigation-transition-ack',async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.fulfill({status:200,body:'held beyond the original180ms transition'});});
 try{
  await page.evaluate(()=>fetch('/controlled-navigation-transition-ack'));
  expect(settled,'row settlement must remain pending while its original transition is paused').toBe(false);
 }finally{
  await page.evaluate(()=>window.originalNavigationTransitions.forEach(animation=>animation.play()));
  await pending;
 }
 const sample=()=>nav.evaluate(node=>{
  const row=node.querySelector('[data-mobile-nav-controls]');
  return {row:row.getBoundingClientRect().toJSON(),rowTransform:getComputedStyle(row).transform,controls:[...row.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;const owns=(x,y)=>{const hit=document.elementFromPoint(x,y);return hit===button||button.contains(hit);};return {rect:rect.toJSON(),centerOwned:owns(x,y),hits:[[-21.5,-21.5],[21.5,-21.5],[-21.5,21.5],[21.5,21.5]].map(([dx,dy])=>owns(x+dx,y+dy))};})};
 });
 const assertGeometry=value=>{
  expect(value.row.height).toBeGreaterThanOrEqual(52);
  expect(value.controls).toHaveLength(3);
  for(const control of value.controls){expect(control.rect.width).toBeGreaterThanOrEqual(44);expect(control.rect.height).toBeGreaterThanOrEqual(44);expect(control.centerOwned).toBe(true);expect(control.hits).toEqual([true,true,true,true]);}
 };
 const positive=await sample();assertGeometry(positive);expect(positive.rowTransform).toBe('none');
 await nav.locator('[data-mobile-nav-controls]').evaluate(row=>row.style.paddingTop='2px');
 const shortRow=await sample();expect(shortRow.row.height).toBe(51);expect(()=>assertGeometry(shortRow)).toThrow();
 await nav.locator('[data-mobile-nav-controls]').evaluate(row=>row.style.removeProperty('padding-top'));
 await nav.locator('.shell-mobile-tab').first().evaluate(button=>{button.style.minHeight='43px';button.style.height='43px';button.style.padding='0';});
 const shortControl=await sample();expect(shortControl.controls[0].rect.height).toBe(43);expect(()=>assertGeometry(shortControl)).toThrow();
 // Replacing or disconnecting an observed row must not qualify stale geometry.
 const startPaused=()=>nav.evaluate(node=>{
  // A fresh hidden native row avoids reversing a just-started hide transition
  // at zero time. Capture the same original show transition as the first case.
  const current=node.cloneNode(true);current.dataset.visible='false';node.replaceWith(current);
  const row=current.querySelector('[data-mobile-nav-controls]');row.getBoundingClientRect();
  current.dataset.visible='true';row.getBoundingClientRect();
  window.originalNavigationTransitions=row.getAnimations();
  window.originalNavigationTransitions.forEach(animation=>{animation.pause();animation.currentTime=90;});
 });
 for(const mutation of ['replace-controls','cancel-transition','hide-navigation','disconnect-navigation']){
  await startPaused();
  // Confirm this control still owns an unfinished original transition.
  expect(await nav.locator('[data-mobile-nav-controls]').evaluate(row=>row.getAnimations().some(animation=>animation.transitionProperty==='transform'&&animation.effect.getComputedTiming().endTime===180&&animation.playState==='paused'))).toBe(true);
  const stale=settleMobileNavigationRow(nav);
  const rejected=expect(stale).rejects.toThrow();
  // This queued browser turn follows the settlement's synchronous capture.
  await nav.evaluate((node,mutation)=>{if(mutation==='replace-controls'){const row=node.querySelector('[data-mobile-nav-controls]');row.replaceWith(row.cloneNode(true));}else if(mutation==='cancel-transition')window.originalNavigationTransitions.forEach(animation=>animation.cancel());else if(mutation==='hide-navigation')node.dataset.visible='false';else node.remove();},mutation);
  await rejected;
 }
 await info.attach('Original navigation transition and strict negative geometry',{body:JSON.stringify({original,positive,shortRow,shortControl}),contentType:'application/json'});
});
