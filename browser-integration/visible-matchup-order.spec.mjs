import {test,expect} from '@playwright/test';

for(const width of [390,1440])test(`visible role order survives ordinary title consumers and wrapping at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 await page.goto('/browser-integration/support/visible-matchup-order.html');
 await page.waitForFunction(()=>window.fixtureReady);
 for(const scale of [100,200])for(const computer of [false,true]){
  await page.evaluate(options=>window.renderMatchup(options),{computer,longName:!computer&&scale===200,scale});
  for(const id of ['home','summary','result']){
   const title=page.locator(`#${id} .game-title-matchup`),players=title.locator('.game-title-player');
   await expect(players).toHaveCount(2);
   expect(await players.evaluateAll(nodes=>nodes.map(node=>node.classList.contains('player-tone-p1')?'p1':'p2'))).toEqual(['p1','p2']);
   await expect(players.nth(1).locator(':scope > bdi')).toHaveText('You');
   if(computer)await expect(players.nth(0).locator(':scope > bdi')).toHaveText('Babs');
   const geometry=await players.evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect(),name=node.querySelector(':scope > bdi').getBoundingClientRect();return{left:box.left,right:box.right,nameLeft:name.left,nameRight:name.right,color:getComputedStyle(node).color,marks:node.querySelectorAll('.player-emblem').length};}));
   expect(geometry.map(value=>value.color)).toEqual(['rgb(194, 69, 47)','rgb(45, 103, 199)']);
   expect(geometry.map(value=>value.marks)).toEqual([1,1]);
   for(const value of geometry){expect(value.left).toBeGreaterThanOrEqual(0);expect(value.right).toBeLessThanOrEqual(width+1);expect(value.nameLeft).toBeGreaterThanOrEqual(value.left-1);expect(value.nameRight).toBeLessThanOrEqual(value.right+1);}
  }
  await expect(page.locator('#home .connection-status-icon')).toHaveCount(1);
  await expect(page.locator('#summary .connection-status-icon,#result .connection-status-icon')).toHaveCount(0);
  expect(await page.evaluate(()=>window.matchupInputUnchanged)).toBe(true);
  if(computer)await expect(page).toHaveTitle('vs. Babs | Nov 17 evening | Righelt');
  if(computer&&((width===1440&&scale===100)||(width===390&&scale===200)))await page.screenshot({path:info.outputPath(`role-order-${width}-${scale}-original.png`),fullPage:true});
 }
});
