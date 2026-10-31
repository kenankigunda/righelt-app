import {test,expect} from '@playwright/test';
import {createGamesViaApi} from '../support/app.mjs';

test('Home self-play stays centered below opponent choices at narrow widths and zoom',async({page},info)=>{
 await createGamesViaApi(page,10);
 await page.goto('/');await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);
 const section=page.locator('.home-start'),action=section.locator('button[data-action="create-self-play"]');
 await expect(section).not.toContainText('Choose your opponent');
 await expect(action).toHaveAccessibleName('Play both sides');
 for(const width of [320,390,736,1024])for(const zoom of [1,2]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(value=>document.documentElement.style.zoom=String(value),zoom);
  let measured;
  try{await expect.poll(async()=>section.evaluate(el=>{
   const button=el.querySelector('[data-action="create-self-play"]').getBoundingClientRect(),footer=el.querySelector('.home-start-footer').getBoundingClientRect(),choices=el.querySelector('.opponent-picker').getBoundingClientRect();
   return {centerDelta:Math.abs((button.left+button.right-footer.left-footer.right)/2),buttonTop:button.top,choicesBottom:choices.bottom,buttonHeight:button.height,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  }).then(value=>{measured=value;return value.centerDelta<=1&&value.buttonTop>=value.choicesBottom&&value.buttonHeight>=44&&value.scrollWidth<=value.viewport;})).toBe(true);}
  finally{await info.attach(`footer-geometry-${width}-${zoom}`,{body:JSON.stringify({width,zoom,...measured}),contentType:'application/json'});
   if(measured?.scrollWidth>measured?.viewport)await info.attach('footer-document-overflow',{body:JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,class:el.className,left:r.left,right:r.right,width:r.width,text:el.matches('button,.home-games-section-page-label')?el.textContent:null};}).filter(r=>r.right>innerWidth||r.left<0).slice(0,40))),contentType:'application/json'});
  }
 }
 await page.evaluate(()=>document.documentElement.style.zoom='');
 await page.setViewportSize({width:1024,height:900});
 await action.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('home-self-play-centered-desktop.png')});
 await page.setViewportSize({width:390,height:900});await action.focus();await expect(action).toBeFocused();await action.scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('home-self-play-centered-mobile.png')});
 await page.keyboard.press('Enter');await expect(page.getByTestId('game-shell')).toBeVisible();
});
