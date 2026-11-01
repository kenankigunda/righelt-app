import {test,expect} from '@playwright/test';
for(const width of [320,390,1440])test(`participant identities share an inline row and preserve profile controls at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.goto('/browser-integration/support/participant-identities.html');await page.waitForFunction(()=>window.fixtureReady);
 for(const scale of [100,200])for(const side of ['p1','p2'])for(const profile of ['horus','tau','babs']){
  await page.evaluate(({side,scale,profile})=>{document.documentElement.style.fontSize=`${scale}%`;window.renderPlayers(side,profile);},{side,scale,profile});
  const computer=page.locator('.participant-computer'),human=page.getByRole('button',{name:`Alice, you, ${side==='p1'?'Blue':'Red'}, Connected`,exact:true}),viewer=page.getByRole('button',{name:'Guest Disconnected',exact:true});
  await expect(computer.locator('.player-name')).toHaveText({horus:'Horus',tau:'Tau',babs:'Babs'}[profile]);expect(await computer.locator('.player-name').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await expect(computer.locator('.player-kind-icon .righelt-icon')).toBeVisible();await expect(computer).toHaveAccessibleDescription('Computer player');await expect(computer).not.toContainText('Computer');await expect(computer.locator('.connection-status-icon')).toHaveClass(/is-connected/);
  await expect(computer).toHaveAttribute('data-action','toggle-computer-card');await expect(computer).toHaveAttribute('aria-label',new RegExp('^'+{horus:'Horus',tau:'Tau',babs:'Babs'}[profile]+', (Red|Blue), Active here$'));await expect(computer.locator('[data-profile-key],[data-username],[data-identity-id]')).toHaveCount(0);expect(await computer.getAttribute('data-profile-key')).toBeNull();expect(await computer.locator('.connection-status-icon').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await human.locator('.connection-status-icon').evaluate(el=>getComputedStyle(el).backgroundColor));await expect(computer.locator('.player-username')).toHaveCount(0);
  const geometry=await computer.evaluate(el=>{const center=selector=>{const b=el.querySelector(selector).getBoundingClientRect();return {x:b.x,y:b.y+b.height/2,top:b.top,bottom:b.bottom,right:b.right,width:b.width};};const label=el.querySelector('.computer-tab-status > span:last-child'),range=document.createRange();range.selectNodeContents(label);return {emblem:center('.player-emblem'),name:center('.player-name'),stack:center('.player-name-stack'),badge:center('.player-kind-icon'),dot:center('.connection-status-icon'),status:center('.computer-tab-status'),labelLines:range.getClientRects().length,labelWidth:label.clientWidth,labelScroll:label.scrollWidth,width:document.documentElement.scrollWidth,direction:getComputedStyle(el.querySelector('.player-name-stack')).flexDirection};});
  expect(geometry.direction).toBe('row');if(scale===100&&width>=390)expect(Math.abs(geometry.name.y-geometry.badge.y)).toBeLessThan(1);
  expect(Math.abs(geometry.emblem.y-geometry.stack.y)).toBeLessThan(1);expect(geometry.name.width).toBeGreaterThan(20);expect(geometry.width).toBeLessThanOrEqual(width);
  expect(geometry.labelLines).toBe(1);expect(geometry.labelScroll).toBeLessThanOrEqual(geometry.labelWidth);
  if(scale===100&&width>=390){expect(Math.abs(geometry.dot.y-geometry.stack.y)).toBeLessThan(1);expect(geometry.dot.x).toBeGreaterThan(geometry.badge.right);}
  else if(Math.abs(geometry.dot.y-geometry.stack.y)>1)expect(geometry.status.top).toBeGreaterThanOrEqual(geometry.stack.bottom);
  if(width===320&&scale===200)expect(geometry.status.top).toBeGreaterThanOrEqual(geometry.stack.bottom);
  const colors=await page.evaluate(side=>{const resolve=token=>{const probe=document.createElement('i');probe.style.color=`var(${token})`;document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color;};return {computer:resolve(`--player-${side}`),human:resolve(`--player-${side==='p1'?'p2':'p1'}`),viewer:resolve('--ink')};},side);
  expect(await computer.locator('.player-name').evaluate(el=>getComputedStyle(el).color)).toBe(colors.computer);expect(await human.locator('.player-name').evaluate(el=>getComputedStyle(el).color)).toBe(colors.human);
  expect(await computer.locator('.player-emblem').evaluate(el=>getComputedStyle(el).color)).toBe(colors.computer);expect(await viewer.locator('.player-name-stack').evaluate(el=>getComputedStyle(el).color)).toBe(colors.viewer);
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
