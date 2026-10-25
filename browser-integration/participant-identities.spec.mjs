import {test,expect} from '@playwright/test';
for(const width of [320,390,1440])test(`participant identities share an inline row and preserve profile controls at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.goto('/browser-integration/support/participant-identities.html');await page.waitForFunction(()=>window.fixtureReady);
 for(const scale of [100,200])for(const side of ['p1','p2'])for(const profile of ['horus','tau','babs']){
  await page.evaluate(({side,scale,profile})=>{document.documentElement.style.fontSize=`${scale}%`;window.renderPlayers(side,profile);},{side,scale,profile});
  const computer=page.locator('.participant-computer'),human=page.getByRole('button',{name:`You, ${side==='p1'?'Blue':'Red'}, Connected`,exact:true}),viewer=page.getByRole('button',{name:'Guest Disconnected',exact:true});
  await expect(computer.locator('.player-name')).toHaveText({horus:'Horus',tau:'Tau',babs:'Babs'}[profile]);expect(await computer.locator('.player-name').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expect(computer.locator('.player-kind-badge')).toHaveText('Computer');await expect(computer.locator('.connection-status-icon')).toHaveClass(/is-connected/);
  await expect(computer.locator('button,[data-profile-key],[data-action]')).toHaveCount(0);expect(await computer.locator('.connection-status-icon').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await human.locator('.connection-status-icon').evaluate(el=>getComputedStyle(el).backgroundColor));await expect(computer.locator('.player-username')).toHaveCount(0);
  const geometry=await computer.evaluate(el=>{const center=selector=>{const b=el.querySelector(selector).getBoundingClientRect();return {x:b.x,y:b.y+b.height/2,right:b.right,width:b.width};};return {emblem:center('.player-emblem'),name:center('.player-name'),stack:center('.player-name-stack'),badge:center('.player-kind-badge'),dot:center('.connection-status-icon'),width:document.documentElement.scrollWidth};});
  expect(Math.abs(geometry.emblem.y-geometry.stack.y)).toBeLessThan(1);expect(Math.abs(geometry.dot.y-geometry.stack.y)).toBeLessThan(1);expect(geometry.name.width).toBeGreaterThan(20);expect(geometry.dot.x).toBeGreaterThan(geometry.badge.right);expect(geometry.width).toBeLessThanOrEqual(width);
  const color=await computer.locator('.player-name').evaluate(el=>getComputedStyle(el).color);expect(color).toBe(await human.locator('.player-name').evaluate(el=>getComputedStyle(el).color));expect(color).toBe(await viewer.locator('.player-name-stack').evaluate(el=>getComputedStyle(el).color));
  expect(await computer.locator('.player-emblem').evaluate(el=>getComputedStyle(el).color)).not.toBe(color);
  await human.focus();await page.keyboard.press('Enter');await expect(human).toBeFocused();await expect(human).toHaveAttribute('aria-expanded','true');await expect(page.getByTestId('public-profile')).toHaveText('Joined January 2026');
  await viewer.focus();await expect(viewer).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByTestId('public-profile')).toHaveText('Playing as a guest.');await expect(human).toHaveAttribute('aria-expanded','false');
  if(side==='p2'&&profile==='horus')await page.screenshot({path:info.outputPath(`players-${width}-${scale}.png`),fullPage:true});
 }
});
