import {expect,test} from '@playwright/test';
import {closeContextQuietly,createGameFromHome} from '../support/app.mjs';

test('real game shell refreshes the browser title and visible start identity together after a timezone change',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
 try{
  const cdp=await context.newCDPSession(page);
  await createGameFromHome(page);
  const inlay=page.locator('.game-date-inlay:visible').first();
  await expect(inlay).toBeVisible();
  const before={title:await page.title(),label:await inlay.getAttribute('aria-label')};

  await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Tokyo'});
  const away=await context.newPage();await away.bringToFront();await page.bringToFront();await away.close();
  await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});

  await expect.poll(()=>page.title(),{message:'Expected the real focus listener to republish the title in the new viewer timezone'}).not.toBe(before.title);
  await expect.poll(()=>inlay.getAttribute('aria-label'),{message:'Expected the mounted game date to refresh with the title'}).not.toBe(before.label);
  const after={title:await page.title(),label:await inlay.getAttribute('aria-label')};
  expect(after.title).toMatch(/^vs\. .+ \| [A-Z][a-z]{2} \d{1,2} (late night|early morning|mid morning|noon|afternoon|evening|night) \| Righelt$/);
  expect(after.label).toMatch(/^Started .+, (late night|early morning|mid morning|noon|afternoon|evening|night)$/);
 }finally{await closeContextQuietly(context);}
});
