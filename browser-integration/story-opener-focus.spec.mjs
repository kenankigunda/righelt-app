import {test,expect} from '@playwright/test';

for(const width of [390,1440])test(`story dismissal restores the available Home opener at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/browser-integration/support/story-opener-focus.html');
 await page.waitForFunction(()=>window.fixtureReady);
 const friend=page.getByRole('button',{name:'Friend',exact:true}),dialog=page.getByRole('dialog',{name:'Friend',exact:true});
 // Connected trigger first, then the real failure boundary: Home replaces it
 // while the native dialog remains open. Neither dismissal may start a game.
 await friend.focus();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('heading')).toHaveText('A rivalry of your own');
 await expect(dialog.getByRole('button',{name:'Start a friend game'})).toBeEnabled();
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(friend).toBeFocused();
 for(const close of ['Escape','Close']){
  await friend.click();await expect(dialog).toBeVisible();
  await page.evaluate(()=>window.storyFocusFixture.render());
  if(close==='Escape')await page.keyboard.press('Escape');else await dialog.getByRole('button',{name:'Close opponent story'}).click();
  await expect(dialog).toBeHidden();await expect(friend).toBeFocused();
 }
 if(width===390)await page.screenshot({path:testInfo.outputPath('friend-focus-after-remount-390.png')});
 // The preexisting computer resolver and missing-target fallback stay intact.
 const babs=page.getByRole('button',{name:'Babs',exact:true});await babs.click();
 await page.evaluate(()=>window.storyFocusFixture.render());await page.keyboard.press('Escape');await expect(babs).toBeFocused();
 await friend.click();await page.evaluate(()=>document.querySelector('#choices').replaceChildren());
 await page.keyboard.press('Escape');await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>window.storyFocusFixture.starts)).toBe(0);
 expect(await page.evaluate(()=>document.querySelectorAll('dialog[open]').length)).toBe(0);
});
