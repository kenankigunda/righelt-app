import {readFile,writeFile} from 'node:fs/promises';
import { observeReloadHomeReads } from '../support/reload-home-reads.mjs';
import {installInvitationFocusDiagnostics} from '../support/invitation-focus-diagnostics.mjs';
import { waitForOverlayEntry } from "../support/overlay-motion.mjs";
import { switchGamePanel } from '../support/app.mjs';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('guest home, tactile toggle, Babs modal and original board remain usable',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   window.entryPanelAnimations=[];
   const animate=Element.prototype.animate;
   Element.prototype.animate=function(frames,options){
     if(this.matches('[data-game-panel="join"]') && Array.isArray(frames) && frames.some(frame=>'height' in frame))window.entryPanelAnimations.push(frames);
     return animate.call(this,frames,options);
   };
 });
 await page.goto('/');
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Continue playing'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();
 const sound=page.getByRole('button',{name:'Mute sound',exact:true});
 await sound.locator('svg').click();
 await expect(page.getByRole('button',{name:'Enable sound',exact:true})).toBeFocused();
 // Bind each response to a request started after this reload's main-frame commit.
 const reloadHome=observeReloadHomeReads(page);
 const reloadedHomeReads=['my','other'].map(section=>page.waitForResponse(response=>reloadHome.matches(response,section)));
 // Own early rejection without replacing the original promises or hiding later errors.
 for(const read of reloadedHomeReads)void read.catch(()=>{});
 try{
  const reloadResponse=await page.reload();reloadHome.assertReload(reloadResponse);
  await expect(page.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();
  for(const response of await Promise.all(reloadedHomeReads))expect(await response.finished()).toBeNull();
  reloadHome.assertReload(reloadResponse);
 }finally{reloadHome.dispose();}
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await expect(page.getByTestId('home-create-game')).toBeEnabled();
 // Model preparation may exceed the carousel interval. Hold autoplay while
 // checking the manual caret, then restore normal time once that click stops it.
 await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
 await page.locator('button[data-opponent="babs"]').click();
 const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Play Babs'})).toBeEnabled();
 await expect(page.locator('.story-presentation-board')).toBeAttached();
 await expect(dialog.locator('[data-story-position], [data-story-pause]')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Next story image'}).click();
 await page.clock.resume();
 await expect(dialog.locator('[data-story-image]').nth(1)).toHaveAttribute('data-active','true');
 await expect.poll(()=>dialog.locator('.story-art').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);
 await page.screenshot({path:test.info().outputPath('babs-desktop.png')});
 const a11y=await new AxeBuilder({page}).include('dialog[open]').analyze();expect(a11y.violations).toEqual([]);
 await page.keyboard.press('Escape');await expect(page.locator('button[data-opponent="babs"]')).toBeFocused();
 await expect(page.locator('.story-presentation-board')).toHaveCount(0);
 await page.getByTestId('home-create-game').locator('img').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Invite a friend'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByTestId('game-board')).toBeVisible();
 const legend=page.locator('.overlay-key').getByRole('button');
 await expect(legend).toHaveText(['Commander','Supply point']);
 await expect(legend.nth(0)).toHaveAccessibleName('Red commander inspection');
 await expect(legend.nth(1)).toHaveAccessibleName('Red supply point inspection');
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 const ownProfile=page.getByTestId('participant-player-1').locator('[data-action="guest-profile"]');
 await expect(ownProfile).toHaveText('Guest');await expect(ownProfile).toHaveAccessibleName('Guest, you, Red, Connected');
 // Resolve and measure the current connected SVG in one page turn. The driver
 // must not carry a replaced marker handle into the style publication check.
 await expect.poll(()=>page.evaluate(()=>{
  const marker=document.querySelector('.supply-point-marker.supply-point-p1'),svg=marker?.querySelector('svg');
  return marker?.isConnected&&svg?.isConnected?getComputedStyle(svg).fill:null;
 })).toBe('rgb(194, 69, 47)');
 await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');
 expect(await page.evaluate(()=>window.entryPanelAnimations)).toEqual([]);
 const playersPanel=page.locator('[data-game-panel="join"]');
 await expect.poll(()=>playersPanel.evaluate(el=>el.getBoundingClientRect().bottom-el.lastElementChild.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(0);
 await page.screenshot({path:test.info().outputPath('game-desktop.png')});
 await page.goBack();await expect(page.getByRole('heading',{name:'Continue playing'})).toBeVisible();
 await expect(page.getByTestId('home-create-game')).toBeEnabled();expect(errors).toEqual([]);
});

test('phone home and Babs carets fit without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.goto('/');
 await expect(page.getByRole('button',{name:'Mute sound',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('home-phone.png')});
 const menuTrigger=page.getByRole('button',{name:'Open navigation menu',exact:true});await menuTrigger.click();
 const menu=page.locator('.shell-header-menu-panel');await expect(menu).toBeVisible();
 await expect.poll(()=>menu.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 const menuPaint=await menu.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{radius:s.borderRadius,clip:s.clipPath,image:s.backgroundImage,shadow:s.boxShadow,rect:r.toJSON(),viewport:innerWidth,rows:[...el.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect(),style=getComputedStyle(button);return{text:button.textContent.trim(),height:b.height,left:b.left,right:b.right,background:style.backgroundColor,shadow:style.boxShadow};})};});
 expect(menuPaint.radius).toBe('0px');expect(menuPaint.clip.startsWith('polygon(')).toBe(true);expect(menuPaint.image).toContain('url(');expect(menuPaint.rect.left).toBeGreaterThanOrEqual(0);expect(menuPaint.rect.right).toBeLessThanOrEqual(menuPaint.viewport);
 expect(menuPaint.rows.map(row=>row.text)).toEqual(['Account','Scenarios','Debug']);for(const row of menuPaint.rows){expect(row.height).toBeGreaterThanOrEqual(44);expect(row.shadow).toBe('none');}
 const menuMetrics=test.info().outputPath('mobile-menu-native.json');await writeFile(menuMetrics,JSON.stringify(menuPaint,null,2),{mode:0o600});await test.info().attach('mobile menu native paint',{path:menuMetrics,contentType:'application/json'});
 await page.screenshot({path:test.info().outputPath('mobile-menu-clipped-marble.png')});
 await menu.getByRole('button',{name:'Scenarios',exact:true}).focus();await expect(menu.getByRole('button',{name:'Scenarios',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-hidden','true');await expect(menuTrigger).toHaveAttribute('aria-expanded','false');await expect(menu.getByRole('button',{name:'Scenarios',exact:true,includeHidden:true})).toHaveAttribute('tabindex','-1');menuPaint.afterEscape=await menu.evaluate(el=>({focusInside:el.contains(document.activeElement),focusedAction:document.activeElement?.getAttribute('data-action'),activeElement:document.activeElement?.tagName}));await writeFile(menuMetrics,JSON.stringify(menuPaint,null,2),{mode:0o600});await expect(menuTrigger).toBeFocused();
 await menuTrigger.click();await expect(menu).toHaveAttribute('aria-hidden','false');const outsideSound=page.getByRole('button',{name:'Mute sound',exact:true});await outsideSound.focus();await page.keyboard.press('Escape');await expect(outsideSound).toBeFocused();await expect(menu).toHaveAttribute('aria-hidden','true');
 await menuTrigger.click();await expect(page.locator('.shell-header-menu-panel')).toBeVisible();const outsideHeading=page.getByRole('heading',{name:'Start something new',exact:true});const outsideRect=await outsideHeading.boundingBox();expect(outsideRect.x+1).toBeLessThan(menuPaint.rect.left);await outsideHeading.click({position:{x:1,y:1}});await expect(page.locator('.shell-header-menu-panel')).toHaveAttribute('aria-hidden','true');
 await page.locator('button[data-opponent="babs"]').click();const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Next story image'})).toBeVisible();
 await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect.poll(()=>dialog.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).length)).toBe(0);
 await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
 await expect.poll(()=>dialog.locator('[data-story-image][data-active="true"]').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.screenshot({path:test.info().outputPath('babs-phone.png')});
 // System foreground preserves all three menu bars when forced colors removes
 // decorative backgrounds. The native button still owns opening and Escape.
 await dialog.getByRole('button',{name:'Close opponent story',exact:true}).click();await expect(dialog).not.toBeVisible();
 await page.emulateMedia({forcedColors:'active'});expect(await page.evaluate(()=>matchMedia('(forced-colors:active)').matches)).toBe(true);
 const forcedTrigger=page.getByRole('button',{name:'Open navigation menu',exact:true});await expect(forcedTrigger).toBeVisible();await expect(forcedTrigger).toHaveAttribute('aria-expanded','false');
 const forcedMenu=await forcedTrigger.evaluate(el=>{const backgroundChain=[];for(let ancestor=el;ancestor;ancestor=ancestor.parentElement){const style=getComputedStyle(ancestor);backgroundChain.push({tag:ancestor.tagName,className:ancestor.className,background:style.backgroundColor,image:style.backgroundImage,filter:style.filter,backdrop:style.backdropFilter,opacity:style.opacity});const channels=style.backgroundColor.match(/[\d.]+/g)?.map(Number);if(channels&&(channels.length===3||channels[3]===1))break;}return{button:el.getBoundingClientRect().toJSON(),backgroundChain,bars:[...el.querySelectorAll('.shell-header-menu-icon > span')].map(bar=>({rect:bar.getBoundingClientRect().toJSON(),background:getComputedStyle(bar).backgroundColor,adjust:getComputedStyle(bar).forcedColorAdjust,visibility:getComputedStyle(bar).visibility,display:getComputedStyle(bar).display}))};});
 const luminance=color=>{const channels=color.match(/[\d.]+/g).map(Number);expect(channels.length).toBeGreaterThanOrEqual(3);if(channels.length===4)expect(channels[3]).toBe(1);const linear=channels.slice(0,3).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;};
 const forcedMetrics=test.info().outputPath('mobile-menu-forced-colors.json');await writeFile(forcedMetrics,JSON.stringify(forcedMenu,null,2),{mode:0o600});await test.info().attach('forced colors menu bars',{path:forcedMetrics,contentType:'application/json'});
 for(const ancestor of forcedMenu.backgroundChain){expect(ancestor.image).toBe('none');expect(ancestor.filter).toBe('none');expect(ancestor.backdrop).toBe('none');expect(ancestor.opacity).toBe('1');const channels=ancestor.background.match(/[\d.]+/g).map(Number);if(channels.length===4)expect([0,1]).toContain(channels[3]);}
 const backgroundLuminance=luminance(forcedMenu.backgroundChain.at(-1).background);forcedMenu.contrasts=forcedMenu.bars.map(bar=>{const levels=[backgroundLuminance,luminance(bar.background)].sort((a,b)=>a-b);return(levels[1]+.05)/(levels[0]+.05);});
 await writeFile(forcedMetrics,JSON.stringify(forcedMenu,null,2),{mode:0o600});
 expect(forcedMenu.button.width).toBeGreaterThanOrEqual(44);expect(forcedMenu.button.height).toBeGreaterThanOrEqual(44);expect(forcedMenu.bars).toHaveLength(3);
 for(const [index,bar] of forcedMenu.bars.entries()){expect(bar.display).not.toBe('none');expect(bar.visibility).toBe('visible');expect(bar.rect.width).toBeGreaterThan(0);expect(bar.rect.height).toBe(2);expect(bar.adjust).toBe('none');expect(forcedMenu.contrasts[index]).toBeGreaterThanOrEqual(3);expect(bar.rect.left).toBeGreaterThanOrEqual(forcedMenu.button.left);expect(bar.rect.right).toBeLessThanOrEqual(forcedMenu.button.right);}
 const closedImage=test.info().outputPath('mobile-menu-forced-colors-closed.png');await page.screenshot({path:closedImage});await test.info().attach('forced colors closed menu',{path:closedImage,contentType:'image/png'});
 await forcedTrigger.click();await expect(menu).toHaveAttribute('aria-hidden','false');await expect(page.getByRole('button',{name:'Close navigation menu',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect.poll(()=>menu.evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);await expect.poll(()=>menu.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
 const openImage=test.info().outputPath('mobile-menu-forced-colors-open.png');await page.screenshot({path:openImage});await test.info().attach('forced colors open menu',{path:openImage,contentType:'image/png'});
 await menu.getByRole('button',{name:'Scenarios',exact:true}).focus();await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-hidden','true');await expect(forcedTrigger).toBeFocused();await expect(menu.getByRole('button',{name:'Scenarios',exact:true,includeHidden:true})).toHaveAttribute('tabindex','-1');
 await page.emulateMedia({forcedColors:'none'});
});

test('Friend invite stays open after player copy and Players shares viewer intent',async({page,browser})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedInvite=text;}}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Invite a friend'});await expect(modal).toBeVisible();
 await expect(modal.locator('[data-invite-role="viewer"]')).toHaveCount(0);
 await modal.locator('[data-invite-role="blue"]').click();
 await expect(modal.getByRole('status')).toHaveText('Link copied! Ready to share.');await expect(modal).toBeVisible();
 expect(await page.evaluate(()=>window.copiedInvite)).toContain('as=blue');
 await modal.getByRole('button',{name:'Close invite',exact:true}).click();await switchGamePanel(page,'players');
 const viewer=page.locator('[data-game-panel="join"] [data-invite-role="viewer"]');await viewer.focus();await page.keyboard.press('Enter');await expect(viewer).toBeFocused();
 const link=await page.evaluate(()=>window.copiedInvite);expect(link).toContain('as=viewer');
 const context=await browser.newContext();const guest=await context.newPage();await guest.goto(link);
 await expect(guest.getByRole('heading',{name:'Watch this game'})).toBeVisible();await expect(guest.getByTestId('invite-join-player')).toBeHidden();
 await guest.getByTestId('invite-join-viewer').click();await expect(guest.getByTestId('game-role')).toContainText('Viewer');await context.close();
 await page.goBack();await expect(modal).not.toBeVisible();await expect(page.getByRole('heading',{name:'Continue playing'})).toBeVisible();
});

test('home refresh preserves a pressed opponent and first home sound starts without waiting for navigation',async({page})=>{
 await page.addInitScript(()=>{window.audioCues=[];window.AudioContext=class{state='running';currentTime=0;sampleRate=8000;destination={};resume(){return Promise.resolve();}suspend(){return Promise.resolve();}createBuffer(_,n){return{getChannelData:()=>new Float32Array(n)}}node(){return{frequency:{},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){window.audioCues.push(performance.now())},stop(){}}}createBufferSource(){return this.node()}createBiquadFilter(){return this.node()}createGain(){return this.node()}createOscillator(){return this.node()}};});
 let fulfilled=0;let release;const gate=new Promise(r=>release=r);await page.route('**/api/shell/games?**',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});fulfilled++;});
 await page.goto('/');const babs=page.locator('button[data-opponent="babs"]');await expect(babs).toBeVisible();await babs.scrollIntoViewIfNeeded();const box=await babs.boundingBox();
 await babs.evaluate(el=>window.pressedOpponent=el);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();release();await expect.poll(()=>fulfilled).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.pressedOpponent.isConnected)).toBe(true);await page.mouse.up();await expect(page.getByRole('dialog',{name:'Babs',exact:true})).toBeVisible();await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 expect(await page.evaluate(()=>window.audioCues.length)).toBe(2);await page.unrouteAll({behavior:'ignoreErrors'});
});

test('Players viewer invitation preserves focus through pending copy and failure',async({page,baseURL},info)=>{
 const focusDiagnostics=await installInvitationFocusDiagnostics(page,info,{baseURL});
 try {
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise((resolve,reject)=>{window.finishCopy=resolve;window.failCopy=reject;})}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Invite a friend'});await expect(modal).toBeVisible();
 await expect.poll(()=>modal.evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(250);
 const background=page.locator('.invite-gate-content');await expect(background).toHaveAttribute('inert','');
 await expect.poll(()=>page.evaluate(()=>{const surface=document.querySelector('.invite-gate-modal');const behind=document.querySelector('.invite-gate-content');return surface && behind ? behind.getBoundingClientRect().top-surface.getBoundingClientRect().bottom : -1;})).toBeGreaterThan(0);
 await expect(modal.locator('[data-invite-role="viewer"]')).toHaveCount(0);
 await modal.getByRole('button',{name:'Close invite',exact:true}).click();await switchGamePanel(page,'players');
 const panel=page.locator('[data-game-panel="join"]'),viewer=panel.locator('[data-invite-role="viewer"]');await viewer.focus();await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>typeof window.finishCopy)).toBe('function');
 await page.evaluate(()=>{window.finishCopy();delete window.failCopy;});await expect(viewer).not.toHaveAttribute('aria-busy','true');await expect(viewer).toBeFocused();
 await page.keyboard.press('Enter');await expect.poll(()=>page.evaluate(()=>typeof window.failCopy)).toBe('function');
 await page.evaluate(()=>window.failCopy(new Error('Clipboard denied')));
 await expect(panel.getByRole('textbox',{name:'Invitation link'})).toBeVisible();await expect(viewer).toBeFocused();
 await expect(panel.getByRole('textbox',{name:'Invitation link'})).toHaveValue(/as=viewer/);
 }finally{await focusDiagnostics.persist();}
});

test('carousel keeps cycling under hover and focus but stops after a caret',async({page})=>{
 await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});await page.goto('/');
 await expect(page.locator('button[data-opponent="babs"]')).toBeVisible();
 await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
 await page.locator('button[data-opponent="babs"]').click();
 const modal=page.getByRole('dialog',{name:'Babs',exact:true});await expect(modal).toBeVisible();
 await modal.locator('.story-art').hover();await modal.getByRole('button',{name:'Next story image'}).focus();
 await page.clock.fastForward(3100);await expect(modal.locator('[data-story-image]').nth(1)).toHaveAttribute('data-active','true');
 await modal.getByRole('button',{name:'Next story image'}).click();
 await page.clock.fastForward(6500);await expect(modal.locator('[data-story-image]').nth(2)).toHaveAttribute('data-active','true');
});

test('board has four turn-colored corners, neutral surroundings and a light hover wash',async({page})=>{
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const board=page.locator('[data-shell-panel="board"]');await expect(board).toBeVisible();await expect(board).toHaveAttribute('data-turn-side','red');
 // Closing Invite and finishing route entry can replace the panel node.
 // Read connection and styles together, then wait for the same four accents.
 await expect.poll(()=>board.evaluate(el=>el.isConnected?(getComputedStyle(el,'::before').backgroundImage.match(/linear-gradient/g)??[]).length:0)).toBeGreaterThanOrEqual(4);
 const neutral=await page.locator('[data-game-panel="join"]').evaluate(el=>getComputedStyle(el).getPropertyValue('--corner-start').trim());expect(neutral).toBe('transparent');
 await expect(board.getByRole('img',{name:'Red commander',exact:true})).toBeVisible();
 const cell=board.locator('.cell').filter({has:page.locator('.piece-token.p1')}).first();await cell.hover();
 const rgb=await cell.evaluate(el=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(el).backgroundColor;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3);});expect(Math.min(...rgb)).toBeGreaterThan(220);
});

test('modal size animation ends at its natural height without a final snap',async({page})=>{
 await page.setViewportSize({width:1440,height:1300});
 await page.goto('/');
 // The initial home response replaces the opponent buttons. Finish that
 // refresh before clicking so a detached pointer target cannot lose the click.
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 await page.locator('button[data-opponent="babs"]').click();
 const modal=page.getByRole('dialog',{name:'Babs',exact:true});await expect(modal).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>document.querySelector('dialog[open]').getAnimations().length===0);
 await modal.evaluate(el=>{
   const animate=el.animate.bind(el);
   el.animate=(frames,options)=>{const animation=animate(frames,options);animation.finished.then(()=>{requestAnimationFrame(()=>{window.modalSizeProof={endpoint:parseFloat(frames.at(-1).height),settled:el.getBoundingClientRect().height};});});return animation;};
   const p=document.createElement('p');p.textContent='A little more room for the story.';p.style.margin='16px 0';el.querySelector('.modal-content').append(p);
 });
 await page.waitForFunction(()=>window.modalSizeProof);
 const proof=await page.evaluate(()=>window.modalSizeProof);expect(Math.abs(proof.settled-proof.endpoint)).toBeLessThan(2);
});

test('header utilities expand on hover and keyboard focus while retaining their actions',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 const scenarios=page.getByRole('button',{name:'Scenarios',exact:true});const debug=page.getByRole('button',{name:'Debug',exact:true});
 await expect(scenarios).toBeVisible();await expect(debug).toBeVisible();
 // Live home refresh may replace a header node between visibility and measurement.
 await expect.poll(async()=>(await scenarios.boundingBox())?.width??Infinity).toBeLessThanOrEqual(46);
 await scenarios.hover();await expect.poll(async()=>(await scenarios.boundingBox())?.width??0).toBeGreaterThan(90);
 await page.mouse.move(1,1);await debug.focus();await expect.poll(async()=>(await debug.boundingBox())?.width??0).toBeGreaterThan(80);
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await debug.locator('.header-action-label').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
 await page.keyboard.press('Enter');await expect(page.locator('[data-flyout="debug"]')).toBeVisible();
});

test('sound hover is quiet and clears when the page loses focus',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 const sound=page.locator('.sound-toggle');await sound.hover();
 await expect.poll(()=>sound.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(37, 43, 45, 0.06)');
 expect(await sound.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await expect.poll(()=>sound.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('copy feedback preserves focus and collapses its space when empty',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const panel=page.locator('[data-game-panel="join"]');const copy=panel.locator('[data-invite-role="blue"]');
 // Measure the same authoritative controls before and after transient feedback.
 await expect(panel.getByRole('button',{name:'Play both sides',exact:true})).toBeVisible();
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 await copy.focus();
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>panel.evaluate(el=>el.getAnimations().length)).toBe(0);
 const before=(await panel.boundingBox()).height;await page.keyboard.press('Enter');
 await expect(panel.getByRole('status')).toHaveText('Link copied! Ready to share.');await expect(copy).toBeFocused();
 const pendingSeat=panel.getByTestId('pending-invitation');await expect(pendingSeat).toHaveAttribute('data-player-side','p2');
 await expect(pendingSeat.locator('span:not(.sr-only)')).toHaveText('Awaiting player');await expect(pendingSeat.locator('.sr-only')).toHaveText('Blue');
 await expect(panel.getByTestId('participant-player-1').getByRole('img',{name:'Connected',exact:true})).toBeVisible();
 await expect.poll(()=>panel.evaluate(el=>el.getAnimations().length)).toBe(0);
 expect((await panel.boundingBox()).height).toBeGreaterThanOrEqual(before);
 await expect(panel.getByRole('status',{includeHidden:true})).toHaveText('');await expect.poll(()=>panel.evaluate(el=>el.getAnimations().length)).toBe(0);expect(Math.abs((await panel.boundingBox()).height-before)).toBeLessThan(2);
 await expect(page.getByText('Commander',{exact:true})).toBeVisible();
});

test('storybook artwork draws back then slides while story copy stays fixed',async({page})=>{
 await page.goto('/');await page.locator('button[data-opponent="babs"]').click();
 const modal=page.getByRole('dialog',{name:'Babs',exact:true});await expect(modal).toBeVisible();
 await waitForOverlayEntry(modal);
 const copy=modal.locator('.opponent-story-copy');const before=await copy.boundingBox();
 // Hold the actual owned image animations. This is geometry/keyframe proof,
 // not a wall-clock performance measurement or a synthetic animation replica.
 await modal.evaluate(el=>{
   window.observedStoryAnimations=[];
   for(const image of el.querySelectorAll('[data-story-image]')){
     const animate=image.animate.bind(image);
     image.animate=(...args)=>{
       const animation=animate(...args);animation.pause();
       window.observedStoryAnimations.push(animation);return animation;
     };
   }
 });
 for(const [name,index,direction] of [['Next story image',1,1],['Previous story image',0,-1]]){
   await modal.getByRole('button',{name}).click();
   await expect(modal.locator('[data-story-image]').nth(index)).toHaveAttribute('data-active','true');
   const held=await modal.evaluate(async el=>{
     const animations=window.observedStoryAnimations;
     await Promise.all(animations.map(animation=>animation.ready));
     for(const animation of animations)animation.currentTime=animation.effect.getTiming().duration*.2;
     const frames=animations.map(animation=>({duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes().map(frame=>({transform:frame.transform,opacity:frame.opacity,offset:frame.offset}))}));
     return {frames,shadeCount:el.querySelectorAll('.story-turn-shade').length};
   });
   expect(held.frames).toHaveLength(2);expect(held.shadeCount).toBe(0);
   for(const animation of held.frames){expect(animation.duration).toBe(760);for(const frame of animation.frames)expect(Number(frame.opacity)).toBe(1);}
   expect(held.frames[0].frames[1].transform).toBe(`translateX(${6*direction}%)`);
   expect(held.frames[0].frames.at(-1).transform).toBe(`translateX(${-112*direction}%)`);
   expect(held.frames[1].frames[1].transform).toBe(`translateX(${118*direction}%)`);
   const current=await copy.boundingBox();
   for(const key of ['x','y','width','height'])expect(current[key]).toBeCloseTo(before[key],0);
   await modal.evaluate(async()=>{
     const animations=window.observedStoryAnimations;window.observedStoryAnimations=[];
     for(const animation of animations)animation.play();
     await Promise.all(animations.map(animation=>animation.finished));
   });
   await expect.poll(()=>modal.locator('[data-story-image]').evaluateAll(images=>images.flatMap(image=>image.getAnimations()).length)).toBe(0);
 }
});

for(const outcome of ['success','failure'])test(`Players restores the selected invitation role after delayed clipboard ${outcome}`,async({page,baseURL},info)=>{
 const focusDiagnostics=await installInvitationFocusDiagnostics(page,info,{baseURL});
 try {
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise((resolve,reject)=>{window.completeClipboard=resolve;window.failClipboard=()=>reject(new Error('Clipboard unavailable'));})}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const panel=page.locator('[data-game-panel="join"]');const viewer=panel.locator('[data-invite-role="viewer"]');await viewer.press('Enter');
 await page.waitForFunction(()=>window.completeClipboard);await expect(viewer).toHaveAttribute('aria-busy','true');
 await page.evaluate(outcome=>outcome==='success'?window.completeClipboard():window.failClipboard(),outcome);
 await expect(viewer).not.toHaveAttribute('aria-busy','true');await expect(viewer).toBeFocused();
 if(outcome==='failure')await expect(panel.getByRole('textbox',{name:'Invitation link'})).toBeVisible();
 }finally{await focusDiagnostics.persist();}
});

for (const opponent of ['babs','tau','horus']) test(`${opponent} story has no decorative scroll overflow`,async({page})=>{
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');
 await page.locator(`button[data-opponent="${opponent}"]`).click();
 const dialog=page.locator('dialog[open]');
 await expect.poll(()=>dialog.evaluate(el=>el.scrollHeight-el.clientHeight)).toBe(0);
 await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBe(0);
 await page.setViewportSize({width:812,height:375});
 const play=dialog.getByRole('button',{name:new RegExp('Play '+opponent,'i')});
 await play.scrollIntoViewIfNeeded();await expect(play).toBeInViewport({ratio:1});
});

 test('opponent stories preserve background scroll on open and close',async({page})=>{
 await page.setViewportSize({width:375,height:600});await page.goto('/');
 const card=page.locator('button[data-opponent="horus"]');await expect(card).toBeVisible();
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await card.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>scrollY);expect(before).toBeGreaterThan(0);
 await card.click();await expect(page.getByRole('dialog',{name:'Horus',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before);
 const dialog=page.getByRole('dialog',{name:'Horus',exact:true});
 await expect(dialog.getByRole('button',{name:'Close opponent story'})).toBeInViewport();
 await page.mouse.move(2,2);await page.mouse.wheel(0,500);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before);
 await page.keyboard.press('Escape');await expect(card).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before);
 });

test('game sections share heading weight and compact player presence',async({page})=>{
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');
 await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const row=page.getByTestId('participant-player-1');await expect(row.getByRole('img',{name:'Connected',exact:true})).toBeVisible();
 // Query and sample in one browser turn: a live update can replace a heading
 // between Playwright's array-handle query and its later evaluateAll callback.
 const headings=await page.evaluate(()=>[...document.querySelectorAll('.panel h2')].map(el=>({text:el.textContent.trim(),isConnected:el.isConnected,weight:getComputedStyle(el).fontWeight})));
 const snapshot=JSON.stringify(headings);
 expect(headings.length,snapshot).toBeGreaterThan(2);
 expect(headings.every(heading=>heading.isConnected&&heading.weight.length>0),snapshot).toBe(true);
 expect(new Set(headings.map(heading=>heading.weight)).size,snapshot).toBe(1);
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.locator('.panel').evaluateAll(items=>items.reduce((sum,el)=>sum+el.getAnimations().length,0))).toBe(0);
 await page.screenshot({path:test.info().outputPath('game-refined-desktop.png')});
});

for(const mode of ['friend','self'])test(`${mode} creation retains covering and reveal`,async({page})=>{
 await page.goto('/');await expect(page.getByTestId('home-create-game')).toBeVisible();
 await page.evaluate(()=>{window.swipePhases=[];const layer=document.querySelector('#shell-route-transition-layer');new MutationObserver(()=>{window.swipePhases.push(layer.dataset.phase)}).observe(layer,{attributes:true,attributeFilter:['data-phase']});});
 await (mode==='friend'?page.getByTestId('home-create-game'):page.getByRole('button',{name:'Play both sides',exact:true})).click();
 if(mode==='friend'){await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await expect(page.getByRole('dialog',{name:'Invite a friend'})).toBeVisible();}
 await expect.poll(()=>page.evaluate(()=>window.swipePhases.includes('covering') && window.swipePhases.includes('revealing'))).toBe(true);
});

for (const width of [375,900,901,1100,1440]) test(`flyouts enter and leave through their placement edge at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/');
 await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await page.evaluate(()=>{window.flyoutFrames=[];function record(){const el=document.querySelector('[data-flyout="scenarios"]');if(el){const m=new DOMMatrix(getComputedStyle(el).transform);if(Math.abs(m.m41)+Math.abs(m.m42)>1)window.flyoutFrames.push({x:m.m41,y:m.m42,closing:el.classList.contains('is-closing')});}requestAnimationFrame(record);}record();});
 const scenarios=page.getByRole('button',{name:'Scenarios',exact:true});
 if(!await scenarios.isVisible())await page.getByRole('button',{name:'Open navigation menu'}).click();
 await scenarios.click();
 const flyout=page.locator('[data-flyout="scenarios"]');await expect(flyout).toBeVisible();
 await expect.poll(()=>flyout.evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
 await flyout.getByRole('button',{name:/Close/}).click();await expect(flyout).toHaveCount(0);
 const frames=await page.evaluate(()=>window.flyoutFrames);
 for(const closing of [false,true]){const phase=frames.filter(f=>f.closing===closing);expect(phase.length).toBeGreaterThan(0);for(const frame of phase){expect(Math.abs(width>900?frame.y:frame.x)).toBeLessThan(1);expect(width>900?frame.x:frame.y).toBeGreaterThan(0);}}
});

test('Friend introduction uses one illustration, cancels without creating, and previews the board before joining',async({page,browser})=>{
 let creates=0;page.on('request',r=>{if(r.method()==='POST' && new URL(r.url()).pathname==='/api/shell/games')creates++;});
 await page.goto('/');await page.getByTestId('home-create-game').click();
 const intro=page.getByRole('dialog',{name:'Friend',exact:true});await expect(intro).toBeVisible();
 await expect(intro.locator('img')).toHaveCount(1);await expect(intro.locator('[data-story-step]')).toHaveCount(0);
 await expect.poll(()=>intro.locator('img').evaluate(el=>el.complete && el.naturalWidth>0)).toBe(true);
 await expect.poll(()=>intro.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).length)).toBe(0);
 await expect.poll(()=>intro.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
 await page.screenshot({path:test.info().outputPath('friend-introduction.png')});
 await page.mouse.click(2,2);await expect(intro).not.toBeVisible();expect(creates).toBe(0);
 await page.getByTestId('home-create-game').click();await intro.getByRole('button',{name:'Start a friend game'}).click();
 await expect(page.getByRole('dialog',{name:'Invite a friend'})).toBeVisible();
 await expect(page.locator('#shell-board .cell')).toHaveCount(100);
 const other=await browser.newContext();try{const visitor=await other.newPage();await visitor.goto(page.url());
 await expect(visitor.getByRole('heading',{name:'Choose how to enter this game'})).toBeVisible();
 await expect(visitor.locator('#shell-board .cell')).toHaveCount(100);
 await expect(visitor.locator('.invite-gate-content')).toHaveAttribute('inert','');
 }finally{await other.close();}
});

for (const width of [375, 900, 1440]) test(`identity hierarchy remains aligned at ${width}px`, async ({page}) => {
 await page.setViewportSize({width,height:1100});await page.goto('/');
 await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');
 const playersTab=page.getByRole('button',{name:'Players',exact:true});
 await expect(page.locator('#app')).toHaveAttribute('data-shell-layout-mode',width<=900?'narrow':'wide');
 await switchGamePanel(page,'players');
 const list=page.getByTestId('participants-list');await expect(list).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 if(await playersTab.isVisible()) {
   // Focus/scrollIntoView must not create a second horizontal scroll position
   // in the viewport whose transform already selects the current panel.
   const viewport=page.locator('.game-shell-track-wrap');
   await viewport.evaluate(el=>{el.scrollLeft=100;});
   await expect.poll(()=>viewport.evaluate(el=>el.scrollLeft)).toBe(0);
 }
 await expect.poll(()=>page.locator('.panel').evaluateAll(items=>items.reduce((n,el)=>n+el.getAnimations().length,0))).toBe(0);
 await expect(async()=>{
 const measurements=await list.evaluate(el=>{
  const row=el.querySelector('li'),button=row.querySelector('button'),emblem=button.querySelector('.player-emblem'),name=button.querySelector('.player-name-stack'),status=button.querySelector('.connection-status-icon');
  const rect=e=>e.getBoundingClientRect();
  const center=e=>rect(e).top+rect(e).height/2;
  return {identityGap:rect(name).left-rect(emblem).right,statusGap:rect(status).left-rect(name).right,emblemCenter:center(emblem),nameCenter:center(name),statusCenter:center(status),nameX:rect(name).left,emptyX:[...el.querySelectorAll('.participant-empty > span:not(.sr-only)')].map(e=>rect(e).left),buttonInside:rect(button).left>=rect(row).left&&rect(button).right<=rect(row).right,overflow:el.scrollWidth>el.clientWidth};
 });
 expect(measurements.identityGap).toBeGreaterThanOrEqual(0);expect(measurements.identityGap).toBeLessThanOrEqual(10);
 expect(measurements.statusGap).toBeGreaterThanOrEqual(0);expect(measurements.statusGap).toBeLessThanOrEqual(10);
 expect(Math.abs(measurements.emblemCenter-measurements.nameCenter)).toBeLessThan(1);expect(Math.abs(measurements.statusCenter-measurements.nameCenter)).toBeLessThan(1);expect(measurements.buttonInside).toBe(true);
 for(const x of measurements.emptyX)expect(Math.abs(x-measurements.nameX)).toBeLessThan(1);
 expect(measurements.overflow).toBe(false);
 }).toPass({timeout:10000});
 await list.locator('button').first().click();await expect(list.getByTestId('public-profile')).toBeVisible();
 await expect.poll(()=>list.locator('[data-profile-slot]').evaluateAll(items=>items.reduce((n,el)=>n+el.getAnimations().length,0))).toBe(0);
 await page.screenshot({path:test.info().outputPath(`identity-${width}.png`),fullPage:true});
});

for(const size of [{width:1440,height:900},{width:375,height:667},{width:900,height:500}])test(`shared story viewport fits ${size.width}x${size.height}`,async({page})=>{
 await page.setViewportSize(size);await page.goto('/');await page.getByTestId('home-create-game').click();
 const dialog=page.getByRole('dialog',{name:'Friend',exact:true});await expect(dialog).toBeVisible();await page.evaluate(()=>document.fonts.ready);await waitForOverlayEntry(dialog);
 const content=dialog.locator('.modal-content');await content.evaluate(el=>el.scrollTop=el.scrollHeight);
 const action=dialog.getByRole('button',{name:'Start a friend game',exact:true});await expect(action).toBeInViewport();
 await expect(dialog.getByRole('button',{name:'Close opponent story'})).toBeInViewport();
 const bounds=await dialog.evaluate(el=>({outer:el.scrollHeight-el.clientHeight,rect:el.getBoundingClientRect().toJSON(),inner:el.querySelector('.modal-content').getBoundingClientRect().toJSON(),button:el.querySelector('[data-story-play]').getBoundingClientRect().toJSON()}));
 expect(bounds.outer).toBeLessThanOrEqual(1);expect(bounds.rect.top).toBeGreaterThanOrEqual(0);expect(bounds.rect.bottom).toBeLessThanOrEqual(size.height);
 expect(bounds.rect.bottom-bounds.button.bottom).toBeGreaterThanOrEqual(28);
 await dialog.getByRole('button',{name:'Close opponent story'}).click();await page.getByTestId('home-create-game').click();await waitForOverlayEntry(dialog);await expect(content).toHaveJSProperty('scrollTop',0);await expect(action).toBeEnabled();await page.screenshot({path:test.info().outputPath(`friend-${size.width}.png`)});
});

test('legend follows rendered overlays and commander follows selected ownership',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 const legend=page.locator('.overlay-key');await expect(legend).toBeVisible();
 await expect(legend.locator('[data-legend-entry]:visible')).toHaveCount(0);
 const check=async()=>{await expect.poll(()=>page.evaluate(()=>{
  const legend=document.querySelector('.overlay-key');return ['command','supply','group'].every(kind=>{const drawn=kind==='group'?document.querySelector('#shell-board .group-strength-badge'):document.querySelector(`#shell-overlay-lines [data-legend-kind="${kind}"]`);return !legend.querySelector(`[data-legend-entry="${kind}"]`).hidden===Boolean(drawn);});
 })).toBe(true);};
 await page.locator('#shell-board .cell:has(.piece-token.p2)').first().click();await check();
 // Separate evaluations do not establish same-render node validity.
 // Sample current connected nodes together, keeping exact color/ownership comparisons.
 const readLegendOwnershipColors = () => {
  const root=document.querySelector('.overlay-key'),board=document.querySelector('#shell-board');
  const commander=root?.querySelector('.commander-key'),command=root?.querySelector('.command'),supply=root?.querySelector('.supply-point svg');
  const selected=board?.querySelector('.cell.selected-piece .piece-token');
  const nodes=[root,board,commander,command,supply,selected];
  if(nodes.some(node=>!node?.isConnected || node.ownerDocument!==document || node.getRootNode()!==document)
   || document.querySelector('.overlay-key')!==root || document.querySelector('#shell-board')!==board
   || ![commander,command,supply].every(node=>root.contains(node)) || !board.contains(selected))return {valid:false};
  const owner=selected.classList.contains('p2')?'P2':selected.classList.contains('p1')?'P1':null;
  const commandOwner=root.querySelector('[data-board-inspection="command"]')?.getAttribute('data-inspection-owner');
  const supplyOwner=root.querySelector('[data-board-inspection="supply"]')?.getAttribute('data-inspection-owner');
  const commanderStyle=getComputedStyle(commander),commandStyle=getComputedStyle(command),supplyStyle=getComputedStyle(supply);
  const commanderColor=commanderStyle.color,commandColor=commandStyle.color,supplyFill=supplyStyle.fill;
  const ownerToken=owner?getComputedStyle(document.documentElement).getPropertyValue(owner==='P2'?'--player-p2':'--player-p1').trim():'';
  return {valid:true,owner,commandOwner,supplyOwner,commanderColor,commandColor,supplyFill,
   colorsAgree:Boolean(commanderColor && commandColor && supplyFill) && commanderColor===commandColor && supplyFill===commanderColor,
   ownerColorsAgree:Boolean(ownerToken) && commanderStyle.getPropertyValue('--swatch-command-color').trim()===ownerToken
    && commandStyle.getPropertyValue('--swatch-command-color').trim()===ownerToken && supplyStyle.getPropertyValue('--supply-owner').trim()===ownerToken};
 };
 const checkColors=async()=>{await expect.poll(()=>page.evaluate(readLegendOwnershipColors)).toMatchObject({valid:true,owner:'P2',commandOwner:'P2',supplyOwner:'P2',colorsAgree:true,ownerColorsAgree:true});};
 await checkColors();
 await page.locator('#shell-board .cell:has(.piece-token.p1)').first().click();await check();
 await page.locator('#shell-board .cell:has(.piece-token.p1)').first().click();await check();
});

test('pending player approval keeps the invitation surface blocking until approval',async({page,browser})=>{
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const context=await browser.newContext();try{const guest=await context.newPage();await guest.goto(page.url());
 await guest.getByTestId('invite-join-player').click();
 await expect(guest.getByRole('heading',{name:'Waiting for approval',exact:true})).toBeVisible();
 await expect(guest.locator('.invite-gate-content')).toHaveAttribute('inert','');
 expect(await guest.locator('.invite-gate-content').evaluate(el=>Number(getComputedStyle(el).opacity))).toBeLessThan(.5);
 await expect(guest.getByTestId('invite-join-player')).toHaveCount(0);
 await page.locator('[data-action="accept-request"]').click();
 await expect(guest.getByRole('heading',{name:'Waiting for approval',exact:true})).toHaveCount(0);
 await expect(guest.getByTestId('game-role')).toContainText('Player 2');
 }finally{await context.close();}
});

test('home section headings stay mounted while nested loading resolves',async({page})=>{
 const responses=[];
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/shell/games?**',async route=>{const response=await route.fetch();responses.push({url:route.request().url(),status:response.status(),body:response.ok()?null:await response.text()});await gate;await route.fulfill({response});});
 try {
  await page.goto('/');await expect(page.locator('[data-home-section-root="other"] h2')).toBeVisible();
  await page.locator('[data-home-section-root="other"] h2').evaluate(el=>window.retainedSectionHeading=el);
  release();await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
  expect(responses.filter(response=>response.status!==200), 'Home reads must succeed before checking successful hydration identity').toEqual([]);
  await expect(page.locator('[data-home-section-root="other"] h2')).toBeVisible();
  expect(await page.locator('[data-home-section-root="other"] h2').evaluate(el=>el===window.retainedSectionHeading)).toBe(true);
 }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('an open flyout retains its node and animation state across game navigation',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await page.getByRole('button',{name:'Scenarios',exact:true}).click();
 const flyout=page.locator('[data-flyout="scenarios"]');await expect(flyout).toBeVisible();
 await expect.poll(()=>flyout.evaluate(el=>el.getAnimations().length)).toBe(0);
 await flyout.evaluate(el=>{window.retainedFlyout=el;window.flyoutAnimationRestarts=0;el.addEventListener('animationstart',()=>window.flyoutAnimationRestarts++);});
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();await expect(page.getByTestId('game-shell')).toBeVisible();
 await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');
 expect(await flyout.evaluate(el=>el===window.retainedFlyout)).toBe(true);
 expect(await page.evaluate(()=>window.flyoutAnimationRestarts)).toBe(0);
});

test('commander windows mask paths and center dots in real and ghost states',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/');
 const created=page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname==='/api/shell/games');
 await page.getByRole('button',{name:'Play both sides',exact:true}).click();
 expect((await created).ok()).toBe(true);
 await expect(page.getByTestId('game-shell')).toBeVisible();
 await expect(page.getByTestId('game-role')).toContainText('both players');
 // Optimistic entry can show cells while reconciliation still blocks input.
 // Test the window rendering after entry settles, with exactly one selection.
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 const source=page.locator('#shell-board .cell:has(.piece-token.p1.commander:not(.ghost))').first();await source.click();
 await expect(page.locator('#shell-board .commander.move-ghost').first()).toBeVisible();
 await expect.poll(()=>page.locator('#shell-board .cell').evaluateAll(cells=>cells.flatMap(el=>el.getAnimations()).filter(a=>a.playState==='running').length)).toBe(0);
 const states=await page.evaluate(()=>[...document.querySelectorAll('#shell-board .commander')].map(token=>{
  const cutout=token.querySelector('.commander-cutout'),floor=token.querySelector('.commander-floor'),cell=token.closest('.cell');
  const ctx=document.createElement('canvas').getContext('2d');
  const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
  const paint=node=>{const c=getComputedStyle(node);return {color:c.backgroundColor,image:c.backgroundImage,size:c.backgroundSize};};
  return {fill:rgba(getComputedStyle(cutout).fill),background:rgba(getComputedStyle(cell).backgroundColor),cellPaint:paint(cell),floorPaint:floor?paint(floor):null,floorClip:floor?getComputedStyle(floor).clipPath:null,opacity:getComputedStyle(token).opacity,cutoutOpacity:getComputedStyle(cutout).opacity};
 }));
 expect(states.length).toBeGreaterThan(1);for(const state of states){expect(state.fill[3]).toBe(0);expect(state.background[3]).toBe(255);expect(state.floorPaint).toEqual(state.cellPaint);expect(state.floorClip).not.toBe('none');expect(state.opacity).toBe('1');expect(state.cutoutOpacity).toBe('1');}
 await page.screenshot({path:test.info().outputPath('commander-masked-window.png')});
});

test('scroll viewport stays inside clipped modal corners when enlarged',async({page})=>{
 // Effective viewport at high browser zoom, where deliberate inner scrolling is needed.
 await page.setViewportSize({width:450,height:400});await page.goto('/');await page.getByTestId('home-create-game').click();
 await page.addStyleTag({content:'.story-modal {font-size:125%;} .opponent-story-copy {font-size:22px!important;}'});
 const dialog=page.getByRole('dialog',{name:'Friend',exact:true}),content=dialog.locator('.modal-content');
 await expect.poll(()=>content.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await waitForOverlayEntry(dialog);
 const geometry=await dialog.evaluate(el=>{const outer=el.getBoundingClientRect(),inner=el.querySelector('.modal-content').getBoundingClientRect();return {top:inner.top-outer.top,bottom:outer.bottom-inner.bottom,left:inner.left-outer.left,right:outer.right-inner.right};});
 expect(geometry.top).toBeGreaterThanOrEqual(24);expect(geometry.bottom).toBeGreaterThanOrEqual(24);expect(geometry.left).toBeGreaterThanOrEqual(10);expect(geometry.right).toBeGreaterThanOrEqual(10);
 await content.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(dialog.getByRole('button',{name:'Start a friend game'})).toBeInViewport();await expect(dialog.getByRole('button',{name:'Close opponent story'})).toBeInViewport();
});


// One real consumer journey; visual/reference acceptance uses the attached originals.
test('all approved artwork consumers fit and natural story motion survives bidirectional interruption',async({page},info)=>{
 const evidence={scenes:[],portraits:[],motion:[],gaps:[],creates:[]},errors=[];let primary,hasPrimary=false;
 const store=async()=>{const file=info.outputPath('artwork-consumers-and-natural-motion.json');await writeFile(file,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});await info.attach('artwork consumers and natural motion',{path:file,contentType:'application/json'});};
 const screenshot=async(name)=>{const file=info.outputPath(name+'.png'),before=await page.evaluate(()=>performance.now());await page.screenshot({path:file,animations:'allow'});const after=await page.evaluate(()=>performance.now());(evidence.originals??=[]).push({name,file,before,after,clock:'Actual page performance.now brackets; no exact capture-frame timestamp claim'});await info.attach(name,{path:file,contentType:'image/png'});};
 const onRequest=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/shell/games')evidence.creates.push({method:'POST',path:'/api/shell/games'});};
 const onPageError=error=>errors.push(error.message);page.on('request',onRequest);page.on('pageerror',onPageError);
 const expected={babs:['babs-1-discovery','babs-2-rematch','babs-3-research'],tau:['tau-1-gardens','tau-2-connections','tau-3-patience'],horus:['horus-1-watchtower','horus-2-studying','horus-3-opinion']};
 const assets=JSON.parse(await readFile(new URL('../../apps/web/assets/opponents/manifest.json',import.meta.url),'utf8'));
 expect(assets).toHaveLength(14);
 evidence.qualifiedArtifactIdentity={source:'Existing independent14delivery-hash proof; this nativecase proves actualconsumer binding/decoding/fit, not a second artifact hash pass.',assets:assets.map(({id,src,sha256})=>({id,src,sha256}))};
 const settled=async(dialog)=>{
  await expect.poll(()=>dialog.locator('[data-story-image]').evaluateAll(images=>images.flatMap(image=>image.getAnimations()).filter(animation=>animation.playState==='running'||animation.playState==='pending').length)).toBe(0);
 };
 const choose=async(dialog,name,index)=>{await dialog.getByRole('button',{name,exact:true}).click();await expect(dialog.locator('[data-story-image]').nth(index)).toHaveAttribute('data-active','true');await settled(dialog);};
 const imageState=locator=>locator.evaluate(img=>{const r=img.getBoundingClientRect(),p=img.parentElement.getBoundingClientRect(),s=getComputedStyle(img);return{src:new URL(img.currentSrc||img.src).pathname,complete:img.complete,width:img.naturalWidth,height:img.naturalHeight,fit:s.objectFit,opacity:s.opacity,rect:r.toJSON(),parent:p.toJSON(),viewport:{width:innerWidth,height:innerHeight},overflow:img.parentElement.scrollWidth-img.parentElement.clientWidth};});
 const verifyImage=async(locator,id)=>{await expect.poll(()=>locator.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);const state=await imageState(locator);expect(state.src).toBe('/assets/opponents/'+id+'.webp');expect(state.fit).toBe('contain');expect(state.width).toBeGreaterThan(0);expect(state.height).toBeGreaterThan(0);expect(state.rect.width).toBeGreaterThan(0);expect(state.rect.height).toBeGreaterThan(0);expect(state.rect.left).toBeGreaterThanOrEqual(state.parent.left-1);expect(state.rect.right).toBeLessThanOrEqual(state.parent.right+1);expect(state.rect.top).toBeGreaterThanOrEqual(state.parent.top-1);expect(state.rect.bottom).toBeLessThanOrEqual(state.parent.bottom+1);expect(state.rect.left).toBeGreaterThanOrEqual(-1);expect(state.rect.right).toBeLessThanOrEqual(state.viewport.width+1);expect(state.rect.top).toBeGreaterThanOrEqual(-1);expect(state.rect.bottom).toBeLessThanOrEqual(state.viewport.height+1);return state;};
 const stationary=async(dialog,before)=>{const after=await dialog.locator('.opponent-story-copy,.story-heading,.story-modal-actions,[data-story-step]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));expect(after).toHaveLength(before.length);for(let i=0;i<after.length;i++)for(const key of ['x','y','width','height'])expect(after[i][key]).toBeCloseTo(before[i][key],0);};
 try{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('home-create-game')).toBeEnabled();
  for(const id of ['babs','tau','horus'])evidence.portraits.push(await verifyImage(page.locator('button[data-opponent="'+id+'"]').locator('img'),id+'-portrait'));
  evidence.portraits.push(await verifyImage(page.getByTestId('home-create-game').locator('img'),'friend-portrait'));
  for(const [id,scenes] of Object.entries(expected)){
   await page.locator('button[data-opponent="'+id+'"]').click();const dialog=page.getByRole('dialog',{name:{babs:'Babs',tau:'Tau',horus:'Horus'}[id],exact:true});await expect(dialog).toBeVisible();await waitForOverlayEntry(dialog);
   // Native manual selection stops the normal carousel; no clock or animation override.
   await choose(dialog,'Previous story image',2);
   await choose(dialog,'Next story image',0);
   const fixed=await dialog.locator('.opponent-story-copy,.story-heading,.story-modal-actions,[data-story-step]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
   for(let index=0;index<3;index++){
    if(index)await choose(dialog,'Next story image',index);
    const image=dialog.locator('[data-story-image][data-active="true"]');const state=await verifyImage(image,scenes[index]);expect(state.width).toBe(1200);expect(state.height).toBe(800);expect(state.rect.width/state.rect.height).toBeCloseTo(1.5,2);expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await stationary(dialog,fixed);evidence.scenes.push({id:scenes[index],...state});await screenshot(scenes[index]);
   }
   await choose(dialog,'Previous story image',1);await choose(dialog,'Previous story image',0);
   if(id==='babs'){
    // Passive bounded observation starts with real pointer input. It never changes time,
    // replaces animate(), modifies styles, or submits gameplay.
    await dialog.evaluate(el=>{
     const images=[...el.querySelectorAll('[data-story-image]')],nodes=[...el.querySelectorAll('.opponent-story-copy,.story-heading,.story-modal-actions,[data-story-step]')];
     const observation={frames:[],inputs:[],dropped:0,done:false};window.__artworkNativeObservation=observation;let started=false,frames=0;
     const rect=node=>node.getBoundingClientRect().toJSON();
     const sample=()=>{if(observation.done)return;if(++frames>600){observation.dropped++;observation.done=true;return;}observation.frames.push({at:performance.now(),images:images.map(image=>{const s=getComputedStyle(image);return{src:new URL(image.currentSrc||image.src).pathname,active:image.dataset.active,opacity:Number(s.opacity),transform:s.transform,filter:s.filter,rect:rect(image),animations:image.getAnimations().map(animation=>({time:animation.currentTime,duration:animation.effect.getTiming().duration,playState:animation.playState}))};}),fixed:nodes.map(rect),clips:[el.querySelector('.story-art'),el.querySelector('.modal-content'),el].map(node=>({rect:rect(node),overflowX:getComputedStyle(node).overflowX,overflowY:getComputedStyle(node).overflowY})),shade:el.querySelectorAll('.story-turn-shade').length});requestAnimationFrame(sample);};
     const input=event=>{const button=event.target.closest('[data-story-step]');if(!button)return;observation.inputs.push({at:performance.now(),step:Number(button.dataset.storyStep),activeAnimations:images.flatMap(image=>image.getAnimations()).map(a=>({time:a.currentTime,duration:a.effect.getTiming().duration,playState:a.playState}))});if(!started){started=true;requestAnimationFrame(sample);}};
     el.addEventListener('pointerdown',input,true);observation.stop=()=>{observation.done=true;el.removeEventListener('pointerdown',input,true);};
    });
    for(const direction of [1,-1]){
     const first=direction===1?'Next story image':'Previous story image',second=direction===1?'Previous story image':'Next story image';
     await dialog.getByRole('button',{name:first,exact:true}).click();
     const early=await dialog.evaluate(()=>new Promise((resolve,reject)=>{const observation=window.__artworkNativeObservation,inputAt=observation.inputs.at(-1).at;let waited=0;const read=()=>{const frame=observation.frames.find(frame=>frame.at>=inputAt&&frame.images.some(image=>image.animations.some(a=>a.playState==='running'&&a.time>0&&a.time<a.duration*.2)));if(frame){resolve({frame,observedAt:performance.now(),framesWaited:waited});return;}if(++waited>=60||observation.done){reject(new Error('No qualifying early native frame within passive60frame bound'));return;}requestAnimationFrame(read);};read();}));
     const before=early.frame;await screenshot('natural-'+direction+'-early');
     const interrupted=await dialog.evaluate(el=>[...el.querySelectorAll('[data-story-image]')].some(image=>image.getAnimations().some(a=>a.playState==='running'&&a.currentTime<a.effect.getTiming().duration)));
     if(!interrupted)evidence.gaps.push('Direction '+direction+': native second input could not interrupt an active first animation.');
     await choose(dialog,second,0);const actualSecondInput=await dialog.evaluate(()=>window.__artworkNativeObservation.inputs.at(-1));if(!actualSecondInput.activeAnimations.some(a=>a.playState==='running'&&a.time<a.duration))evidence.gaps.push('Direction '+direction+': actual second pointerdown missed active first animation.');await stationary(dialog,fixed);evidence.motion.push({direction,earlyObservation:early,beforeScreenshot:before,interrupted,final:await imageState(dialog.locator('[data-story-image][data-active="true"]'))});await screenshot('natural-'+direction+'-settled');
    }
    const observation=await dialog.evaluate(()=>{const o=window.__artworkNativeObservation;o.stop();return{frames:o.frames,inputs:o.inputs,dropped:o.dropped};});evidence.motionFrames=observation;expect(observation.dropped).toBe(0);
    const violations=[];for(const frame of observation.frames){if(frame.shade)violations.push({at:frame.at,kind:'unexpected shade'});for(const image of frame.images)if(image.animations.length&&(image.opacity!==1||image.filter.includes('brightness')))violations.push({at:frame.at,kind:'animated image opacity/filter',src:image.src,opacity:image.opacity,filter:image.filter});for(let i=0;i<fixed.length;i++)for(const key of ['x','y','width','height'])if(Math.abs(frame.fixed[i][key]-fixed[i][key])>=.5)violations.push({at:frame.at,kind:'copy/control moved',node:i,key,before:fixed[i][key],after:frame.fixed[i][key]});}expect(violations).toEqual([]);
    for(const transition of evidence.motion)expect(transition.final.src).toBe('/assets/opponents/babs-1-discovery.webp');
    // Returning to the original scene reverses its actual path. It must not
    // replay a full outgoing/incoming excursion merely to restore that scene.
    const discovery=evidence.scenes.find(scene=>scene.id==='babs-1-discovery');
    const returnEnvelopes=[];
    for(const index of [1,3]){
     const input=observation.inputs[index],end=observation.inputs[index+1]?.at??Infinity;
     const before=observation.frames.filter(frame=>frame.at<=input.at).at(-1)?.images.find(image=>image.src.endsWith('/babs-1-discovery.webp'));
     // requestAnimationFrame observes compositor positions at frame boundaries.
     // Keep a bounded, resolution-scaled compositor sampling allowance. A
     // near-home return stays within 10% at this desktop width; an already
     // displaced reversal gets only 4% more travel. Either remains far below
     // the full outgoing/incoming excursion, so a replay still fails decisively.
     const samplingTolerance=Math.max(16,discovery.rect.width*.04);
     const allowance=Math.max(discovery.rect.width*.06,Math.abs((before?.rect.x??discovery.rect.x)-discovery.rect.x))+samplingTolerance;
     const selected=observation.frames.filter(frame=>frame.at>=input.at&&frame.at<end).flatMap(frame=>frame.images.filter(image=>image.active==='true'&&image.src.endsWith('/babs-1-discovery.webp')).map(image=>({at:frame.at,x:image.rect.x})));
     expect(selected.length).toBeGreaterThan(0);
     returnEnvelopes.push({inputAt:input.at,direction:input.step,homeX:discovery.rect.x,samplingTolerance,allowance,maxDeparture:Math.max(...selected.map(image=>Math.abs(image.x-discovery.rect.x)))});
    }
    evidence.returnEnvelopes=returnEnvelopes;
    for(const envelope of returnEnvelopes)expect(envelope.maxDeparture).toBeLessThanOrEqual(envelope.allowance);

    evidence.visualReview={status:'PENDING_INDEPENDENT_REVIEW',questions:['Outgoing first-frame visibility and opacity during anticipation','Actual clip envelopes through clearance','Direction reversal and interruption continuity'],limit:'Raw geometry alone is not raster visibility proof; absence of a qualifying actual original remains an acceptance gap.'};
   }
   await dialog.getByRole('button',{name:'Close opponent story',exact:true}).click();await expect(dialog).not.toBeVisible();
  }
  await page.getByTestId('home-create-game').click();const friend=page.getByRole('dialog',{name:'Friend',exact:true});await expect(friend).toBeVisible();await waitForOverlayEntry(friend);await expect(friend.locator('img')).toHaveCount(1);await expect(friend.locator('[data-story-step]')).toHaveCount(0);evidence.friend=await verifyImage(friend.locator('img'),'friend-introduction');await friend.getByRole('button',{name:'Close opponent story',exact:true}).click();
  expect(evidence.creates).toEqual([]);expect(errors).toEqual([]);expect(evidence.gaps).toEqual([]);expect(evidence.scenes).toHaveLength(9);evidence.nativeWorkflow='PASS_WITH_EXPLICIT_VISUAL_REVIEW_PENDING';
 }catch(error){hasPrimary=true;primary=error;}finally{
  evidence.pageErrors=errors;page.off('request',onRequest);page.off('pageerror',onPageError);evidence.secondaryErrors=[];
  try{const raw=await page.evaluate(()=>{const o=window.__artworkNativeObservation;if(!o)return null;const snapshot={frames:o.frames,inputs:o.inputs,dropped:o.dropped};o.stop();return snapshot;});if(raw&&!evidence.motionFrames)evidence.motionFrames=raw;}catch(error){evidence.secondaryErrors.push({stage:'observer-capture-and-stop',name:error?.name??typeof error,message:String(error)});if(!hasPrimary){hasPrimary=true;primary=error;}}
  try{await store();}catch(error){evidence.secondaryErrors.push({stage:'evidence-persist',name:error?.name??typeof error,message:String(error)});if(!hasPrimary){hasPrimary=true;primary=error;}try{await info.attach('artwork secondary evidence failure',{body:Buffer.from(JSON.stringify(evidence)),contentType:'application/json'});}catch(secondary){console.error('Secondary artwork attachment failure:',secondary);}}
  if(hasPrimary)throw primary;
 }
});
