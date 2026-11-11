import {test as base,expect} from '@playwright/test';
import {controlledHeightPublication} from './support/height-publication-test-fixture.mjs';
const test=base.extend({publicationOwner:controlledHeightPublication});
import {writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {fontEnvelopeBudgetForBrowser,validateFontEnvelope} from './support/font-pattern-budget.mjs';
import {promptFrontiersEm} from '../apps/web/board/prompt-reservation.js';
import {decodeFontBoundarySamples} from './support/font-envelope-codec.mjs';
import {reservationBands,routineFontBoundaryEm,admittedHeight,budgetPixelPrecision,actionReservationMetrics} from './support/message-reservation-policy.mjs';
// This fixture controls the canonical CSS font URL, not the static server's
// API-request transport. Unrouted fixtures and E2E retain real CSS loading.
const refreshStylesheet = readFileSync(new URL('../apps/web/shell/refresh.css',import.meta.url),'utf8');
const originalFontReference = '../assets/fonts/Manrope-variable.ttf';
const stylesheetForFont = (fontUrl,source=refreshStylesheet) => {
 if(source.split(originalFontReference).length!==2)throw new Error('Expected exactly one canonical stylesheet font URL');
 return source.replace(originalFontReference,fontUrl);
};
const fulfillFontStylesheet = (route,fontUrl) => route.fulfill({status:200,
 headers:{'content-type':'text/css','cache-control':'no-store'},body:stylesheetForFont(fontUrl)});

test('controlled font stylesheet preserves canonical CSS and response metadata',async()=>{
 let delivered;const completed=Promise.resolve();
 const route={fetch(){throw new Error('Unexpected API-request CSS hop');},fulfill(value){delivered=value;return completed;}};
 const fontUrl='/apps/web/assets/fonts/Manrope-variable.ttf?font-admission-control';
 expect(fulfillFontStylesheet(route,fontUrl)).toBe(completed);await completed;
 expect(delivered.status).toBe(200);expect(delivered.headers).toEqual({'content-type':'text/css','cache-control':'no-store'});
 expect(delivered.body.split(fontUrl)).toHaveLength(2);
 expect(delivered.body.replace(fontUrl,originalFontReference)).toBe(refreshStylesheet);
});
test('controlled font stylesheet refuses missing or duplicate source font URLs',()=>{
 const fontUrl='/apps/web/assets/fonts/Manrope-variable.ttf?font-admission-control';
 for(const source of [refreshStylesheet.replace(originalFontReference,''),refreshStylesheet+'\n'+originalFontReference]){
  expect(()=>stylesheetForFont(fontUrl,source)).toThrow('Expected exactly one canonical stylesheet font URL');
 }
});

const anchors=page=>page.evaluate(()=>window.fontAnchors());
const sameAnchors=(a,b)=>{for(const target of ['heading','slot','board','panel'])for(const key of ['x','y','width','height'])expect(Math.abs(a[target][key]-b[target][key]),`${target}.${key}`).toBeLessThanOrEqual(.1);};
const checkRows=(envelope,coldIntrinsic,label,browserName)=>{
 const {budget,violations}=validateFontEnvelope(envelope,coldIntrinsic,{browserName});
 expect(violations,`${label} complete grammar, structural groups and every own row cap`).toEqual([]);
 return budget;
};
test('row budget retains a wider intrinsic fallback and rejects absent measurements',()=>{
 // Preserve an intrinsic fallback taller than the source width budget; an
 // absent measurement must never silently collapse to the primary-font floor.
 expect(admittedHeight(163,16,280)).toBe(280);
 for(const missing of [undefined,NaN,Infinity,-Infinity,0])expect(()=>admittedHeight(163,16,missing)).toThrow('intrinsic fallback measurement');
});
for(const width of [320,390,768,932,933,1440])for(const scale of [100,200])test(`cold and settled-reload message reservation at ${width}px and ${scale}%`,async({page,browserName,publicationOwner},info)=>{
 await page.setViewportSize({width,height:900});
 const key=`font-admission-${width}-${scale}`,fontUrl=`/apps/web/assets/fonts/Manrope-variable.ttf?${key}`;
 let release,seen=false,hold=true;const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/apps/web/shell/refresh.css',route=>fulfillFontStylesheet(route,fontUrl));
 await page.route(url=>url.pathname==='/apps/web/assets/fonts/Manrope-variable.ttf'&&url.searchParams.has(key),async route=>{seen=true;if(hold)await held;await route.continue();});
 const receipts={};
 try{
  await page.goto(`/browser-integration/support/message-font-admission.html?scale=${scale}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.fixtureReady&&window.currentFontAdmission?.().ready===true);await expect.poll(()=>seen).toBe(true);
  receipts.coldAdmission=await page.evaluate(()=>window.currentFontAdmission());receipts.cold=await anchors(page);expect(receipts.cold.fontStatus).toBe('loading');
  expect(receipts.cold.slot.width).toBeGreaterThan(0);expect(Math.abs(receipts.cold.slot.width-receipts.cold.availableInlineSize)).toBeLessThanOrEqual(.1);
  receipts.coldEnvelope=await page.evaluate(()=>window.fontEnvelope());
  receipts.coldIntrinsic=await page.evaluate(()=>window.fontEnvelope(undefined,{intrinsic:true}));
  receipts.coldIntrinsicFallback=receipts.coldIntrinsic.fallback;
  const coldBudget=checkRows(receipts.coldEnvelope,receipts.coldIntrinsic,'cold',browserName);
  expect(budgetPixelPrecision(receipts.cold.slot.height)).toBeLessThanOrEqual(budgetPixelPrecision(coldBudget.slotMax));
  receipts.coldAfterMeasurement=await anchors(page);sameAnchors(receipts.cold,receipts.coldAfterMeasurement);
  receipts.probeIsolation=await page.evaluate(()=>{const wrapper=document.querySelector('[data-font-measurement-wrapper]'),rect=wrapper.getBoundingClientRect(),style=getComputedStyle(wrapper);return {width:rect.width,height:rect.height,position:style.position,overflowX:style.overflowX,overflowY:style.overflowY,inert:wrapper.inert,hidden:wrapper.getAttribute('aria-hidden'),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};});
  expect(receipts.probeIsolation).toMatchObject({width:0,height:0,position:'fixed',overflowX:'hidden',overflowY:'hidden',inert:true,hidden:'true'});expect(receipts.probeIsolation.scrollWidth).toBeLessThanOrEqual(receipts.probeIsolation.viewport);
  hold=false;release();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  receipts.loaded=await anchors(page);receipts.loadedEnvelope=await page.evaluate(()=>window.fontEnvelope());
  sameAnchors(receipts.cold,receipts.loaded);
  expect(await page.evaluate(()=>window.admitMessagePhases())).toEqual([]);
  const loadedBudget=checkRows(receipts.loadedEnvelope,receipts.coldIntrinsic,'loaded',browserName);
  expect(budgetPixelPrecision(receipts.loaded.slot.height)).toBeLessThanOrEqual(budgetPixelPrecision(loadedBudget.slotMax));
  // Routing disables HTTP caching. This witnesses settled reload consistency,
  // not cache-admitted first paint. The actual cache-warm E2E is separate.
  await page.reload();await page.waitForFunction(()=>window.fixtureReady&&window.currentFontAdmission?.().ready===true);await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  await expect.poll(()=>page.evaluate(()=>{const track=document.querySelector('.game-shell-track');return Boolean(track)&&!track.getAnimations().some(animation=>animation.pending||animation.playState==='running');})).toBe(true);
  receipts.warm=await anchors(page);receipts.warmEnvelope=await page.evaluate(()=>window.fontEnvelope());sameAnchors(receipts.loaded,receipts.warm);
  const warmBudget=checkRows(receipts.warmEnvelope,receipts.coldIntrinsic,'settled reload',browserName);
  expect(budgetPixelPrecision(receipts.warm.slot.height)).toBeLessThanOrEqual(budgetPixelPrecision(warmBudget.slotMax));
  expect(await page.evaluate(()=>window.admitMessagePhases())).toEqual([]);
 }finally{hold=false;release();const path=info.outputPath('font-reservation-receipt.json');await writeFile(path,JSON.stringify(receipts,null,2));await info.attach('font-reservation',{path,contentType:'application/json'});}
});

for(const scale of [100,200])for(const {font,fallbackFamily=null} of [{font:'primary'},{font:'fallback'},{font:'fallback',fallbackFamily:'sans-serif'}])test(`loaded message width envelope at ${scale}% / ${font} / ${fallbackFamily??'native'}`,async({page,browserName,publicationOwner},info)=>{
 const failures=[],samples=[];
 await page.goto(`/browser-integration/support/message-font-admission.html?scale=${scale}`);await page.waitForFunction(()=>window.fixtureReady&&window.currentFontAdmission?.().ready===true);
 const frontiers=[];
 try{
 {
  await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;},scale);
  // Also measure the real generic fallback when Avenir Next is unavailable,
  // as on Linux CI. This never changes the live page or its native-font probes.
  frontiers.push(await page.evaluate(({scale,font,fallbackFamily,extra})=>{
   const fontSize=parseFloat(getComputedStyle(document.querySelector('.board-message-slot')).fontSize),cache=new Map();
   const measure=width=>{if(!cache.has(width)){const result=window.fontEnvelope(width,{intrinsic:true,fallbackFamily});const rows=result.rows.filter(row=>row.font===font);cache.set(width,{height:result[font],lineHeight:rows[0].lineHeight,variants:rows.filter(row=>row.height===result[font]).map(row=>row.variant)});}return cache.get(width);};
   const minimum=8.5*fontSize,maximum=60*fontSize,rows=[];
   const allowance=extra.em*fontSize+extra.px+4*Math.max(0,extra.halfPx-extra.halfEm*fontSize);
   for(let count=2;count<=10;count++){
    const fits=width=>{const value=measure(width);return value.height<=count*value.lineHeight+allowance;};
    if(fits(minimum)){rows.push({rows:count,atOrBelowMinimum:true,maximumWidth:minimum,maximumEm:8.5,sample:measure(minimum)});continue;}
    if(!fits(maximum)){rows.push({rows:count,notReached:true,minimumWidth:maximum,minimumEm:60,sample:measure(maximum)});continue;}
    let lower=minimum,upper=maximum;
    while(upper-lower>1/8){const middle=(lower+upper)/2;if(fits(middle))upper=middle;else lower=middle;}
    rows.push({rows:count,lowerWidth:lower,upperWidth:upper,lowerEm:lower/fontSize,upperEm:upper/fontSize,lower:measure(lower),upper:measure(upper)});
   }
   return {scale,font,fallbackFamily,fontSize,fontStatus:document.fonts.status,primaryFont:getComputedStyle(document.querySelector('[data-sizing-font="primary"]')).fontFamily,rows,measurements:cache.size};
  },{scale,font,fallbackFamily,extra:actionReservationMetrics}));
  for(let width=280;width<=800;width+=16){
   const {envelope,intrinsic}=await page.evaluate(({width,fallbackFamily})=>({envelope:window.fontEnvelope(width,{fallbackFamily}),intrinsic:window.fontEnvelope(width,{intrinsic:true,fallbackFamily})}),{width,fallbackFamily});
   samples.push({scale,width,envelope,intrinsic});
   const budget=fontEnvelopeBudgetForBrowser(envelope,intrinsic,{browserName}),violations=envelope.rows.filter((row,index)=>budgetPixelPrecision(row.height)>budgetPixelPrecision(budget.rows[index].contentMax));
   if(envelope.primary>envelope.fallback+.1||violations.length)failures.push({scale,...envelope,intrinsic,budget,violations});
  }
 }
 }finally{const rawPath=info.outputPath('loaded-width-envelope-raw.json');await writeFile(rawPath,JSON.stringify(samples));await info.attach('loaded-width-envelope-raw',{path:rawPath,contentType:'application/json'});const frontierPath=info.outputPath('intrinsic-primary-row-frontiers.json');await writeFile(frontierPath,JSON.stringify(frontiers,null,2));await info.attach('intrinsic-primary-row-frontiers',{path:frontierPath,contentType:'application/json'});}
 const path=info.outputPath('primary-over-fallback-envelopes.json');await writeFile(path,JSON.stringify(failures,null,2));await info.attach('primary-over-fallback',{path,contentType:'application/json'});
 expect(failures.map(({scale,width,primary,fallback})=>({scale,width,primary,fallback})),'Any uncovered primary bin must be reviewed before adding a measured floor').toEqual([]);
});


for(const scale of [100,200])test(`measured font boundaries keep cold, loaded and settled-reload row envelopes identical at ${scale}%`,async({page,browserName,publicationOwner},info)=>{
 const bands=reservationBands.map(({min,max})=>[min,max]);
 const receipts={cold:[],loaded:[],warm:[]};let release,seen=false,hold=true;const held=new Promise(resolve=>{release=resolve;});
 const key='message-boundary-admission',fontUrl=`/apps/web/assets/fonts/Manrope-variable.ttf?${key}`;
 await page.route('**/apps/web/shell/refresh.css',route=>fulfillFontStylesheet(route,fontUrl));
 await page.route(url=>url.pathname==='/apps/web/assets/fonts/Manrope-variable.ttf'&&url.searchParams.has(key),async route=>{seen=true;if(hold)await held;await route.continue();});
 const measure=async phase=>{
  const result=[],attempt={phase,admission:null,before:null,samples:null,after:null};
  (receipts.measurements??=[]).push(attempt);
   await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;},scale);
   const admission=attempt.admission=await page.evaluate(()=>window.currentFontAdmission());expect(admission.ready,'Current scale must already have a genuine owner publication while the font remains held').toBe(true);
   const before=attempt.before=await anchors(page);
   const measured=await page.evaluate(({scale,bands,routineFontBoundaryEm,promptFrontiersEm})=>{
    const size=parseFloat(getComputedStyle(document.querySelector('.board-message-slot')).fontSize);
    const widths=[...new Set([272,273.59375,280,288,296,334.375,349.5,355.5,360,365,365.5,366.8,456,471.5,491.6,573,573.125,696,699.5,800,...(scale===200?[326.125,326.25,326.5,326.75,327]:[]),...promptFrontiersEm.flatMap(frontier=>[-.125,0,.125].map(delta=>frontier*size+delta)),...[-.125,0,.125].map(delta=>routineFontBoundaryEm*size+delta),...bands.flatMap(([lower,upper])=>[lower*size-.125,lower*size,lower*size+.125,(lower+upper)*size/2,upper*size-.125,upper*size,upper*size+.125])])].filter(width=>width>=8.5*size&&width<=800).sort((a,b)=>a-b);
    let definitions;
    const samples=widths.map(width=>{
     const envelope=window.fontEnvelope(width);
     const intrinsic=window.fontEnvelope(width,{intrinsic:true});
     // Definitions are stable within this page/scale. Transfer them once while
     // retaining every fresh metric at every boundary, then restore full rows.
     definitions??=envelope.rows.map(({font,variant,text,pattern})=>({font,variant,text,pattern}));
     return {scale,width:envelope.width,outerPadding:envelope.outerPadding,probeWidth:envelope.probeWidth,usedMinimumProfile:envelope.usedMinimumProfile,usedSize:envelope.usedSize,primary:envelope.primary,fallback:envelope.fallback,
      rows:envelope.rows.map(({height,lineHeight,minHeight})=>[height,lineHeight,minHeight]),
      intrinsicRows:intrinsic.rows.map(({height,lineHeight,minHeight})=>[height,lineHeight,minHeight]),
      intrinsicPrimary:intrinsic.primary,intrinsicFallback:intrinsic.fallback};
    });
    return {definitions,samples};
   },{scale,bands,routineFontBoundaryEm,promptFrontiersEm});
   attempt.samples=decodeFontBoundarySamples(measured);result.push(...attempt.samples);
   attempt.after=await anchors(page);sameAnchors(before,attempt.after);
  return result;
 };
 try{
  await page.goto(`/browser-integration/support/message-font-admission.html?scale=${scale}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.fixtureReady&&window.currentFontAdmission?.().ready===true);await expect.poll(()=>seen).toBe(true);
  expect(await page.evaluate(()=>document.fonts.status)).toBe('loading');receipts.cold=await measure('cold');
  hold=false;release();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});receipts.loaded=await measure('loaded');
  // Routing disables HTTP caching. This witnesses settled reload consistency,
  // not cache-admitted first paint. The actual cache-warm E2E is separate.
  await page.reload();await page.waitForFunction(()=>window.fixtureReady&&window.currentFontAdmission?.().ready===true);await page.evaluate(()=>document.fonts.ready);receipts.warm=await measure('settled reload');
  for(let index=0;index<receipts.cold.length;index++){
   const cold=receipts.cold[index],loaded=receipts.loaded[index],warm=receipts.warm[index],label=`${cold.scale}% / ${cold.width}px`;
   expect(loaded.primary,`${label} primary fits permanent fallback`).toBeLessThanOrEqual(loaded.fallback+.1);
   expect(loaded.intrinsicPrimary,`${label} intrinsic primary fits reservation`).toBeLessThanOrEqual(Math.max(loaded.primary,loaded.fallback)+.1);
   expect(Math.max(cold.primary,cold.fallback),`${label} cold to loaded`).toBeCloseTo(Math.max(loaded.primary,loaded.fallback),5);
   expect(Math.max(warm.primary,warm.fallback),`${label} settled reload`).toBeCloseTo(Math.max(loaded.primary,loaded.fallback),5);
   const coldIntrinsic={width:cold.width,rows:cold.intrinsicRows};
   for(const [phase,sample]of [['cold',cold],['loaded',loaded],['settled reload',warm]]){
    const budget=checkRows(sample,coldIntrinsic,`${label} ${phase}`,browserName);
    expect(budgetPixelPrecision(Math.max(sample.primary,sample.fallback)),`${label} ${phase} source content maximum`).toBeLessThanOrEqual(budgetPixelPrecision(budget.contentMax));
   }
  }
 }finally{hold=false;release();const path=info.outputPath('font-boundary-admission.json');await writeFile(path,JSON.stringify(receipts,null,2));await info.attach('font-boundary-admission',{path,contentType:'application/json'});}
});


test('coordinate pills keep every board digit atomic and equal in both font families',async({page,browserName,publicationOwner})=>{
 await page.goto('/browser-integration/support/message-font-admission.html?scale=100');await page.waitForFunction(()=>window.fixtureReady&&window.currentFontAdmission?.().ready===true);await page.evaluate(()=>document.fonts.ready);
 for(const scale of [100,200]){
  const widths=await page.evaluate(async scale=>{
   document.documentElement.style.fontSize=`${scale}%`;
   const {renderCoordinateChip}=await import('/apps/web/board/coordinate-chip.js');
   const probe=document.createElement('div');probe.className='board-message-slot';probe.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden;pointer-events:none';
   for(const family of ['primary','fallback']){const paragraph=document.createElement('p');paragraph.className=`board-preview-label board-message-sizing${family==='fallback'?' board-message-fallback-sizing':''}`;paragraph.dataset.family=family;paragraph.innerHTML=Array.from({length:10},(_,digit)=>renderCoordinateChip({row:digit,col:digit})).join(' ');probe.append(paragraph);}
   document.body.append(probe);
   const result=[...probe.children].map(paragraph=>({family:paragraph.dataset.family,widths:[...paragraph.querySelectorAll('.board-preview-coordinate-chip')].map(chip=>chip.getBoundingClientRect().width),atomic:[...paragraph.querySelectorAll('.board-preview-coordinate-chip')].every(chip=>getComputedStyle(chip).whiteSpace==='nowrap')}));
   probe.remove();return result;
  },scale);
  expect(widths).toHaveLength(2);
  for(const family of widths){expect(family.widths).toHaveLength(10);expect(family.atomic).toBe(true);expect(Math.max(...family.widths)-Math.min(...family.widths),`${family.family} at ${scale}%`).toBeLessThanOrEqual(.1);}
 }
});
