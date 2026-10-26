import {test,expect} from '@playwright/test';
for(const width of [320,390])for(const scale of [100,200])test(`recovery clears the actual header at ${width}px and ${scale}% text`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/browser-integration/support/recovery-space.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
 const header=page.locator('.shell-header'),notice=page.getByTestId('recovery-notice');
 await page.evaluate(()=>{window.originalRecoveryNotice=document.querySelector('[data-testid="recovery-notice"]');window.originalRecoveryButton=window.originalRecoveryNotice.querySelector('button');});
 const clearance=async()=>page.evaluate(()=>{const header=document.querySelector('.shell-header').getBoundingClientRect(),zone=document.querySelector('.shell-header-status').getBoundingClientRect();return{gap:zone.top-Math.max(0,header.bottom),top:zone.top,maxHeight:parseFloat(getComputedStyle(document.querySelector('.shell-header-status')).maxHeight)};});
 for(const height of [52,96,160]){
  await page.evaluate(height=>window.setHeaderHeight(height),height);
  await expect.poll(async()=>(await clearance()).gap).toBeCloseTo(8,4);
  await expect(notice).toBeVisible();
  const measured=await clearance();expect(measured.maxHeight).toBeCloseTo(844-measured.top-8,3);
 }
 await page.getByRole('button',{name:'Reload game',exact:true}).focus();
 await page.evaluate(()=>scrollTo(0,400));await expect.poll(async()=>(await clearance()).top).toBeCloseTo(8,4);
 await page.evaluate(()=>document.querySelector('#app').style.setProperty('--recovery-safe-area-top','44px'));
 await expect.poll(async()=>(await clearance()).top).toBeCloseTo(52,4);
 expect((await clearance()).maxHeight).toBeCloseTo(844-52-8,3);
 await page.evaluate(()=>document.querySelector('#app').style.removeProperty('--recovery-safe-area-top'));
 await expect.poll(async()=>(await clearance()).top).toBeCloseTo(8,4);
 expect(await notice.evaluate(node=>node===window.originalRecoveryNotice&&node.querySelector('button')===window.originalRecoveryButton)).toBe(true);
 await expect(page.getByRole('button',{name:'Reload game',exact:true})).toBeFocused();
 await page.screenshot({path:info.outputPath(`recovery-space-${width}-${scale}.png`)});
 await page.evaluate(()=>{scrollTo(0,0);window.replaceHeader();window.setHeaderHeight(120);});
 await expect.poll(async()=>(await clearance()).gap).toBeCloseTo(8,4);
 await expect(header).toHaveCount(1);await expect(page.getByTestId('recovery-notice')).toHaveCount(1);
 await page.setViewportSize({width:1440,height:844});
 await page.evaluate(()=>document.querySelector('#app').dataset.shellLayoutMode='wide');
 await expect(page.locator('.shell-header-status')).toHaveCSS('position','absolute');
});
