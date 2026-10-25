import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {test,expect} from '@playwright/test';

for(const reduced of [false,true])test(`header utility spacing stays collapsed and expands on intent${reduced?' with reduced motion':''}`,async({page},info)=>{
 const samples=[];
 const capture=async stage=>{
  try{samples.push(await page.evaluate(stage=>{
   const button=document.querySelector('[data-action="open-scenarios"]');
   const label=button?.querySelector('.header-action-label');
   const computed=element=>{if(!element)return null;const style=getComputedStyle(element);return Object.fromEntries(['display','width','minWidth','maxWidth','gap','opacity','visibility','overflow','fontFamily','fontSize','fontWeight','lineHeight','marginLeft','padding','transitionProperty','transitionDuration'].map(name=>[name,style[name]]));};
   const rules=[];
   const collect=(entries,conditions=[])=>{for(const rule of entries){if(rule.selectorText?.includes('header-action-label')||rule.selectorText?.includes('header-icon-action'))rules.push({selector:rule.selectorText,css:rule.style.cssText,conditions});if(rule.cssRules)collect(rule.cssRules,rule.conditionText?[...conditions,{text:rule.conditionText,matches:rule.media?matchMedia(rule.conditionText).matches:null}]:conditions);}};
   for(const sheet of document.styleSheets){try{collect(sheet.cssRules);}catch{rules.push({unreadableStylesheet:sheet.href});}}
   return {stage,at:performance.now(),hover:matchMedia('(hover: hover)').matches,anyHover:matchMedia('(any-hover: hover)').matches,
    marker:document.documentElement.getAttribute('data-hover-capability'),viewport:{width:innerWidth,height:innerHeight},
    button:{hover:button?.matches(':hover')??false,focusVisible:button?.matches(':focus-visible')??false,focused:document.activeElement===button,width:button?.getBoundingClientRect().width??null,computed:computed(button)},label:computed(label),rules};
  },stage));}catch(error){samples.push({stage,captureError:String(error)});}
 };
 try {
 await page.setViewportSize({width:1440,height:1000});
 await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 await page.goto('/browser-integration/support/header-actions.html');
 await page.waitForFunction(()=>window.fixtureReady);
 const scenarios=page.getByRole('button',{name:'Scenarios',exact:true}),debug=page.getByRole('button',{name:'Debug',exact:true});
 await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeLessThanOrEqual(46);
 expect(await scenarios.evaluate(element=>getComputedStyle(element).gap)).toBe('0px');
 await page.evaluate(()=>window.originalHeaderControl=document.querySelector('[data-action="open-scenarios"]'));
 await capture('before-hover');await scenarios.hover();await capture('immediately-after-hover');await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeGreaterThan(90);
 await page.mouse.move(1,1);await expect.poll(async()=>(await scenarios.boundingBox()).width).toBeLessThanOrEqual(46);
 // Safari's default keyboard navigation includes all controls with Option-Tab.
 const nextControl=info.project.name==='webkit'?'Alt+Tab':'Tab';
 await page.keyboard.press(nextControl);await expect(scenarios).toBeFocused();await capture('keyboard-focus');
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
 } catch(error) {await capture('failure');throw error;}
 finally {
  const path=info.outputPath('header-hover-diagnostics.json');
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify({browser:info.project.name,reducedMotion:reduced,samples},null,2));
  await info.attach('header-hover-diagnostics',{path,contentType:'application/json'});
 }
});
