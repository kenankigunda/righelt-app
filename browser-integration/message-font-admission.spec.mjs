import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const anchors=page=>page.evaluate(()=>window.fontAnchors());
const sameAnchors=(a,b)=>{for(const target of ['slot','board','panel'])for(const key of ['x','y','width','height'])expect(Math.abs(a[target][key]-b[target][key]),`${target}.${key}`).toBeLessThanOrEqual(.1);};
for(const width of [320,390,768,932,933,1440])for(const scale of [100,200])test(`cold and settled-reload message reservation at ${width}px and ${scale}%`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const key=`font-admission-${width}-${scale}`,fontUrl=`/apps/web/assets/fonts/Manrope-variable.ttf?${key}`;
 let release,seen=false,hold=true;const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/apps/web/shell/refresh.css',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('../assets/fonts/Manrope-variable.ttf',fontUrl)});});
 await page.route(url=>url.pathname==='/apps/web/assets/fonts/Manrope-variable.ttf'&&url.searchParams.has(key),async route=>{seen=true;if(hold)await held;await route.continue();});
 const receipts={};
 try{
  await page.goto(`/browser-integration/support/message-font-admission.html?scale=${scale}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.fixtureReady);await expect.poll(()=>seen).toBe(true);
  receipts.cold=await anchors(page);expect(receipts.cold.fontStatus).toBe('loading');
  expect(receipts.cold.slot.width).toBeGreaterThan(0);expect(Math.abs(receipts.cold.slot.width-receipts.cold.availableInlineSize)).toBeLessThanOrEqual(.1);
  receipts.coldEnvelope=await page.evaluate(()=>window.fontEnvelope());
  hold=false;release();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  receipts.loaded=await anchors(page);receipts.loadedEnvelope=await page.evaluate(()=>window.fontEnvelope());
  sameAnchors(receipts.cold,receipts.loaded);
  expect(await page.evaluate(()=>window.admitMessagePhases())).toEqual([]);
  if(scale===100&&[320,390].includes(width))expect(receipts.loaded.slot.height).toBeLessThanOrEqual(receipts.loadedEnvelope.rows[0].lineHeight*3);
  // Routing disables HTTP caching. This witnesses settled reload consistency,
  // not cache-admitted first paint. The actual cache-warm E2E is separate.
  await page.reload();await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  receipts.warm=await anchors(page);sameAnchors(receipts.loaded,receipts.warm);
  expect(await page.evaluate(()=>window.admitMessagePhases())).toEqual([]);
 }finally{hold=false;release();const path=info.outputPath('font-reservation-receipt.json');await writeFile(path,JSON.stringify(receipts,null,2));await info.attach('font-reservation',{path,contentType:'application/json'});}
});

test('loaded message width envelope never exceeds its permanent fallback reservation',async({page},info)=>{
 const failures=[];
 await page.goto('/browser-integration/support/message-font-admission.html');await page.waitForFunction(()=>window.fixtureReady);
 for(const scale of [100,200]){
  await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;},scale);
  for(let width=280;width<=800;width+=16){const envelope=await page.evaluate(width=>window.fontEnvelope(width),width);if(envelope.primary>envelope.fallback+.1)failures.push({scale,...envelope});}
 }
 const path=info.outputPath('primary-over-fallback-envelopes.json');await writeFile(path,JSON.stringify(failures,null,2));await info.attach('primary-over-fallback',{path,contentType:'application/json'});
 expect(failures.map(({scale,width,primary,fallback})=>({scale,width,primary,fallback})),'Any uncovered primary bin must be reviewed before adding a measured floor').toEqual([]);
});


test('measured font boundaries keep cold, loaded and settled-reload row envelopes identical',async({page},info)=>{
 const bands=[[10.1875,10.53125],[11.125,11.40625],[14.75,14.90625],[21.875,22.4375]];
 const receipts={cold:[],loaded:[],warm:[]};let release,seen=false,hold=true;const held=new Promise(resolve=>{release=resolve;});
 const key='message-boundary-admission',fontUrl=`/apps/web/assets/fonts/Manrope-variable.ttf?${key}`;
 await page.route('**/apps/web/shell/refresh.css',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('../assets/fonts/Manrope-variable.ttf',fontUrl)});});
 await page.route(url=>url.pathname==='/apps/web/assets/fonts/Manrope-variable.ttf'&&url.searchParams.has(key),async route=>{seen=true;if(hold)await held;await route.continue();});
 const measure=async()=>{
  const result=[];
  for(const scale of [100,200]){
   await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;},scale);
   result.push(...await page.evaluate(({scale,bands})=>{
    const size=parseFloat(getComputedStyle(document.querySelector('.board-message-slot')).fontSize);
    const widths=[...new Set([280,296,334.375,366.8,491.6,800,...(scale===200?[326.125,326.25,326.5,326.75,327]:[]),...bands.flatMap(([lower,upper])=>[lower*size-.5,lower*size,lower*size+.5,(lower+upper)*size/2,upper*size-.5,upper*size,upper*size+.5])])].filter(width=>width>=280&&width<=800).sort((a,b)=>a-b);
    return widths.map(width=>({scale,...window.fontEnvelope(width)}));
   },{scale,bands}));
  }
  return result;
 };
 try{
  await page.goto('/browser-integration/support/message-font-admission.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.fixtureReady);await expect.poll(()=>seen).toBe(true);
  expect(await page.evaluate(()=>document.fonts.status)).toBe('loading');receipts.cold=await measure();
  hold=false;release();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});receipts.loaded=await measure();
  // Routing disables HTTP caching. This witnesses settled reload consistency,
  // not cache-admitted first paint. The actual cache-warm E2E is separate.
  await page.reload();await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(()=>document.fonts.ready);receipts.warm=await measure();
  for(let index=0;index<receipts.cold.length;index++){
   const cold=receipts.cold[index],loaded=receipts.loaded[index],warm=receipts.warm[index],label=`${cold.scale}% / ${cold.width}px`;
   expect(loaded.primary,`${label} primary fits permanent fallback`).toBeLessThanOrEqual(loaded.fallback+.1);
   expect(Math.max(cold.primary,cold.fallback),`${label} cold to loaded`).toBeCloseTo(Math.max(loaded.primary,loaded.fallback),5);
   expect(Math.max(warm.primary,warm.fallback),`${label} settled reload`).toBeCloseTo(Math.max(loaded.primary,loaded.fallback),5);
   if(cold.scale===100)expect(Math.max(loaded.primary,loaded.fallback),`${label} normal three-line bound`).toBeLessThanOrEqual(loaded.rows[0].lineHeight*3);
  }
 }finally{hold=false;release();const path=info.outputPath('font-boundary-admission.json');await writeFile(path,JSON.stringify(receipts,null,2));await info.attach('font-boundary-admission',{path,contentType:'application/json'});}
});
