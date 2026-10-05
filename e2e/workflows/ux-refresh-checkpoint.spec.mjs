import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('guest home, tactile toggle, Babs modal and original board remain usable',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Continue playing'})).toBeVisible();
 const sound=page.getByRole('button',{name:'Mute sound',exact:true});
 await sound.locator('svg').click();
 await expect(page.getByRole('button',{name:'Enable sound',exact:true})).toBeFocused();
 await page.reload();await expect(page.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();
 await page.locator('button[data-opponent="babs"]').click();
 const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Play Babs'})).toBeDisabled();
 await expect(page.locator('.story-presentation-board')).toBeAttached();
 await expect(dialog.locator('[data-story-position], [data-story-pause]')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Next story image'}).click();
 await expect(dialog.locator('[data-story-image]').nth(1)).toHaveAttribute('data-active','true');
 await page.screenshot({path:test.info().outputPath('babs-desktop.png')});
 const a11y=await new AxeBuilder({page}).include('dialog[open]').analyze();expect(a11y.violations).toEqual([]);
 await page.keyboard.press('Escape');await expect(page.locator('button[data-opponent="babs"]')).toBeFocused();
 await expect(page.locator('.story-presentation-board')).toHaveCount(0);
 await page.getByTestId('home-create-game').locator('svg').click();
 await expect(page.getByRole('dialog',{name:'Invite a friend'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByTestId('game-board')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 await expect(page.locator('[data-action="guest-profile"]').first()).toHaveText('You');
 const supply=await page.locator('.supply-point-marker.supply-point-p1').first().evaluate(el=>({core:getComputedStyle(el,'::before').backgroundColor,expected:getComputedStyle(el).getPropertyValue('--player-p1').trim()}));
 expect(supply.core).toBe('rgb(194, 69, 47)');
 await page.screenshot({path:test.info().outputPath('game-desktop.png')});
 await page.goBack();await expect(page.getByRole('heading',{name:'Continue playing'})).toBeVisible();
 await expect(page.getByTestId('home-create-game')).toBeEnabled();expect(errors).toEqual([]);
});

test('phone home and Babs carets fit without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.goto('/');
 await expect(page.getByRole('button',{name:'Mute sound',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('home-phone.png')});
 await page.locator('button[data-opponent="babs"]').click();const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Next story image'})).toBeVisible();
 await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('babs-phone.png')});
});

test('Friend invite remains open after copy, viewer intent survives arrival, and Back dismisses it',async({page,browser})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedInvite=text;}}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();
 const modal=page.getByRole('dialog',{name:'Invite a friend'});await expect(modal).toBeVisible();
 await modal.getByRole('button',{name:'Invite someone to view',exact:true}).click();
 await expect(modal.getByRole('status')).toHaveText('Link copied');await expect(modal).toBeVisible();
 const link=await page.evaluate(()=>window.copiedInvite);expect(link).toContain('as=viewer');
 const context=await browser.newContext();const guest=await context.newPage();await guest.goto(link);
 await expect(guest.getByRole('heading',{name:'Watch this game'})).toBeVisible();await expect(guest.getByTestId('invite-join-player')).toBeHidden();
 await guest.getByTestId('invite-join-viewer').click();await expect(guest.getByTestId('game-role')).toContainText('Viewer');await context.close();
 await page.goBack();await expect(modal).not.toBeVisible();await expect(page.getByRole('heading',{name:'Continue playing'})).toBeVisible();
});

test('home refresh preserves a pressed opponent and first home sound starts without waiting for navigation',async({page})=>{
 await page.addInitScript(()=>{window.audioCues=[];window.AudioContext=class{state='running';currentTime=0;sampleRate=8000;destination={};resume(){return Promise.resolve();}suspend(){return Promise.resolve();}createBuffer(_,n){return{getChannelData:()=>new Float32Array(n)}}node(){return{frequency:{},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){window.audioCues.push(performance.now())},stop(){}}}createBufferSource(){return this.node()}createBiquadFilter(){return this.node()}createGain(){return this.node()}createOscillator(){return this.node()}};});
 let release;const gate=new Promise(r=>release=r);await page.route('**/api/shell/games?**',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});});
 await page.goto('/');const babs=page.locator('button[data-opponent="babs"]');await expect(babs).toBeVisible();await babs.scrollIntoViewIfNeeded();const box=await babs.boundingBox();
 await babs.evaluate(el=>window.pressedOpponent=el);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();release();await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 expect(await page.evaluate(()=>window.pressedOpponent.isConnected)).toBe(true);await page.mouse.up();await expect(page.getByRole('dialog',{name:'Babs',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.audioCues.length)).toBe(2);await page.unrouteAll({behavior:'ignoreErrors'});
});
