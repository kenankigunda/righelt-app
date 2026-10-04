import {chromium} from '@playwright/test';
import {capture,canCaptureFullPage} from '../capture.mjs';
import {visualPolicy} from '../visual-policy.mjs';
import {proof} from '../proof.mjs';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {hash} from '../model.mjs';
const captureEvidence=visualPolicy().mode!=='none';
const evidence=[];import {renderReport} from '../report.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'righelt-report-test-'));
const run={id:'browser-test',startedAt:'2026-01-01',stages:[{id:'s',title:'Example merge point',status:'failed',items:[{id:'a',title:'Review game creation',status:'failed',revision:'v1',assertions:['Visible board'],images:[{src:'images/viewer.png',caption:'Viewer test image'}]},{id:'b',title:'Review reconnect',status:'passed',revision:'v1',images:[]}]}]};
await renderReport(run,dir);const server=createServer(async(req,res)=>{try{const file=path.join(dir,new URL(req.url,'http://localhost').pathname.replace(/^\//,'')||'index.html');const body=await readFile(file);res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(body);}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;const browser=await chromium.launch();const imagePage=await browser.newPage({viewport:{width:1200,height:900}});await imagePage.setContent('<main style="height:850px;background:linear-gradient(#bcd,#345);padding:20px"><h1>Image viewer interaction fixture</h1></main>');await mkdir(path.join(dir,'images'));await imagePage.screenshot({path:path.join(dir,'images/viewer.png')});await imagePage.close();
async function verifyBottomComplete(page, viewport){
 const first=page.locator('.item').first(),second=page.locator('.item').nth(1);
 const automated=await page.locator('#report-data').textContent();
 for(const status of ['Not started','In progress','Skipped','Needs revisit']){
  await page.evaluate(status=>localStorage.setItem('righelt-validation:browser-test',JSON.stringify({version:1,namespace:'righelt-validation:browser-test',records:{'s:a':{status:status==='Needs revisit'?'Complete':status,revision:status==='Needs revisit'?'old':'v1',notes:'Keep footer note',updatedAt:'2026-01-01',history:[{revision:'old',at:'2026-01-01'}]}},expanded:{'s:a':true,'s:b':true}})),status);
  await page.reload();assert.equal(await first.getAttribute('data-review'),status);
  await first.locator('.gallery').evaluate(e=>e.style.minHeight='2000px');await second.locator('.details').evaluate(e=>e.style.minHeight='1200px');
  const bottom=first.locator('.completion-footer button');
  assert.equal(await bottom.count(),1);assert.match(await bottom.innerText(),/Complete/);
  assert.equal(await first.locator('.actions').getByRole('button',{name:'Complete: Review game creation',exact:true}).count(),1);
  await bottom.scrollIntoViewIfNeeded();const box=await bottom.boundingBox();const notesBox=await first.getByRole('textbox').boundingBox();assert(box.y>=notesBox.y+notesBox.height);
  assert(box.y>=0&&box.y+box.height<=viewport.height);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(status==='In progress'&&process.env.RIGHELT_EVIDENCE_DIR&&captureEvidence){const images=await proof(page,{project:{name:viewport.width===390?'mobile':viewport.width===1366?'mid-wide':'full-wide',use:{hasTouch:viewport.width===390}},attach:async()=>{}},'bottom-complete',first.locator('.completion-footer'));evidence.push({id:`bottom-complete-${viewport.width}`,title:'Complete a review from the bottom',viewport:String(viewport.width),status:'passed',assertions:['Fully labeled bottom action after notes and history; same completion transition as the header; notes and history preserved; keyboard focus restored; unrelated sections stay open.'],images,revision:hash(images.map(i=>i.digest))});}
  await bottom.focus();await page.keyboard.press(status==='Skipped'?'Space':'Enter');
  assert.equal(await first.getAttribute('data-review'),'Complete');assert.equal(await first.getAttribute('data-expanded'),'false');assert.equal(await first.locator('.actions button').evaluate(e=>e===document.activeElement),true);assert.equal(await second.getAttribute('data-expanded'),'true');
  await page.waitForFunction(()=>{const a=document.querySelector('.item'),b=a.nextElementSibling;return a.getBoundingClientRect().bottom>0&&a.getBoundingClientRect().bottom<=201&&b.getBoundingClientRect().top<innerHeight;});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const focusBox=await page.locator(':focus').boundingBox();assert(focusBox.y>=0&&focusBox.y+focusBox.height<=viewport.height);const completedBox=await first.boundingBox();assert(completedBox.y+completedBox.height>0&&completedBox.y+completedBox.height<=201);
  if(status==='In progress'&&process.env.RIGHELT_EVIDENCE_DIR&&captureEvidence){const images=await proof(page,{project:{name:viewport.width===390?'mobile':viewport.width===1366?'mid-wide':'full-wide',use:{hasTouch:viewport.width===390}},attach:async()=>{}},'after-bottom-complete',first.locator('.item-summary'));evidence.push({id:`after-bottom-complete-${viewport.width}`,title:'Continue downward after completing',viewport:String(viewport.width),status:'passed',assertions:['After collapsing a long section, its bottom remains visible and the next card is in view.'],images,revision:hash(images.map(i=>i.digest))});}
  await first.locator('.disclosure').click();assert.equal(await bottom.count(),0);
  await page.reload();assert.equal(await first.getByRole('textbox').inputValue(),'Keep footer note');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('righelt-validation:browser-test')));assert(saved.records['s:a'].history.some(h=>h.revision==='old'));assert(saved.records['s:a'].history.some(h=>h.revision==='v1'));assert.equal(await page.locator('#report-data').textContent(),automated);
 }
 await first.locator('.actions').getByRole('button',{name:'Reopen: Review game creation',exact:true}).click();await page.locator('#filter').selectOption('In progress');await first.locator('.completion-footer button').click();assert.equal(await first.isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'filter');
 await page.evaluate(()=>localStorage.removeItem('righelt-validation:browser-test'));await page.reload();
}
try{
 const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const touchPage=await touchContext.newPage();await touchPage.setContent('<meta name="viewport" content="width=device-width"><style>body{margin:0}main{height:1600px;background:rgb(0,128,0)}@media(any-hover:hover){main{background:rgb(255,0,0)}}</style><main>Oversized capture regression</main>');
 for(const [target,options] of [[touchPage,{fullPage:true}]]){const pixels=await capture(touchPage,target,options);assert.deepEqual(await touchPage.evaluate(async encoded=>{const i=new Image();i.src=`data:image/png;base64,${encoded}`;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return [10,900,1500].map(y=>[...ctx.getImageData(300,y,1,1).data]);},pixels.toString('base64')),[[0,128,0,255],[0,128,0,255],[0,128,0,255]]);assert.deepEqual(await touchPage.evaluate(()=>({touch:navigator.maxTouchPoints,hover:matchMedia('(any-hover: hover)').matches,width:innerWidth,height:innerHeight})),{touch:1,hover:false,width:390,height:844});}
 await touchPage.setContent('<meta name="viewport" content="width=device-width"><style>body{margin:0;height:900px;background:red}aside{position:fixed;left:20px;top:740px;width:300px;height:90px;background:rgb(0,128,0)}</style><aside></aside>');
 const fixedPixels=await capture(touchPage,touchPage.locator('aside'));
 assert.deepEqual(await touchPage.evaluate(async encoded=>{const i=new Image();i.src=`data:image/png;base64,${encoded}`;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return [2,45,87].map(y=>[...ctx.getImageData(150,y,1,1).data]);},fixedPixels.toString('base64')),[[0,128,0,255],[0,128,0,255],[0,128,0,255]]);
 assert.equal(await touchPage.evaluate(()=>scrollY),0);

 assert.equal(await canCaptureFullPage(touchPage),false);
 await assert.rejects(()=>capture(touchPage,touchPage,{fullPage:true}),/unsafe/);
 for(const position of ['fixed','sticky']){
  await touchPage.setContent(`<meta name="viewport" content="width=device-width"><style>body{margin:0;height:1800px;background:red}aside{position:${position};top:0;overflow:hidden;width:300px;height:120px}main{height:600px;background:rgb(0,128,0)}</style><aside><main></main></aside><section>Following content must never appear in component proof</section>`);
  assert.equal(await canCaptureFullPage(touchPage),false);
  const clipped=await capture(touchPage,touchPage.locator('main'));
  assert.deepEqual(await touchPage.evaluate(async encoded=>{const i=new Image();i.src=`data:image/png;base64,${encoded}`;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return {width:i.width,height:i.height,bottom:[...ctx.getImageData(100,i.height-1,1,1).data]};},clipped.toString('base64')),{width:300,height:120,bottom:[0,128,0,255]});
  assert.equal(await touchPage.evaluate(()=>scrollY),0);
 }

 await assert.rejects(()=>capture(touchPage,touchPage.locator('main'),{clip:{x:1,y:1,width:10,height:10}}),/without caller clip/);
 await assert.rejects(()=>capture(touchPage,touchPage.locator('main'),{type:'jpeg'}),/PNG/);
 const evidenceDirectory=process.env.RIGHELT_EVIDENCE_DIR;process.env.RIGHELT_EVIDENCE_DIR=path.join(dir,'capture-regression');
 try{const images=await proof(touchPage,{project:{name:'mobile',use:{hasTouch:true}},attach:async()=>{}},'sticky-clipped',touchPage.locator('main'));assert.equal(images.length,2);assert(images[1].caption.includes('visible area'));}finally{if(evidenceDirectory===undefined)delete process.env.RIGHELT_EVIDENCE_DIR;else process.env.RIGHELT_EVIDENCE_DIR=evidenceDirectory;}
 const desktop=await browser.newPage({viewport:{width:1366,height:900}});
 await desktop.setContent('<style>body{margin:0;height:2000px;background:red}aside{margin:20px;overflow:auto;width:300px;height:120px}main{height:600px;background:rgb(0,128,0)}</style><aside><main></main></aside>');
 const desktopCrop=await capture(desktop,desktop.locator('main'));
 assert.deepEqual(await desktop.evaluate(async encoded=>{const i=new Image();i.src=`data:image/png;base64,${encoded}`;await i.decode();return [i.width,i.height];},desktopCrop.toString('base64')),[300,120]);
 await desktop.locator('aside').evaluate(e=>e.scrollTop=200);
 const masked=await capture(desktop,desktop.locator('main'),{mask:[desktop.locator('main')],maskColor:'#00ff00'});
 assert.deepEqual(await desktop.evaluate(async encoded=>{const i=new Image();i.src=`data:image/png;base64,${encoded}`;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return [i.width,i.height,...ctx.getImageData(100,119,1,1).data];},masked.toString('base64')),[300,120,0,255,0,255]);
 await desktop.close();
 await touchContext.close();
 for(const viewport of [{width:390,height:844},{width:1366,height:900},{width:1920,height:1080}]){
 const context=await browser.newContext({viewport,hasTouch:viewport.width===390});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await verifyBottomComplete(page,viewport);const first=page.locator('.item').first();await first.getByRole('button',{name:'Start: Review game creation',exact:true}).first().click();assert.equal(await first.getAttribute('data-review'),'In progress');assert.equal(await first.getAttribute('data-expanded'),'true');await first.locator('.image-button').click();await page.locator('#actual').click();assert.equal(await page.locator('#full-image').evaluate(i=>i.style.width),'1200px');await page.locator('#plus').click();assert(Number.parseFloat(await page.locator('#full-image').evaluate(i=>i.style.width))>1200);await page.locator('#fit').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#viewer').evaluate(d=>d.open),false);await first.getByRole('textbox').fill('Keep this note');await first.locator('.completion-footer').getByRole('button',{name:'Complete: Review game creation',exact:true}).click();assert.equal(await first.getAttribute('data-expanded'),'false');await first.locator('.disclosure').click();assert.equal(await first.getAttribute('data-review'),'Complete');await page.reload();assert.equal(await first.getAttribute('data-expanded'),'true');assert.equal(await first.getByRole('textbox').inputValue(),'Keep this note');await first.getByRole('button',{name:'Reopen: Review game creation',exact:true}).click();await first.getByRole('button',{name:'Skip: Review game creation',exact:true}).click();assert.equal(await first.getAttribute('data-review'),'Skipped');await page.locator('#filter').selectOption('Skipped');assert.equal(await page.locator('.item:visible').count(),1);await first.getByRole('button',{name:'Start: Review game creation',exact:true}).first().click();assert.equal(await page.evaluate(()=>document.activeElement.id),'filter');await page.locator('#filter').selectOption('all');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);if(captureEvidence&&visualPolicy().mode==='legacy')await capture(page,page,{path:path.join(dir,`report-${viewport.width}.png`),fullPage:true});if(process.env.RIGHELT_EVIDENCE_DIR){const name=viewport.width===390?'mobile':viewport.width===1366?'mid-wide':'full-wide';const images=await proof(page,{project:{name,use:{hasTouch:viewport.width===390}},attach:async()=>{}},'report-controls',first);evidence.push({id:`report-${viewport.width}`,title:'Evidence report review controls',viewport:name,status:'passed',assertions:['Start, Complete, Reopen and Skip transitions; notes and expansion survive reload; filters preserve focus; no horizontal overflow.'],images,revision:hash(images.map(i=>i.digest))});}
 await context.close();
 }if(process.env.RIGHELT_EVIDENCE_JSON)await writeFile(process.env.RIGHELT_EVIDENCE_JSON+'.ui',JSON.stringify(evidence));console.log(`Report browser checks passed at all three sizes. Evidence: ${dir}`);
}finally{await browser.close();server.close();}

await import('./report-supplemental.mjs');
