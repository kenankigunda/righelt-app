import {test,expect} from '@playwright/test';
for(const [width,scale] of [[390,100],[390,200],[1440,100],[1440,200]])test(`side-card loading shares actual flow at ${width}/${scale}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await page.goto('/browser-integration/support/panel-loading.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
 const measure=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-card]')].map(card=>{const r=card.getBoundingClientRect(),h=card.querySelector('h2').getBoundingClientRect();return [card.dataset.card,{x:r.x,y:r.y,width:r.width,height:r.height,heading:h.y,rows:[...card.querySelectorAll('p.small,.participant-list > li,.history-list > li')].map(n=>{const b=n.getBoundingClientRect();return {y:b.y-r.y,height:b.height};})}];})));
 const before=await measure();expect(await page.getByRole('button').count()).toBe(0);
 await page.screenshot({path:info.outputPath(`held-${width}-${scale}.png`),fullPage:true});
 await page.evaluate(()=>window.renderPanels(false));const after=await measure();
 await info.attach('paired-geometry',{body:JSON.stringify({before,after},null,2),contentType:'application/json'});
 for(const key of ['summary','players','history']){
  expect(after[key].x).toBe(before[key].x);expect(after[key].width).toBe(before[key].width);
  // Unknown values may wrap differently; this fixture requires matching anchors within1px.
  expect(Math.abs(after[key].height-before[key].height)).toBeLessThanOrEqual(1);
  expect(after[key].rows).toHaveLength(before[key].rows.length);
  for(let i=0;i<before[key].rows.length;i++)expect(Math.abs(after[key].rows[i].y-before[key].rows[i].y)).toBeLessThanOrEqual(1);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await expect(page.getByRole('button',{name:'Invite someone to view'})).toBeVisible();
 await page.screenshot({path:info.outputPath(`loaded-${width}-${scale}.png`),fullPage:true});
});
