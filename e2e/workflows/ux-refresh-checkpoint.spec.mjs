import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('guest home, tactile toggle, Babs modal and original board remain usable',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Continue playing'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();
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
 await page.getByTestId('home-create-game').locator('img').click();
 await expect(page.getByRole('dialog',{name:'Invite a friend'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByTestId('game-board')).toBeVisible();
 const legend=page.locator('.overlay-key > span');
 await expect(legend).toHaveText(['Commander','Supply point','Group strength','Command line','Supply line']);
 const cells=await legend.evaluateAll(items=>items.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
 expect(cells[3].x).toBe(cells[0].x);expect(cells[4].x).toBe(cells[1].x);
 expect(cells[2].y).toBe(cells[0].y);expect(cells[3].y).toBeGreaterThan(cells[0].y);
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 await expect(page.locator('[data-action="guest-profile"]').first()).toHaveText('Guest player');
 const supply=await page.locator('.supply-point-marker.supply-point-p1').first().evaluate(el=>({core:getComputedStyle(el.querySelector('svg')).fill}));
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
 let fulfilled=0;let release;const gate=new Promise(r=>release=r);await page.route('**/api/shell/games?**',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});fulfilled++;});
 await page.goto('/');const babs=page.locator('button[data-opponent="babs"]');await expect(babs).toBeVisible();await babs.scrollIntoViewIfNeeded();const box=await babs.boundingBox();
 await babs.evaluate(el=>window.pressedOpponent=el);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();release();await expect.poll(()=>fulfilled).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.pressedOpponent.isConnected)).toBe(true);await page.mouse.up();await expect(page.getByRole('dialog',{name:'Babs',exact:true})).toBeVisible();await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 expect(await page.evaluate(()=>window.audioCues.length)).toBe(2);await page.unrouteAll({behavior:'ignoreErrors'});
});

test('top invitation preserves the selected role through pending copy and failure',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise((resolve,reject)=>{window.finishCopy=resolve;window.failCopy=reject;})}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();
 const modal=page.getByRole('dialog',{name:'Invite a friend'});await expect(modal).toBeVisible();
 await expect.poll(()=>modal.evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(250);
 const background=page.locator('.invite-gate-content');await expect(background).toHaveAttribute('inert','');
 await expect.poll(()=>page.evaluate(()=>{const surface=document.querySelector('.invite-gate-modal');const behind=document.querySelector('.invite-gate-content');return surface && behind ? behind.getBoundingClientRect().top-surface.getBoundingClientRect().bottom : -1;})).toBeGreaterThan(0);
 const viewer=modal.locator('[data-invite-role="viewer"]');await viewer.focus();await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>typeof window.finishCopy)).toBe('function');
 await page.evaluate(()=>{window.finishCopy();delete window.failCopy;});await expect(viewer).not.toHaveAttribute('aria-busy','true');await expect(viewer).toBeFocused();
 await page.keyboard.press('Enter');await expect.poll(()=>page.evaluate(()=>typeof window.failCopy)).toBe('function');
 await page.evaluate(()=>window.failCopy(new Error('Clipboard denied')));
 await expect(modal.getByRole('textbox',{name:'Invitation link'})).toBeVisible();await expect(viewer).toBeFocused();
 await expect(modal.getByRole('textbox',{name:'Invitation link'})).toHaveValue(/as=viewer/);
});

test('carousel keeps cycling under hover and focus but stops after a caret',async({page})=>{
 await page.clock.install();await page.goto('/');await page.locator('button[data-opponent="babs"]').click();
 const modal=page.getByRole('dialog',{name:'Babs',exact:true});await expect(modal).toBeVisible();
 await modal.locator('.story-art').hover();await modal.getByRole('button',{name:'Next story image'}).focus();
 await page.clock.fastForward(3100);await expect(modal.locator('[data-story-image]').nth(1)).toHaveAttribute('data-active','true');
 await modal.getByRole('button',{name:'Next story image'}).click();
 await page.clock.fastForward(6500);await expect(modal.locator('[data-story-image]').nth(2)).toHaveAttribute('data-active','true');
});

test('board has four turn-colored corners, neutral surroundings and a light hover wash',async({page})=>{
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const board=page.locator('[data-shell-panel="board"]');await expect(board).toHaveAttribute('data-turn-side','red');
 const gradients=await board.evaluate(el=>getComputedStyle(el,'::before').backgroundImage);
 expect(gradients.match(/linear-gradient/g).length).toBeGreaterThanOrEqual(4);
 const neutral=await page.locator('[data-game-panel="join"]').evaluate(el=>getComputedStyle(el).getPropertyValue('--corner-start').trim());expect(neutral).toBe('transparent');
 await expect(board.getByRole('img',{name:'Red commander',exact:true})).toBeVisible();
 const cell=board.locator('.cell').filter({has:page.locator('.piece-token.p1')}).first();await cell.hover();
 const rgb=await cell.evaluate(el=>{const c=document.createElement('canvas').getContext('2d');c.fillStyle=getComputedStyle(el).backgroundColor;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].slice(0,3);});expect(Math.min(...rgb)).toBeGreaterThan(220);
});

test('modal size animation ends at its natural height without a final snap',async({page})=>{
 await page.setViewportSize({width:1440,height:1300});
 await page.goto('/');await page.locator('button[data-opponent="babs"]').click();
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
 await expect.poll(()=>sound.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(37, 43, 45, 0.05)');
 expect(await sound.evaluate(el=>getComputedStyle(el).boxShadow)).toBe('none');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await expect.poll(()=>sound.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('copy feedback keeps Players height stable and preserves keyboard focus',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const panel=page.locator('[data-game-panel="join"]');const copy=panel.locator('[data-invite-role="blue"]');await copy.focus();
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>panel.evaluate(el=>el.getAnimations().length)).toBe(0);
 const before=(await panel.boundingBox()).height;await page.keyboard.press('Enter');
 await expect(panel.getByRole('status')).toHaveText('Link copied');await expect(copy).toBeFocused();
 await expect(panel.getByTestId('pending-invitation')).toHaveText('Awaiting player');
 await expect(panel.getByTestId('participant-player-1').getByRole('img',{name:'Connected',exact:true})).toBeVisible();
 expect(Math.abs((await panel.boundingBox()).height-before)).toBeLessThan(2);
 await expect(panel.getByRole('status')).toHaveText('');expect(Math.abs((await panel.boundingBox()).height-before)).toBeLessThan(2);
 await expect(page.getByText('Commander',{exact:true})).toBeVisible();
});

test('storybook turn animates artwork while story copy stays fixed',async({page})=>{
 await page.goto('/');await page.locator('button[data-opponent="babs"]').click();
 const modal=page.getByRole('dialog',{name:'Babs',exact:true});await expect(modal).toBeVisible();
 const copy=modal.locator('.opponent-story-copy');const before=await copy.boundingBox();
 await modal.getByRole('button',{name:'Next story image'}).click();
 await expect(modal.locator('[data-story-image]').nth(1)).toHaveAttribute('data-active','true');
 expect(await modal.locator('.story-turn-shade').evaluate(el=>el.getAnimations().length)).toBeGreaterThan(0);
 expect((await copy.boundingBox()).y).toBeCloseTo(before.y,0);
});

for(const outcome of ['success','failure'])test(`Players restores the selected invitation role after delayed clipboard ${outcome}`,async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise((resolve,reject)=>{window.completeClipboard=resolve;window.failClipboard=()=>reject(new Error('Clipboard unavailable'));})}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const panel=page.locator('[data-game-panel="join"]');const viewer=panel.locator('[data-invite-role="viewer"]');await viewer.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>window.completeClipboard);await expect(viewer).toHaveAttribute('aria-busy','true');
 await page.evaluate(outcome=>outcome==='success'?window.completeClipboard():window.failClipboard(),outcome);
 await expect(viewer).not.toHaveAttribute('aria-busy','true');await expect(viewer).toBeFocused();
 if(outcome==='failure')await expect(panel.getByRole('textbox',{name:'Invitation link'})).toBeVisible();
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
 await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
 const card=page.locator('button[data-opponent="horus"]');await card.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>scrollY);expect(before).toBeGreaterThan(0);
 await card.click();await expect(page.getByRole('dialog',{name:'Horus',exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before);
 await page.keyboard.press('Escape');await expect(card).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(before);
 });

test('game sections share heading weight and compact player presence',async({page})=>{
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');
 await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
 const row=page.getByTestId('participant-player-1');await expect(row.getByRole('img',{name:'Connected',exact:true})).toBeVisible();
 const weights=await page.locator('.panel h2').evaluateAll(items=>items.map(el=>getComputedStyle(el).fontWeight));
 expect(weights.length).toBeGreaterThan(2);expect(new Set(weights).size).toBe(1);
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.locator('.panel').evaluateAll(items=>items.reduce((sum,el)=>sum+el.getAnimations().length,0))).toBe(0);
 await page.screenshot({path:test.info().outputPath('game-refined-desktop.png')});
});
