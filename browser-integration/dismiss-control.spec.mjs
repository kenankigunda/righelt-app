import {test,expect} from '@playwright/test';

for(const width of [390,1200])test(`shared dismissal remains subtle and operable at ${width}px and enlarged text`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/browser-integration/support/dismiss-control.html');await page.waitForFunction(()=>window.fixtureReady);
 for(const fontSize of [16,32]){
  await page.evaluate(size=>document.documentElement.style.fontSize=size+'px',fontSize);
  for(const label of ['Close','Close invite','Close History']){
   const button=page.getByRole('button',{name:label,exact:true});const box=await button.boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
   const styles=await button.evaluate(n=>({background:getComputedStyle(n).backgroundColor,border:getComputedStyle(n).borderTopWidth,shadow:getComputedStyle(n).boxShadow,glyph:n.querySelector('svg').getBoundingClientRect().width}));
   expect(styles.background).toBe('rgba(0, 0, 0, 0)');expect(styles.border).toBe('0px');expect(styles.shadow).toBe('none');expect(styles.glyph).toBe(16);
  }
 }
 const close=page.getByRole('button',{name:'Close',exact:true});await close.focus();await page.keyboard.press('Enter');await page.keyboard.press('Space');expect(await page.evaluate(()=>window.counts)).toEqual({dismiss:2,submit:0});
 await expect(close).toBeFocused();expect(await close.evaluate(n=>getComputedStyle(n).outlineStyle)).not.toBe('none');
 await page.getByRole('button',{name:'Open dialog',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Dismiss fixture'});await expect(dialog).toBeVisible();const storyClose=dialog.getByRole('button',{name:'Close opponent story',exact:true});await storyClose.focus();await page.keyboard.press('Space');await expect(dialog).not.toBeVisible();await expect(page.locator('#open')).toBeFocused();
 await page.locator('#open').click();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.locator('#open')).toBeFocused();
});


test('coarse pointers do not gain a sticky hover surface',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,viewport:{width:390,height:900},hasTouch:true});
 try{const page=await context.newPage();await page.goto('/browser-integration/support/dismiss-control.html');await page.waitForFunction(()=>window.fixtureReady);
 expect(await page.evaluate(()=>matchMedia('(hover: hover)').matches)).toBe(false);
 const close=page.getByRole('button',{name:'Close',exact:true});await close.tap();
 expect(await close.evaluate(n=>getComputedStyle(n).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 expect(await page.evaluate(()=>window.counts)).toEqual({dismiss:1,submit:0});
 }finally{await context.close()}
});
