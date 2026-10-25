import {test,expect} from '@playwright/test';
test.use({viewport:{width:390,height:740},isMobile:true,hasTouch:true});
const geometry=page=>page.locator('#board').evaluate(el=>{const rect=el.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};});

test('compact Pass accepts actual touches at both ends of its 44px hit area without moving the board',async({page},info)=>{
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(()=>window.boardFixture.setup('pass',false));
  const pass=page.getByRole('button',{name:'Pass',exact:true});
  await expect(pass).toBeVisible();
  const visual=await pass.boundingBox(),before=await geometry(page);
  expect(visual.width).toBeGreaterThanOrEqual(44);
  expect(visual.height).toBeLessThan(40);
  for(const [index,offset]of[-20,20].entries()){
    const current=await pass.boundingBox(),x=current.x+current.width/2,y=current.y+current.height/2+offset;
    expect(y<current.y||y>current.y+current.height,'The touch must be outside the compact visible button').toBe(true);
    expect(await pass.evaluate((button,{x,y})=>document.elementFromPoint(x,y)?.closest('button')===button,{x,y})).toBe(true);
    await page.touchscreen.tap(x,y);
    await expect.poll(()=>page.evaluate(()=>window.boardFixture.applied())).toEqual(Array.from({length:index+1},()=>({type:'pass'})));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(await geometry(page)).toEqual(before);
    expect(await pass.boundingBox()).toEqual(visual);
  }
  await page.screenshot({path:info.outputPath('compact-pass-expanded-touch.png')});
});
