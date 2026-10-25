import {test,expect} from '@playwright/test';
const ready=async page=>{await page.goto('/browser-integration/support/event-labels.html');await page.waitForFunction(()=>window.fixtureReady);};
const rectangles=page=>page.locator('.board-event-label').evaluateAll(nodes=>nodes.filter(node=>!node.hidden).map(node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,text:node.textContent};}));
const contained=async page=>{
 const rects=await rectangles(page),size=page.viewportSize();expect(rects.length).toBeGreaterThan(0);
 for(const r of rects){expect(r.left).toBeGreaterThanOrEqual(7.9);expect(r.top).toBeGreaterThanOrEqual(7.9);expect(r.right).toBeLessThanOrEqual(size.width-7.9);expect(r.bottom).toBeLessThanOrEqual(size.height-7.9);}
 return rects;
};
for(const width of [320,390])test(`event labels stay compact, reachable by sight and inert at ${width}px and enlarged text`,async({page},info)=>{
 await page.setViewportSize({width,height:720});await ready(page);
 await page.evaluate(()=>document.querySelector('#fixture-focus').focus());
 await page.evaluate(width=>window.fixtureUpdate([{id:'left',x:0,y:0},{id:'right',x:width-28,y:0,reason:'no_retreat'},{id:'near',x:width/2-14,y:260},{id:'near2',x:width/2-10,y:260},{id:'near3',x:width/2-6,y:260,reason:'commander_unsupplied'}]),width);
 await expect(page.locator('.board-event-label:visible')).toHaveCount(5);let rects=await contained(page);
 expect(rects.map(r=>r.text)).toEqual(['Lost supply','No retreat','Lost supply','Lost supply','Destroyed']);
 for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++)expect(Math.max(0,Math.min(rects[i].right,rects[j].right)-Math.max(rects[i].left,rects[j].left))*Math.max(0,Math.min(rects[i].bottom,rects[j].bottom)-Math.max(rects[i].top,rects[j].top))).toBe(0);
 await expect(page.locator('#fixture-focus')).toBeFocused();expect(await page.locator('.board-event-label-layer').evaluate(node=>({inert:node.inert,hidden:node.getAttribute('aria-hidden'),pointer:getComputedStyle(node).pointerEvents}))).toEqual({inert:true,hidden:'true',pointer:'none'});
 await page.screenshot({path:info.outputPath(`event-labels-${width}-100.png`)});
 expect(await page.locator('.board-event-label').first().evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.board-event-label')===null;})).toBe(true);
 await page.evaluate(()=>{window.fixtureFirst=document.querySelector('.board-event-label');document.documentElement.style.fontSize='200%';document.fonts.dispatchEvent(new Event('loadingdone'));});
 await expect.poll(async()=>{try{await contained(page);return true;}catch{return false;}}).toBe(true);
 expect(await page.evaluate(()=>window.fixtureFirst===document.querySelector('.board-event-label'))).toBe(true);
 await page.screenshot({path:info.outputPath(`event-labels-${width}-200.png`)});
 await page.locator('[data-event-id="near3"]').click();expect(await page.evaluate(()=>window.fixtureClicks)).toBe(1);
 await page.evaluate(()=>window.scrollTo(0,220));await expect.poll(async()=> (await rectangles(page)).length).toBe(3);await contained(page);
 await page.setViewportSize({width:width===320?390:320,height:650});await expect.poll(async()=>{try{await contained(page);return true;}catch{return false;}}).toBe(true);
});
test('event portal is scoped, clears on hidden/inert/static and cannot outlive its board',async({page})=>{
 await ready(page);const events=[{id:'same',x:40,y:90}];await page.evaluate(events=>window.fixtureUpdate(events),events);await expect(page.locator('.board-event-label')).toHaveCount(1);
 await page.evaluate(()=>window.fixtureFirst=document.querySelector('.board-event-label'));
 await page.evaluate(events=>window.fixtureUpdate(events),events);expect(await page.evaluate(()=>window.fixtureFirst===document.querySelector('.board-event-label'))).toBe(true);
 await page.evaluate(events=>window.fixtureUpdate(events,{scope:'other-game'}),events);await expect(page.locator('.board-event-label')).toHaveCount(1);expect(await page.evaluate(()=>window.fixtureFirst===document.querySelector('.board-event-label'))).toBe(false);
 for(const mode of ['hidden','inert','static']){
  await page.evaluate(mode=>{if(mode==='static')window.fixtureBoard.dataset.interactionMode='static';else window.fixtureBoard[mode]=true;},mode);
  await expect(page.locator('.board-event-label-layer')).toHaveCount(0);
  await page.evaluate(mode=>{if(mode==='static')delete window.fixtureBoard.dataset.interactionMode;else window.fixtureBoard[mode]=false;},mode);
  await expect(page.locator('.board-event-label-layer')).toHaveCount(0);
  await page.evaluate(events=>window.fixtureUpdate(events),events);await expect(page.locator('.board-event-label')).toHaveCount(1);
 }
 await page.evaluate(()=>window.fixtureBoard.remove());await expect(page.locator('.board-event-label-layer')).toHaveCount(0);
 await page.evaluate(()=>{window.fixtureController.destroy();window.dispatchEvent(new Event('resize'));document.fonts.dispatchEvent(new Event('loadingdone'));});await expect(page.locator('.board-event-label-layer')).toHaveCount(0);
});
