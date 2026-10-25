import {test,expect} from '@playwright/test';
test.use({video:'on'});
const open = async page => { await page.goto('/browser-integration/support/notifications.html'); await page.waitForFunction(()=>window.fixtureReady); };

test('header updates retain notification identity, focus, details, and pulse timeline', async({page})=>{
  await open(page);
  const before = await page.evaluate(async()=>{
    const card=document.querySelector('[data-key="processing"]');
    const surface=card.querySelector('.shell-game-alert');
    const pulse=surface.getAnimations({subtree:true}).find(a=>a.animationName==='notification-processing');
    if(!pulse)throw Error('Pulse missing');
    await pulse.ready;pulse.pause();pulse.currentTime=1200;
    card.querySelector('button').focus();
    card.querySelector('details').open=false;
    window.saved={card,surface,pulse,button:document.activeElement,details:card.querySelector('details')};
    return surface.getBoundingClientRect().toJSON();
  });
  for(let i=0;i<5;i++)await page.evaluate(i=>window.update([{key:'processing',body:`Recording move ${i}`}],`Righelt ${i}`),i);
  const result=await page.evaluate(()=>{
    const {card,surface,pulse,button,details}=window.saved;
    return {card:card===document.querySelector('[data-key="processing"]'),surface:surface===card.firstElementChild,focus:document.activeElement===button,details:details===card.querySelector('details'),open:details.open,time:pulse.currentTime,animations:surface.getAnimations({subtree:true}).filter(a=>a.animationName==='notification-processing').length,rect:surface.getBoundingClientRect().toJSON(),textOpacity:getComputedStyle(surface.querySelector('.shell-game-alert-copy')).opacity};
  });
  expect(result.card).toBe(true);expect(result.surface).toBe(true);expect(result.focus).toBe(true);expect(result.details).toBe(true);expect(result.open).toBe(false);
  expect(result.time).toBe(1200);expect(result.animations).toBe(1);expect(result.textOpacity).toBe('1');expect(result.rect.height).toBe(before.height);
});

test('stack changes and content replacement preserve an existing active notice',async({page})=>{
  await open(page);
  await page.evaluate(()=>{window.savedCard=document.querySelector('[data-key="processing"]');window.update([{key:'other',activity:'waiting'},{key:'processing'}]);});
  await expect(page.locator('[data-key="processing"]')).toHaveClass(/is-active/);
  await page.evaluate(()=>window.cycle([{key:'other',activity:'waiting'},{key:'processing'}]));
  await expect(page.locator('[data-key="other"]')).toHaveClass(/is-active/);
  await page.evaluate(()=>window.update([{key:'third',activity:'static'},{key:'other',activity:'waiting'},{key:'processing'}]));
  await expect(page.locator('[data-key="other"]')).toHaveClass(/is-active/);
  expect(await page.evaluate(()=>window.replaceMain([{key:'other',activity:'waiting'},{key:'processing'}]))).toBe(true);
  expect(await page.evaluate(()=>window.savedCard===document.querySelector('[data-key="processing"]'))).toBe(true);
});

test('a tall inactive notice exposes only its surface behind a short active notice',async({page},info)=>{
  await page.setViewportSize({width:390,height:740});await open(page);
  const items=[{key:'tall',body:'<p>Recovery needs attention</p><p>Earlier saved details remain available</p><p>One more line of recovery context</p>',action:'<button>Reload game</button>'},{key:'short',body:'Saving the move is taking longer than usual',activity:'static',action:''}];
  await page.evaluate(items=>{window.update(items);window.savedTall=document.querySelector('[data-key="tall"]');window.savedButton=window.savedTall.querySelector('button');window.savedPulse=window.savedTall.querySelector('.shell-game-alert').getAnimations({subtree:true}).find(a=>a.animationName==='notification-processing');},items);
  const tall=page.locator('[data-key="tall"]'),short=page.locator('[data-key="short"]');
  await expect(tall).toHaveClass(/is-active/);
  await page.evaluate(items=>window.cycle(items),items);
  await expect(short).toHaveClass(/is-active/);
  await expect(tall.getByRole('button',{name:'Reload game',includeHidden:true})).toBeHidden();
  await expect(tall.locator('.shell-game-alert-copy')).toBeHidden();
  const clipped=await tall.evaluate(el=>({overflow:getComputedStyle(el).overflow,height:el.clientHeight,activeHeight:el.parentElement.querySelector('.is-active').clientHeight}));
  expect(clipped.overflow).toBe('hidden');expect(clipped.height).toBeLessThanOrEqual(clipped.activeHeight+1);
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{}))));
  await page.screenshot({path:info.outputPath('short-active-tall-inactive.png')});
  await page.evaluate(items=>window.cycle(items),items);
  await expect(tall.getByRole('button',{name:'Reload game'})).toBeVisible();
  expect(await page.evaluate(()=>window.savedTall===document.querySelector('[data-key="tall"]')&&window.savedButton===window.savedTall.querySelector('button')&&window.savedTall.querySelector('.shell-game-alert').getAnimations({subtree:true}).includes(window.savedPulse))).toBe(true);
});

for(const activity of ['processing','waiting','static'])test(`${activity} has the intended surface motion and reduced-motion treatment`,async({page})=>{
  await open(page);await page.evaluate(activity=>window.update([{key:'processing',activity}]),activity);
  const surface=page.locator('.shell-game-alert');
  const motion=await surface.evaluate(el=>({name:getComputedStyle(el,'::after').animationName,duration:getComputedStyle(el,'::after').animationDuration,opacity:getComputedStyle(el.querySelector('.shell-game-alert-copy')).opacity,width:getComputedStyle(el,'::after').width,surfaceWidth:el.getBoundingClientRect().width}));
  expect(Number.parseFloat(motion.width)).toBeCloseTo(motion.surfaceWidth,0);
  expect(motion.opacity).toBe('1');expect(motion.name).toBe(activity==='static'?'none':`notification-${activity}`);
  if(activity!=='static')expect(motion.duration).toBe(activity==='waiting'?'4s':'2.4s');
  await page.emulateMedia({reducedMotion:'reduce'});expect(await surface.evaluate(el=>getComputedStyle(el,'::after').animationName)).toBe('none');
});

test('loading facets have crisp solid colors, no blurred or gradient sweep',async({page},info)=>{
  await open(page);
  const result=await page.evaluate(()=>{
    const sweep=document.querySelector('.reconnect-background');
    return ['::before','::after'].map(pseudo=>{const s=getComputedStyle(sweep,pseudo);return {image:s.backgroundImage,color:s.backgroundColor,clip:s.clipPath,animation:s.animationName,filter:s.filter};});
  });
  for(const facet of result){expect(facet.image).toBe('none');expect(facet.clip).toContain('polygon');expect(facet.animation).toBe('reconnect-sweep');expect(facet.filter).toBe('none');}
  expect(result[0].color).not.toBe(result[1].color);
  await page.waitForTimeout(250);
  await page.evaluate(()=>document.querySelector('.reconnect-background').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=1200;}));
  await page.screenshot({path:info.outputPath('notification-and-facets.png')});
});


test('record a complete processing and waiting pulse for visual review',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await page.evaluate(()=>window.update([{key:'processing',activity:'processing',body:'Recording move'}]));
  await page.waitForTimeout(250);
  await page.screenshot({path:info.outputPath('processing-start.png')});
  await page.waitForTimeout(1200);
  await page.screenshot({path:info.outputPath('processing-peak.png')});
  await page.waitForTimeout(1200);
  await page.evaluate(()=>window.update([{key:'processing',activity:'waiting',body:'Waiting for approval'}]));
  await page.waitForTimeout(2000);
  await page.screenshot({path:info.outputPath('waiting-peak.png')});
  await page.waitForTimeout(2000);
});

test('an urgent arrival cannot make focused or expanded notification controls inert',async({page})=>{
  await open(page);
  await page.evaluate(()=>{
    const card=document.querySelector('[data-key="processing"]');
    card.querySelector('button').focus();
    window.focusedNotice=card;window.focusedControl=document.activeElement;
    window.update([{key:'urgent',priority:'urgent',activity:'static',body:'Recording failed'},{key:'processing'}]);
  });
  await expect(page.locator('[data-key="processing"]')).toHaveClass(/is-active/);
  expect(await page.evaluate(()=>document.activeElement===window.focusedControl&&!window.focusedControl.closest('[inert]'))).toBe(true);
  await expect(page.locator('[data-key="urgent"]')).toBeAttached();
  await page.evaluate(()=>{
    document.activeElement.blur();
    document.querySelector('[data-key="processing"] details').open=false;
    window.update([{key:'urgent',priority:'urgent',activity:'static',body:'Recording failed'},{key:'processing'}]);
  });
  await expect(page.locator('[data-key="urgent"]')).toHaveClass(/is-active/);
  expect(await page.evaluate(()=>window.focusedNotice===document.querySelector('[data-key="processing"]'))).toBe(true);
});
