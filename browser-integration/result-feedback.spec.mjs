import{test,expect}from'@playwright/test';
const open=async page=>{await page.goto('/browser-integration/support/result-feedback.html');await page.waitForFunction(()=>window.fixtureReady);};
for(const width of [320,390,1440])test(`result perspectives remain readable and actions reachable at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await open(page);
 for(const [side,tone]of[['red','victory'],['blue','defeat'],['viewer','neutral']]){
  await page.evaluate(side=>window.resultFixture.setup(side),side);await page.getByRole('button',{name:'Finish live game',exact:true}).click();
  const result=page.locator('.game-result');await expect(result).toHaveAttribute('data-result-tone',tone);
  await expect(result.getByRole('heading',{name:side==='red'?'You won':side==='blue'?'Your opponent won':'Player 1 wins',exact:true})).toBeVisible();await expect(result).toContainText(side==='red'?'Your opponent’s commander was destroyed':side==='blue'?'Your commander was destroyed':'Player 2’s commander was destroyed');
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.querySelector('.game-result').getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
  expect(await result.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
  for(const action of await result.locator('button,a').all()){await action.scrollIntoViewIfNeeded();await expect(action).toBeInViewport({ratio:1});expect(await action.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);}
  await result.screenshot({path:info.outputPath(`result-${tone}-${width}.png`)});
 }
});
test('animation timeline survives repaint and history, hydration, spectator and reduced motion stay quiet',async({page},info)=>{
 await open(page);await page.getByRole('button',{name:'Finish live game',exact:true}).click();
 const motion=await page.locator('.result-mark').evaluate(el=>{const animation=el.getAnimations()[0];animation.pause();animation.currentTime=300;return{duration:animation.effect.getTiming().duration,count:document.querySelectorAll('[data-result-fragment]').length};});expect(motion).toEqual({duration:1000,count:4});
 await page.locator('.game-result').evaluate(el=>el.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=300;}));
 await page.locator('.game-result').screenshot({path:info.outputPath('result-victory-midpoint.png')});
 await page.evaluate(()=>window.resultFixture.repaint());const current=await page.locator('.result-mark').evaluate(el=>el.getAnimations()[0]?.currentTime);expect(current).toBeGreaterThan(0);
 for(const [side,status,history]of[['red','p1_win',false],['red','ongoing',true],['viewer','ongoing',false]]){
  await page.evaluate(([side,status,history])=>{window.resultFixture.setup(side,status,history);if(status==='ongoing')window.resultFixture.finish(history);},[side,status,history]);
  expect(await page.locator('.game-result').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.resultFixture.setup('red');window.resultFixture.finish();});
 expect(await page.locator('.game-result').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
 await page.locator('.game-result').screenshot({path:info.outputPath('result-reduced-motion.png')});
 await expect(page.locator('.result-mark svg')).toHaveAttribute('aria-hidden','true');await expect(page.getByRole('heading',{name:'You won',exact:true})).toBeVisible();
});
