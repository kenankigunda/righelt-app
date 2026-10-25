import {test,expect} from '@playwright/test';

for(const hover of ['hover','none'])for(const reduced of [false,true])test(`header utility spacing respects ${hover} capability and expands on keyboard intent${reduced?' with reduced motion':''}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 await page.goto(`/browser-integration/support/header-actions.html?hover=${hover}`);
 await page.waitForFunction(()=>window.fixtureReady);
 const scenarios=page.getByRole('button',{name:'Scenarios',exact:true}),debug=page.getByRole('button',{name:'Debug',exact:true});
 await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeLessThanOrEqual(46);
 expect(await scenarios.evaluate(element=>getComputedStyle(element).gap)).toBe('0px');
 await page.evaluate(()=>window.originalHeaderControl=document.querySelector('[data-action="open-scenarios"]'));
 await scenarios.hover();
 if(hover==='hover')await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeGreaterThan(90);
 else {expect(await scenarios.evaluate(element=>element.matches(':hover'))).toBe(true);await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeLessThanOrEqual(46);}
 await page.mouse.move(1,1);await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeLessThanOrEqual(46);
 // Safari's default keyboard navigation includes all controls with Option-Tab.
 const nextControl=info.project.name==='webkit'?'Alt+Tab':'Tab';
 await page.keyboard.press(nextControl);await expect(scenarios).toBeFocused();
 await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeGreaterThan(90);
 await page.keyboard.press('Enter');await page.keyboard.press(nextControl);await expect(debug).toBeFocused();
 await expect.poll(async()=>(await debug.boundingBox()).width).toBeGreaterThan(80);
 await page.keyboard.press('Enter');
 expect(await page.evaluate(()=>window.activated)).toEqual(['open-scenarios','open-debug']);
 expect(await scenarios.evaluate(element=>element===window.originalHeaderControl)).toBe(true);
 if(reduced)expect(await debug.locator('.header-action-label').evaluate(element=>getComputedStyle(element).transitionDuration)).toBe('0s');
 await debug.evaluate(element=>element.blur());
 await expect.poll(async()=>(await debug.boundingBox()).width).toBeLessThanOrEqual(46);
 const ordinary=page.getByRole('link',{name:'Home',exact:true});
 expect(await ordinary.evaluate(element=>getComputedStyle(element).gap)).toBe('9px');
 await expect(ordinary.locator('svg')).toHaveAttribute('aria-hidden','true');
});
