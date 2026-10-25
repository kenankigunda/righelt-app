import {test,expect} from '@playwright/test';
for(const width of [320,390])test(`home card names, seat colors and compact presence survive ${width}px enlarged text`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await page.goto('/browser-integration/support/home-card-identity.html');await page.waitForFunction(()=>window.fixtureReady);
 const card=id=>page.locator(`[data-case="${id}"]`);
 await expect(card('computer-red').locator('.home-card-matchup')).toHaveText('You vs. Horus');
 for(const id of ['computer-red','computer-blue']){await expect(card(id).getByRole('img',{name:'Computer player'})).toHaveCount(1);await expect(card(id).locator('.is-disconnected')).toHaveCount(0);}
 for(const [id,side]of[['human-red','p1'],['computer-red','p1'],['human-blue','p2'],['computer-blue','p2']]){
  await expect(card(id).locator(`.player-tone-${side}`)).toHaveText('You');
  expect(await card(id).locator(`.player-tone-${side}`).evaluate(el=>getComputedStyle(el).color)).toBe(side==='p1'?'rgb(194, 69, 47)':'rgb(45, 103, 199)');
  await expect(card(id).getByRole('img')).toHaveCount(1);
 }
 await expect(card('waiting').locator('.home-card-matchup')).toHaveText('You vs. Open seat');await expect(card('waiting').getByRole('img',{name:'Open seat open to join'})).toHaveCount(1);await expect(card('guest').getByRole('img',{name:'Guest disconnected'})).toHaveCount(1);
 await expect(card('viewer').locator('.home-card-matchup')).toHaveText('Sam vs. Morgan');await expect(card('viewer').getByRole('img')).toHaveCount(2);await expect(card('self')).toContainText('You play both sides');await expect(card('self').getByRole('img')).toHaveCount(0);
 await page.screenshot({path:info.outputPath(`home-identities-${width}-100.png`)});
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 for(const item of await page.locator('.home-card-matchup').all()){
  const bounds=await item.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
 await card('computer-blue').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`home-identities-${width}-200.png`)});
 const link=card('computer-blue').getByRole('link');await link.focus();await expect(link).toBeFocused();await page.keyboard.press('Enter');await expect(page).toHaveURL(/#computer-blue$/);expect(await page.locator('.home-card-matchup [tabindex],.home-card-matchup button,.home-card-matchup a').count()).toBe(0);
});
