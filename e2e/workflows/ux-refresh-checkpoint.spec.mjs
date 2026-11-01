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
 await page.reload();await expect(page.getByRole('button',{name:'Enable sound',exact:true})).toBeVisible();
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
 await expect(ownProfile).toHaveText('You');await expect(ownProfile).toHaveAccessibleName('You, Red, Connected');
 const supply=await page.locator('.supply-point-marker.supply-point-p1').first().evaluate(el=>({core:getComputedStyle(el.querySelector('svg')).fill}));
 expect(supply.core).toBe('rgb(194, 69, 47)');
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
 await page.locator('button[data-opponent="babs"]').click();const dialog=page.getByRole('dialog',{name:'Babs',exact:true});await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Next story image'})).toBeVisible();
 await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:test.info().outputPath('babs-phone.png')});
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

test('Players viewer invitation preserves focus through pending copy and failure',async({page})=>{
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
   for(const animation of held.frames){expect(animation.duration).toBe(760);for(const frame of animation.frames)expect(frame.opacity).toBe(1);}
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

for(const outcome of ['success','failure'])test(`Players restores the selected invitation role after delayed clipboard ${outcome}`,async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise((resolve,reject)=>{window.completeClipboard=resolve;window.failClipboard=()=>reject(new Error('Clipboard unavailable'));})}}));
 await page.goto('/');await page.getByTestId('home-create-game').click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();await page.getByRole('button',{name:'Close invite',exact:true}).click();
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
 expect(await legend.locator('.commander-key').evaluate(el=>getComputedStyle(el).color)).toBe(await legend.locator('.command').evaluate(el=>getComputedStyle(el).color));
 expect(await legend.locator('.supply-point svg').evaluate(el=>getComputedStyle(el).fill)).toBe(await legend.locator('.commander-key').evaluate(el=>getComputedStyle(el).color));
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
  const cutout=token.querySelector('.commander-cutout'),cell=token.closest('.cell');
  const ctx=document.createElement('canvas').getContext('2d');
  const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
  return {fill:rgba(getComputedStyle(cutout).fill),background:rgba(getComputedStyle(cell).backgroundColor),opacity:getComputedStyle(token).opacity,cutoutOpacity:getComputedStyle(cutout).opacity};
 }));
 expect(states.length).toBeGreaterThan(1);for(const state of states){expect(state.fill).toEqual(state.background);expect(state.opacity).toBe('1');expect(state.cutoutOpacity).toBe('1');}
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
