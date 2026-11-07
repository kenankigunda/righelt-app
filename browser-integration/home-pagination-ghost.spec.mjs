import {test,expect} from '@playwright/test';

for(const width of [320,390,1440])for(const scale of [100,200])test(`Ghost arrows stay centered and readable at ${width}px and ${scale}%`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await page.goto('/browser-integration/support/home-pagination-ghost.html');await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;},scale);
 for(const fallback of [true,false])for(const index of [0,49,98]){
  await page.evaluate(options=>window.setup(options),{page:index,totalPages:99,placement:width===1440?'header':'footer',fallback});await page.evaluate(()=>document.fonts.ready);
  const row=page.locator('.home-games-section-controls'),buttons=row.locator('button');await expect(buttons).toHaveCount(2);
  const measure=()=>row.evaluate(row=>{const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};return {row:rect(row),label:rect(row.querySelector('p')),buttons:[...row.querySelectorAll('button')].map(button=>({box:rect(button),slot:rect(button.querySelector('.loading-icon-slot')),border:getComputedStyle(button).borderTopColor,hit:[[.5,.5],[.02,.5],[.98,.5],[.5,.02],[.5,.98]].every(([x,y])=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)?.closest('button')===button;})})),overflow:document.documentElement.scrollWidth>innerWidth};});
  const idle=await measure();expect(idle.overflow).toBe(false);for(const button of idle.buttons){expect(button.box.width).toBeGreaterThanOrEqual(44);expect(button.box.height).toBeGreaterThanOrEqual(44);expect(button.hit).toBe(true);expect(Math.abs(button.slot.cx-button.box.cx)).toBeLessThanOrEqual(.1);expect(button.border).toBe('rgba(0, 0, 0, 0)');expect(Math.abs(button.box.cy-idle.label.cy)).toBeLessThanOrEqual(.1);}
  await page.evaluate(()=>window.setPending(true));await expect(buttons.first()).toBeDisabled();await page.evaluate(()=>window.advance(199));await expect(row.locator('[data-loading-phase="quiet"]')).toHaveCount(2);await expect(page.locator('.loading-context')).toHaveCount(0);
  await page.evaluate(()=>window.advance(1));await expect(row.locator('[data-loading-phase="visible"]')).toHaveCount(2);
  await page.evaluate(()=>window.advance(4800));await expect(page.locator('.home-games-section > .loading-context[role="status"]')).toHaveCount(1);await expect(row.locator('.loading-context')).toHaveCount(0);
  const slow=await measure();expect(slow.row).toEqual(idle.row);expect(slow.label).toEqual(idle.label);expect(slow.buttons.map(item=>item.box)).toEqual(idle.buttons.map(item=>item.box));
  await page.evaluate(()=>window.setPending(false));await expect(page.locator('.loading-context')).toHaveCount(0);
 }
 await page.screenshot({path:info.outputPath(`ghost-${width}-${scale}.png`)});
});


test('Ghost arrows retain native keyboard activation, focus, and reduced-motion loading',async({page})=>{
 await page.goto('/browser-integration/support/home-pagination-ghost.html');await page.waitForFunction(()=>window.fixtureReady);
 const next=page.locator('[data-action="home-page-next"]');
 await next.evaluate(button=>{window.activations=0;window.originalArrow=button.querySelector('svg');button.addEventListener('click',()=>window.activations++);});
 await next.focus();await expect(next).toBeFocused();expect(await next.evaluate(button=>getComputedStyle(button).outlineWidth)).toBe('2px');
 await page.keyboard.press('Enter');await page.keyboard.press('Space');expect(await page.evaluate(()=>window.activations)).toBe(2);
 await page.evaluate(()=>window.setPending(true));await expect(next).toBeDisabled();await page.keyboard.press('Enter');await page.keyboard.press('Space');expect(await page.evaluate(()=>window.activations)).toBe(2);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.advance(200));await expect(next.locator('.loading-pieces')).toBeVisible();await expect(next.locator('svg')).toBeHidden();
 expect(await next.locator('.loading-pieces i').first().evaluate(piece=>getComputedStyle(piece).animationName)).toBe('none');
 await page.evaluate(()=>window.setPending(false));await expect(next).toBeEnabled();await expect(next.locator('svg')).toBeVisible();expect(await next.evaluate(button=>button.querySelector('svg')===window.originalArrow)).toBe(true);
 await page.evaluate(()=>{window.setPending(true);window.setPending(false);});await expect(page.locator('.loading-pieces:visible')).toHaveCount(0);await expect(page.locator('.loading-context')).toHaveCount(0);
});
