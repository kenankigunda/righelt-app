import {test,expect} from '@playwright/test';

const names=[['unbroken','W'.repeat(32)],['mixed','שלום<&>名字'.repeat(4).slice(0,32)]];
for(const [width,scale] of [[320,200],[390,200],[1440,100]])for(const [kind,name] of names)test(`actual named result remains reachable at ${width}px/${scale}% with ${kind} name`,async({page},info)=>{
 await page.setViewportSize({width,height:844});
 await page.goto('/browser-integration/support/named-result-layout.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(({name,scale})=>{document.documentElement.style.fontSize=`${scale}%`;window.namedResultFixture.render(name);},{name,scale});
 await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.fonts.check('700 56px Manrope'))).toBe(true);
 const result=page.getByTestId('game-result'),heading=result.getByRole('heading',{name:`Red: ${name} won`,exact:true});
 await expect(heading).toBeVisible();await expect(heading.locator('bdi')).toHaveText(name);await expect(heading.locator('bdi')).toHaveAttribute('dir','auto');
 await expect(result.locator('img')).toHaveCount(0);
 const geometry=await result.evaluate(element=>({documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,resultOverflow:element.scrollWidth-element.clientWidth,headingOverflow:element.querySelector('h1').scrollWidth-element.querySelector('h1').clientWidth,fontSize:parseFloat(getComputedStyle(element.querySelector('h1')).fontSize)}));
 await info.attach('named-result-geometry',{body:JSON.stringify({width,scale,kind,name,...geometry},null,2),contentType:'application/json'});
 expect(geometry.documentOverflow).toBeLessThanOrEqual(1);expect(geometry.resultOverflow).toBeLessThanOrEqual(1);expect(geometry.headingOverflow).toBeLessThanOrEqual(1);
 if(scale===200)expect(geometry.fontSize).toBeGreaterThanOrEqual(56);
 for(const action of await result.locator('button,a').all()){
  await action.scrollIntoViewIfNeeded();
  expect(await action.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.height>=44&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1&&element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})).toBe(true);
 }
 await result.screenshot({path:info.outputPath(`named-result-${width}-${scale}-${kind}.png`)});
});
