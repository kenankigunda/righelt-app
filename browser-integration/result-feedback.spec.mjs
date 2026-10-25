import{test,expect}from'@playwright/test';
const open=async page=>{await page.goto('/browser-integration/support/result-feedback.html');await page.waitForFunction(()=>window.fixtureReady);};
const contrast=(a,b)=>{
 const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(value=>{const n=Number(value)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,index)=>sum+n*[.2126,.7152,.0722][index],0);
 const [light,dark]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return(light+.05)/(dark+.05);
};
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

for(const width of [320,390])test(`200% result text enlarges its heading and keeps all actions reachable at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await open(page);
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 for(const side of ['red','blue','viewer']){
  await page.evaluate(side=>window.resultFixture.setup(side,'p1_win'),side);
  const result=page.locator('.game-result'),heading=result.getByRole('heading');
  await expect(heading).toHaveText(side==='red'?'You won':side==='blue'?'Your opponent won':'Player 1 wins');
  expect(await heading.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(56);
  if(side==='blue')expect(await heading.evaluate(el=>{const start=el.firstChild.textContent.indexOf('opponent'),range=document.createRange();range.setStart(el.firstChild,start);range.setEnd(el.firstChild,start+8);return range.getClientRects().length;})).toBe(1);
  expect(await result.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  for(const action of await result.locator('button,a').all()){
   await action.scrollIntoViewIfNeeded();
   // Scroll positions round to physical pixels. Check all four edges with the
   // same one-pixel geometry allowance as the board, rather than an exact IO ratio.
   await expect.poll(()=>action.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=-1&&r.left>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})).toBe(true);
   expect(await action.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  }
  await result.screenshot({path:info.outputPath(`result-enlarged-${side}-${width}.png`)});
 }
});

test('red and blue winners keep their actual side color throughout the victory animation and actions',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await open(page);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>document.documentElement.dataset.hoverCapability='hover');
 for(const [identity,winner]of[['red','p1'],['blue','p2']]){
  await page.evaluate(([identity,winner])=>{window.resultFixture.setup(identity);window.resultFixture.finish(false,`${winner}_win`);},[identity,winner]);
  const result=page.locator('.game-result');await expect(result).toHaveAttribute('data-result-tone','victory');await expect(result).toHaveAttribute('data-winner',winner);
  await expect(result.getByRole('heading',{name:'You won',exact:true})).toBeVisible();
  const colors=await result.evaluate((el,{winner,identity})=>{
   const resolve=token=>{const probe=document.createElement('i');probe.style.color=token;el.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;};
   const expected=resolve(`var(--player-${winner})`),hover=resolve(`var(--player-${identity}-hover)`),paper=resolve('var(--paper)');
   const mark=el.querySelector('.result-mark'),animations=mark.getAnimations({subtree:true});animations.forEach(animation=>animation.pause());
   const samples=[0,300,900].map(time=>{animations.forEach(animation=>animation.currentTime=time);return{color:getComputedStyle(mark).color,stone:getComputedStyle(mark.querySelector('.result-stone')).fill,fragments:[...mark.querySelectorAll('.result-fragment')].map(fragment=>getComputedStyle(fragment).fill)};});
   animations.forEach(animation=>animation.currentTime=300);return{expected,hover,paper,samples,count:animations.length};
  },{winner,identity});
  expect(colors.count).toBeGreaterThan(0);for(const sample of colors.samples){expect(sample.color).toBe(colors.expected);expect(sample.stone).toBe(colors.expected);expect(sample.fragments).toHaveLength(4);expect(sample.fragments.every(color=>color===colors.expected)).toBe(true);}
  for(const name of ['Review game','Play again']){
   const action=result.getByRole('button',{name,exact:true});await page.mouse.move(0,0);
   await expect.poll(()=>action.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(colors.expected);
   expect(contrast(await action.evaluate(el=>getComputedStyle(el).color),colors.expected)).toBeGreaterThanOrEqual(4.5);
   await action.evaluate(el=>el.blur());
   // Safari's native full-control navigation is Option-Tab.
   for(let step=0;step<8 && !(await action.evaluate(el=>el===document.activeElement));step++)await page.keyboard.press(info.project.name==='webkit'?'Alt+Tab':'Tab');
   await expect(action).toBeFocused();
   const outline=await action.evaluate(el=>({width:parseFloat(getComputedStyle(el).outlineWidth),style:getComputedStyle(el).outlineStyle,color:getComputedStyle(el).outlineColor}));
   expect(outline.width).toBeGreaterThanOrEqual(2);expect(outline.style).not.toBe('none');expect(contrast(outline.color,colors.paper)).toBeGreaterThanOrEqual(3);
   await action.hover();await expect.poll(()=>action.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(colors.hover);
   expect(contrast(await action.evaluate(el=>getComputedStyle(el).color),colors.hover)).toBeGreaterThanOrEqual(4.5);
  }
  await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur());
  await expect.poll(()=>result.getByRole('button',{name:'Play again',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(colors.expected);
  await result.screenshot({path:info.outputPath(`victory-${identity}-midpoint.png`)});
  await result.getByRole('button',{name:'Play again',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Play again',exact:true}),opposite=winner==='p1'?'blue':'red';await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-action-affiliation',opposite);
  await expect(dialog.getByRole('radio',{name:opposite==='blue'?'Player 2 · Blue':'Player 1 · Red',exact:true})).toBeChecked();
  const expected=await dialog.evaluate((el,opposite)=>{const probe=document.createElement('i');probe.style.color=`var(--player-${opposite})`;el.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;},opposite);
  await expect.poll(()=>dialog.getByRole('button',{name:'Start game',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(expected);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeHidden();
  await expect(page.locator('.overlay-exit-copy')).toHaveCount(0);
 }
 await page.evaluate(()=>window.resultFixture.setup('red','p2_win'));
 await expect(page.locator('.game-result')).toHaveAttribute('data-result-tone','defeat');
 await expect(page.getByRole('button',{name:'Play again',exact:true})).toHaveClass('secondary');
 expect(await page.getByRole('button',{name:'Play again',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
