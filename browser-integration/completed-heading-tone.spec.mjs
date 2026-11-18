import{test,expect}from'@playwright/test';
for(const width of[390,1440])test(`completed heading keeps only winner phrase colored at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:600});await page.goto('/browser-integration/support/completed-heading-tone.html');await page.waitForFunction(()=>window.fixtureReady);
 const variants=[{status:'p1_win',identityId:'red',name:'You won',color:'rgb(194, 69, 47)'},{status:'p2_win',identityId:'red',name:'Ada won',color:'rgb(45, 103, 199)'},{status:'p1_win',identityId:'viewer',name:'Maya won',color:'rgb(194, 69, 47)'},{status:'draw',identityId:'red',name:'Draw',color:'rgb(37, 43, 45)'},{status:'p2_win',self:true,name:'You won',color:'rgb(45, 103, 199)'},{status:'p1_win',identityId:'viewer',long:true,name:'שלום <&> on Turn99 Verylongparticipantnamewithoutbreaks won',color:'rgb(194, 69, 47)'}];
 for(const scale of[100,200])for(const variant of variants){
  await page.evaluate(options=>window.showHeading(options),{...variant,scale});const heading=page.locator('#shell-board-turn-indicator'),name=heading.locator('.board-turn-name'),suffix=heading.locator(':scope > span:last-child');
  await expect(heading).toHaveText(variant.name+' on Turn 5');await expect(name).toHaveText(variant.name);await expect(name).toHaveAttribute('title',variant.name);await expect(name).toHaveAttribute('dir','auto');await expect(suffix).toHaveText(' on Turn 5');
  expect(await name.evaluate(n=>getComputedStyle(n).color)).toBe(variant.color);expect(await suffix.evaluate(n=>getComputedStyle(n).color)).toBe('rgb(37, 43, 45)');
  const boxes=await heading.evaluate(n=>[n,...n.children].map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,height:r.height};}));for(const box of boxes){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width+1);}expect(Math.abs(boxes[1].top-boxes[2].top)).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>window.inputUnchanged)).toBe(true);await expect(page.locator('img')).toHaveCount(0);
  if((width===1440&&scale===100&&variant.name==='Ada won')||(width===390&&scale===200&&variant.long))await heading.screenshot({path:info.outputPath(`heading-${width}-${scale}-original.png`)});
 }
 await page.evaluate(()=>window.showOrdinary());await expect(page.locator('#shell-board-turn-indicator')).toHaveText('Move 17');await expect(page.locator('.board-turn-name')).toHaveCount(0);expect(await page.locator('#shell-board-turn-indicator').evaluate(n=>getComputedStyle(n).color)).toBe('rgb(45, 103, 199)');
});
