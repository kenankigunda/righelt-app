import {test,expect} from '@playwright/test';
import {createIsolatedPage,closeContextQuietly} from '../support/app.mjs';
import {installUxMetricsCollector,readUxMetrics} from '../support/ux.mjs';

test('shell styles are loaded before the first visible app render',async({browser})=>{
 const {context,page}=await createIsolatedPage(browser);
 try{
  await page.addInitScript(()=>{
   window.__unstyledRenders=[];
   new MutationObserver(()=>{const app=document.getElementById('app');if(app&&!app.hidden&&app.childElementCount&&!document.getElementById('shell-stylesheet')?.sheet)window.__unstyledRenders.push(app.textContent.slice(0,80));}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  });
  await context.route('**/shell/shell.css',async route=>{const response=await route.fetch();await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({response});});
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(()=>window.__unstyledRenders)).toEqual([]);
 }finally{await closeContextQuietly(context);}
});

test('UX metrics observe an already loaded page and survive navigation',async({page})=>{
 await page.goto('/');await installUxMetricsCollector(page);
 await page.evaluate(()=>performance.measure('validation-current-page',{start:0,end:1}));
 await expect.poll(async()=>(await readUxMetrics(page)).measures.some(m=>m.name==='validation-current-page')).toBe(true);
 await page.reload();await page.evaluate(()=>performance.measure('validation-reloaded-page',{start:0,end:1}));
 await expect.poll(async()=>(await readUxMetrics(page)).measures.some(m=>m.name==='validation-reloaded-page')).toBe(true);
});
