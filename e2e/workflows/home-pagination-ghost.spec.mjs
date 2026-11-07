import {test,expect} from '@playwright/test';
import {createGamesViaApi,createIsolatedPage,closeContextQuietly} from '../support/app.mjs';

test('Ghost pagination shares slow feedback and preserves failure retry, keyboard and wraparound',async({browser},info)=>{
 const {context,page}=await createIsolatedPage(browser);
 try{
  await createGamesViaApi(page,9);await page.setViewportSize({width:390,height:1100});await page.goto('/');
  const section=page.locator('[data-home-section-root="my"]'),row=section.locator('.home-games-section-controls:visible');
  const next=row.locator('[data-action="home-page-next"]'),previous=row.locator('[data-action="home-page-prev"]');
  await expect(row).toContainText('Page 1 of 3');await expect(next).toBeEnabled();await row.scrollIntoViewIfNeeded();
  const bounds=()=>row.evaluate(row=>[...row.children].map(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const idle=await bounds();expect(idle).toHaveLength(3);for(const index of [0,2]){expect(idle[index].width).toBeGreaterThanOrEqual(44);expect(idle[index].height).toBeGreaterThanOrEqual(44);}
  let release,held=0,primaryFailure=null;const gate=new Promise(resolve=>{release=resolve;});const jobs=[],routeFailures=[];
  const pattern=/\/api\/shell\/games\?/;
  // The existing per-request deadline is also 5s. Exercise a genuinely slow
  // two-page operation with each request still inside that unchanged deadline.
  const failPage=route=>{const job=(async()=>{
   const url=new URL(route.request().url());
   try{if(url.searchParams.get('section')==='my'&&url.searchParams.get('page')!=='0'){
    held++;if(held===1){await new Promise(resolve=>setTimeout(resolve,3000));await route.continue();}
    else{await gate;await route.abort();}
   }else await route.continue();}catch(error){routeFailures.push(String(error));}
  })();jobs.push(job);return job;};
  await page.route(pattern,failPage);
  try{
   await previous.focus();await page.keyboard.press('Enter');await expect.poll(()=>held).toBeGreaterThanOrEqual(2);
   await expect(next).toBeDisabled();await expect(previous).toBeDisabled();
   await expect(next).toHaveAttribute('data-loading-phase','slow');
   await expect(section.locator(':scope > .loading-context[role="status"]')).toHaveCount(1);
   await expect(row.locator('.loading-context')).toHaveCount(0);expect(await bounds()).toEqual(idle);
   await section.screenshot({path:info.outputPath('ghost-slow-shared.png')});
  }catch(error){primaryFailure=error;await info.attach('pager-at-failure',{body:JSON.stringify(await section.evaluate(section=>({html:section.outerHTML,scrollY}))),contentType:'application/json'});}
  finally{release();await Promise.all(jobs);await page.unroute(pattern,failPage);}
  if(primaryFailure)throw primaryFailure;
  expect(routeFailures).toEqual([]);
  await expect(next).toBeEnabled();await expect(previous).toBeEnabled();await expect(row).toContainText('Page 1 of 3');
  await expect(section.locator('.loading-context')).toHaveCount(0);await expect(section.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
  await next.focus();await page.keyboard.press('Space');await expect(row).toContainText('Page 2 of 3');await expect(next).toBeEnabled();
  await previous.click();await expect(row).toContainText('Page 1 of 3');await expect(previous).toBeEnabled();
  await previous.click();await expect(row).toContainText('Page 3 of 3');await expect(next).toBeEnabled();
  await next.click();await expect(row).toContainText('Page 1 of 3');await expect(next).toBeEnabled();
  await row.screenshot({path:info.outputPath('ghost-wraparound-idle.png')});
 }finally{await closeContextQuietly(context);}
});
