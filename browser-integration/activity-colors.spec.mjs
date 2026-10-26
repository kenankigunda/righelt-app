import {test,expect} from '@playwright/test';
for(const actor of ['P1','P2'])test(`${actor} owns thinking dots and notification pulse without restarting motion`,async({page},info)=>{
 await page.goto('/browser-integration/support/activity-colors.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(actor=>window.activityStep({actor}),actor);
 const cue=page.locator('.board-message-activity'),notice=page.locator('.shell-game-alert');
 await expect(cue).toHaveAttribute('data-loading-phase','visible');
 await expect(cue).toHaveAttribute('data-activity-side',actor);await expect(notice).toHaveAttribute('data-activity-side',actor);
 const color=await page.evaluate(actor=>window.activityExpected(actor),actor);
 expect(await cue.locator('i').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor))).toEqual([color,color,color]);
 // Detailed search progress was deliberately removed from the product notice.
 await expect(notice.locator('progress')).toHaveCount(0);
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 await expect(page.locator('.reconnect-background')).toBeHidden();
 const pulseColor=await page.evaluate(actor=>window.activityMixed(actor,12),actor);
 expect(await notice.evaluate(el=>getComputedStyle(el,'::after').backgroundColor)).toBe(pulseColor);
 const key=await cue.getAttribute('data-loading-key');
 await page.evaluate(()=>{window.cueNode=document.querySelector('.loading-pieces');window.cardNode=document.querySelector('.shell-game-alert');window.dotAnimation=window.cueNode.querySelector('i').getAnimations()[0];window.dotAnimation.pause();window.dotAnimation.currentTime=700;window.pulseAnimation=window.cardNode.getAnimations({subtree:true}).find(animation=>animation.animationName==='notification-processing');window.pulseAnimation.pause();window.pulseAnimation.currentTime=800;window.edgeNode=document.querySelector('.loading-edge-p1');window.edgeAnimation=window.edgeNode.getAnimations()[0];window.edgeAnimation.pause();window.edgeAnimation.currentTime=900;});
 for(const phase of ['checking','saving']){
  await page.evaluate(({actor,phase})=>window.activityStep({actor,phase}),{actor,phase});
  await expect(cue).toHaveAttribute('data-loading-key',key);await expect(cue).toHaveAttribute('data-activity-side',actor);await expect(notice).toHaveAttribute('data-activity-side',actor);
  expect(await page.evaluate(()=>({cue:window.cueNode===document.querySelector('.loading-pieces'),card:window.cardNode===document.querySelector('.shell-game-alert'),dot:window.dotAnimation.currentTime,pulse:window.pulseAnimation.currentTime,edge:window.edgeNode===document.querySelector('.loading-edge-p1'),edgeClock:window.edgeAnimation===window.edgeNode.getAnimations()[0],edgeTime:window.edgeAnimation.currentTime}))).toEqual({cue:true,card:true,dot:700,pulse:800,edge:true,edgeClock:true,edgeTime:900});
  expect(await cue.locator('i').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(color);
 }
 expect(await page.evaluate(()=>window.activityGame.board.state.sideToMove)).not.toBe(actor);
 await expect(page.locator('.board-wrap')).toHaveAttribute('data-activity-side',actor);
 for(const side of ['P1','P2'])expect(await page.locator(`.loading-edge-${side.toLowerCase()}`).evaluate(el=>getComputedStyle(el).stroke)).toBe(await page.evaluate(side=>window.activityExpected(side),side));
 await page.screenshot({path:info.outputPath(`activity-${actor}.png`)});
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await cue.locator('i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 expect(await notice.evaluate(el=>getComputedStyle(el,'::after').animationName)).toBe('none');
 for(const side of ['p1','p2'])await expect(page.locator(`.loading-edge-${side}`)).toHaveCSS('animation-name','none');
});
test('waiting pulse uses its explicit responding actor and unknown board loading keeps brand colors',async({page})=>{
 await page.goto('/browser-integration/support/activity-colors.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>window.activityStep({actor:'P2',mode:'waiting'}));
 const notice=page.locator('.shell-game-alert');await expect(notice).toHaveAttribute('data-activity-side','P2');
 expect(await notice.evaluate(el=>getComputedStyle(el,'::after').animationDuration)).toBe('4s');
 expect(await notice.evaluate(el=>getComputedStyle(el,'::after').backgroundColor)).toBe(await page.evaluate(()=>window.activityMixed('P2',8)));
 await page.evaluate(()=>window.activityStep({actor:'P2',phase:'saving',unknown:true}));
 await expect(page.locator('.board-wrap')).not.toHaveAttribute('data-activity-side');
 await expect(page.locator('.reconnect-background')).toBeHidden();
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 for(const side of ['P1','P2'])expect(await page.locator(`.loading-edge-${side.toLowerCase()}`).evaluate(el=>getComputedStyle(el).stroke)).toBe(await page.evaluate(side=>window.activityExpected(side),side));
});
