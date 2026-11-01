import {test,expect} from '@playwright/test';
for(const width of [320,390,1440])test(`participant identities share an inline row and preserve profile controls at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.goto('/browser-integration/support/participant-identities.html');await page.waitForFunction(()=>window.fixtureReady);
 for(const scale of [100,200])for(const side of ['p1','p2'])for(const profile of ['horus','tau','babs']){
  await page.evaluate(({side,scale,profile})=>{document.documentElement.style.fontSize=`${scale}%`;window.renderPlayers(side,profile);},{side,scale,profile});
  const computer=page.locator('.participant-computer'),human=page.getByRole('button',{name:`You, ${side==='p1'?'Blue':'Red'}, Connected`,exact:true}),viewer=page.getByRole('button',{name:'Guest Disconnected',exact:true});
  await expect(computer.locator('.player-name')).toHaveText({horus:'Horus',tau:'Tau',babs:'Babs'}[profile]);
  await expect(computer.locator('.computer-status-badge > .righelt-icon')).toBeVisible();
  await expect(computer).toHaveAttribute('aria-label',new RegExp('^'+{horus:'Horus',tau:'Tau',babs:'Babs'}[profile]+', (Red|Blue), Computer player, Active here$'));
  await expect(computer).not.toContainText('Active here');await expect(computer.locator('.player-kind-icon,.connection-status-icon')).toHaveCount(0);
  await expect(computer).toHaveAttribute('data-action','toggle-computer-card');await expect(computer.locator('[data-profile-key],[data-username],[data-identity-id]')).toHaveCount(0);expect(await computer.getAttribute('data-profile-key')).toBeNull();await expect(computer.locator('.player-username')).toHaveCount(0);
  const geometry=await computer.evaluate(el=>{const rect=selector=>{const b=el.querySelector(selector).getBoundingClientRect();return {y:b.y+b.height/2,width:b.width,height:b.height,left:b.left,right:b.right};};return {row:el.getBoundingClientRect().height,emblem:rect('.player-emblem'),stack:rect('.player-name-stack'),slot:rect('.computer-status-badge'),bot:rect('.computer-status-badge > svg'),mark:rect('.computer-status-mark'),width:document.documentElement.scrollWidth,viewport:innerWidth};});
  expect(geometry.row).toBeGreaterThanOrEqual(44);expect(geometry.emblem.width).toBe(34);expect(geometry.slot.width).toBe(24);expect(geometry.bot.width).toBe(22);expect(geometry.mark.width).toBe(12);
  expect(Math.abs(geometry.emblem.y-geometry.stack.y)).toBeLessThan(1);expect(Math.abs(geometry.emblem.y-geometry.slot.y)).toBeLessThan(1);expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.mark.left).toBeGreaterThanOrEqual(0);expect(geometry.mark.right).toBeLessThanOrEqual(geometry.viewport);
  const colors=await computer.evaluate(el=>({name:getComputedStyle(el.querySelector('.player-name')).color,emblem:getComputedStyle(el.querySelector('.player-emblem')).color,mark:getComputedStyle(el.querySelector('.computer-status-mark')).backgroundColor}));
  expect(colors.name).toBe(colors.emblem);expect(colors.mark).toBe(await human.locator('.connection-status-icon').evaluate(el=>getComputedStyle(el).backgroundColor));
  await human.focus();await page.keyboard.press('Enter');await expect(human).toBeFocused();await expect(human).toHaveAttribute('aria-expanded','true');await expect(page.getByTestId('public-profile')).toHaveText('Joined January 2026');
  await viewer.focus();await expect(viewer).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByTestId('public-profile')).toHaveText('Playing as a guest.');await expect(human).toHaveAttribute('aria-expanded','false');
  if(side==='p2'&&profile==='horus')await page.screenshot({path:info.outputPath(`players-${width}-${scale}.png`),fullPage:true});
 }
 // A real non-owning name uses the same Players renderer, not a DOM rewrite.
 for(const scale of [100,200]){
  const longName='Alexandria Longparticipantnamewithoutbreaks אבגדהוזחטיכלמנסעפצקרשת';
  await page.evaluate(({scale,longName})=>{document.documentElement.style.fontSize=`${scale}%`;window.renderPlayers('p2','babs',longName,'observer');},{scale,longName});
  const name=page.locator('[data-testid="participant-player-1"] .player-name');await expect(name).toHaveText(longName);
  const layout=await name.evaluate(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight),wrap:getComputedStyle(el).overflowWrap,scroll:el.scrollWidth,client:el.clientWidth,page:document.documentElement.scrollWidth}));
  expect(layout.wrap).toBe('anywhere');expect(layout.height).toBeGreaterThan(layout.lineHeight*1.5);expect(layout.scroll).toBeLessThanOrEqual(layout.client);expect(layout.page).toBeLessThanOrEqual(width);
 }
});
