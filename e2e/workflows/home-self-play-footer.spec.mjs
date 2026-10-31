import {test,expect} from '@playwright/test';

test('Home self-play stays centered below opponent choices at narrow widths and zoom',async({page},info)=>{
 await page.goto('/');await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);
 const section=page.locator('.home-start'),action=section.locator('button[data-action="create-self-play"]');
 await expect(section).not.toContainText('Choose your opponent');
 await expect(action).toHaveAccessibleName('Play both sides');
 for(const width of [320,390,736,1024])for(const zoom of [1,2]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(value=>document.documentElement.style.zoom=String(value),zoom);
  await expect.poll(async()=>section.evaluate(el=>{
   const button=el.querySelector('[data-action="create-self-play"]').getBoundingClientRect(),footer=el.querySelector('.home-start-footer').getBoundingClientRect(),choices=el.querySelector('.opponent-picker').getBoundingClientRect();
   return Math.abs((button.left+button.right-footer.left-footer.right)/2)<=1&&button.top>=choices.bottom&&button.height>=44&&document.documentElement.scrollWidth<=innerWidth;
  })).toBe(true);
 }
 await page.evaluate(()=>document.documentElement.style.zoom='');
 await page.setViewportSize({width:390,height:900});await action.focus();await expect(action).toBeFocused();
 await page.screenshot({path:info.outputPath('home-self-play-centered-mobile.png')});
 await page.keyboard.press('Enter');await expect(page.getByTestId('game-shell')).toBeVisible();
});
