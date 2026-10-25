import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/browser-integration/support/invite-history-polish.html');await page.waitForFunction(()=>window.fixtureReady);});
for(const width of [320,390])test(`invitation controls use explicit seats and icons at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 for(const scale of [100,200])for(const role of ['red','blue']){
  await page.evaluate(({role,scale})=>{document.documentElement.style.fontSize=`${scale}%`;window.renderInvite(role,role==='red'?{player1:null,player2:{identityId:'host'}}:{});},{role,scale});
  const dialog=page.getByRole('dialog'),play=dialog.getByRole('button',{name:`Play as ${role==='red'?'Red':'Blue'}`,exact:true});
  await expect(play).toBeEnabled();
  const reference=page.locator(role==='red'?'#p1':'#p2');expect(await play.evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(await reference.evaluate(e=>getComputedStyle(e).backgroundColor));
  for(const control of await dialog.locator('button,a.button-link').all()){
   await expect(control.locator('svg')).toHaveAttribute('aria-hidden','true');await expect(control.locator('svg path')).toHaveAttribute('d',/.+/);
   await control.scrollIntoViewIfNeeded();const b=await control.boundingBox();expect(Number(b.height.toFixed(3))).toBeGreaterThanOrEqual(44);expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);
  }
  await play.focus();await page.keyboard.press(info.project.name==='webkit'?'Alt+Tab':'Tab');await expect(dialog.getByRole('button',{name:'Join as viewer',exact:true})).toBeFocused();
  if(role==='blue')await page.screenshot({path:info.outputPath(`blue-invite-${scale}.png`),fullPage:true});
 }
 await page.evaluate(()=>window.renderInvite('blue',{player2:{identityId:'taken'}}));await expect(page.getByRole('button',{name:'Play as Blue',exact:true})).toHaveCount(0);await expect(page.getByRole('dialog')).toContainText('That seat is taken');
 await page.evaluate(()=>window.renderInvite('viewer'));await expect(page.getByRole('button',{name:/Play as/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Join as viewer',exact:true})).toBeEnabled();
 await page.evaluate(()=>window.renderInvite('blue',{pendingPlayerRequestSeat:'Player 2'}));await expect(page.getByRole('dialog')).toContainText('Waiting for approval');await expect(page.getByRole('button',{name:/Play as/})).toHaveCount(0);
});

test('additional history exposes real availability, keeps pages and hides exhaustion',async({page},info)=>{
 await page.evaluate(()=>window.renderHistory());await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(1);
 await expect(page.getByRole('button',{name:'More game history',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.historyRequests[0].resolve({available:true,items:[],nextCursor:null}));await page.getByRole('button',{name:'More game history',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(2);
 await page.evaluate(()=>window.historyRequests[1].resolve({available:true,items:[{id:'a',at:'2026-01-01',move:{moveId:'a',notation:'MOVE A',undone:false,snapshot:window.archiveSnapshot}},{id:'b',at:'2026-01-01',move:{notation:'MOVE B',undone:true}}],nextCursor:{eventSeq:2,ordinal:0}}));
 await expect(page.locator('[data-archive-move-id]')).toHaveCount(2);await expect(page.locator('[data-archive-move-id="b"]')).toContainText('Undone');
 const selected=page.locator('[data-archive-move-id="a"]');await selected.getByRole('button').click();await expect(selected).toHaveClass(/is-selected/);await expect(selected.getByRole('button')).toHaveAttribute('aria-current','true');
 await expect(selected.locator('[data-testid="history-inline-preview"] .cell')).toHaveCount(100);
 expect(await selected.evaluate(el=>el.querySelector('.history-move-at').compareDocumentPosition(el.querySelector('.history-inline-preview'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
 await expect(selected.locator('[data-action="revert-to-move"],[data-action="launch-history-branch"]')).toHaveCount(0);expect(await page.evaluate(()=>window.historyRequests.length)).toBe(2);
 await page.evaluate(()=>window.returnArchiveLive());await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);await expect(selected).not.toHaveClass(/is-selected/);
 await page.getByRole('button',{name:'Load more history',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(3);
 await page.evaluate(()=>window.historyRequests[2].reject(Error('unavailable')));await expect(page.getByRole('status')).toContainText('We couldn’t load more history');await expect(page.locator('[data-archive-move-id]')).toHaveCount(2);
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(4);
 expect(await page.evaluate(()=>window.historyRequests[3].values.cursor)).toEqual({eventSeq:2,ordinal:0});
 await page.evaluate(()=>window.historyRequests[3].resolve({available:true,items:[{id:'c',at:'2026-01-01',move:{notation:'PASS',undone:false}}],nextCursor:null}));await expect(page.locator('[data-archive-move-id]')).toHaveCount(3);
 await expect(page.getByRole('button',{name:/More game history|Load more history|Retry/})).toHaveCount(0);
 await page.evaluate(()=>window.renderHistory());expect(await page.evaluate(()=>window.historyRequests.length)).toBe(4);await page.screenshot({path:info.outputPath('additional-history-exhausted.png')});
});

test('short games with no additional records never show an archive CTA',async({page})=>{
 await page.evaluate(()=>window.renderHistory());await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(1);
 await page.evaluate(()=>window.historyRequests[0].resolve({available:false,items:[],nextCursor:null}));await expect(page.locator('[data-testid="additional-history"]')).toBeAttached();await expect(page.getByRole('button')).toHaveCount(0);
});

for(const route of ['home','game','invite'])test(`held ${route} loading facets pulse without moving the surface`,async({page})=>{
 await page.evaluate(route=>window.holdSweep(route),route);
 const sweep=page.locator('.shell-route-transition-layer-swipe');const before=await sweep.evaluate(e=>({transform:getComputedStyle(e).transform,rect:e.getBoundingClientRect().toJSON()}));
 const motion=await sweep.evaluate(e=>{const animations=e.getAnimations({subtree:true});window.heldAnimations=animations;return animations.length;});expect(motion).toBe(2);
 const opacity=Number(await sweep.evaluate(e=>getComputedStyle(e,'::before').opacity));
 await expect.poll(async()=>Math.abs(Number(await sweep.evaluate(e=>getComputedStyle(e,'::before').opacity))-opacity),{timeout:3000}).toBeGreaterThan(.05);
 expect(await sweep.evaluate(e=>({transform:getComputedStyle(e).transform,rect:e.getBoundingClientRect().toJSON()}))).toEqual(before);
 expect(await sweep.evaluate(e=>e.getAnimations({subtree:true}).every((animation,index)=>animation===window.heldAnimations[index]))).toBe(true);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('html')).toHaveAttribute('data-loading-hidden','');expect(await sweep.evaluate(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='paused'))).toBe(true);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('html')).not.toHaveAttribute('data-loading-hidden');expect(await sweep.evaluate(e=>e.getAnimations({subtree:true}).every(a=>a.playState==='running'))).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});expect(await sweep.evaluate(e=>e.getAnimations({subtree:true}).length)).toBe(0);
 await page.evaluate(()=>window.finishSweep());await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-active','false');
});


test('invitation choices reflect available actions without exposing rule metadata',async({page},info)=>{
 await page.setViewportSize({width:320,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';window.renderInvite('blue',{selfPlayMode:true,canJoinAsPlayer:false,joinAsPlayerDisabledReason:'Self-play mode does not accept remote player joins.'});});
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('heading',{name:'Watch this game',exact:true})).toBeVisible();
 await expect(dialog.getByRole('button')).toHaveCount(1);await expect(dialog.getByRole('button',{name:'Join as viewer',exact:true})).toBeEnabled();
 await expect(dialog.getByRole('link',{name:'Back home',exact:true})).toBeVisible();
 await expect(dialog).not.toContainText(/Self-play|remote|seat|unavailable/);
 await page.screenshot({path:info.outputPath('self-play-view-only.png'),fullPage:true});
 await page.evaluate(()=>window.renderInvite('blue',{player2:{identityId:'friend'},joinFailure:'Could not join. Try again'}));
 await expect(dialog.getByRole('heading',{name:'Watch this game',exact:true})).toBeVisible();await expect(dialog).toContainText('That seat is taken');await expect(page.getByTestId('join-failure')).toHaveText('Could not join. Try again');
 await expect(dialog.getByRole('button',{name:'Play as Blue',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.renderInvite('blue',{canJoinAsPlayer:false,canJoinAsViewer:false,joinAsPlayerDisabledReason:'INTERNAL_PLAYER_RULE',joinAsViewerDisabledReason:'INTERNAL_VIEWER_RULE'}));
 await expect(dialog.getByRole('heading',{name:'Invitation unavailable',exact:true})).toBeVisible();await expect(dialog.getByRole('button')).toHaveCount(0);await expect(dialog.getByRole('link',{name:'Back home',exact:true})).toBeVisible();await expect(dialog).not.toContainText('INTERNAL_');
 await page.evaluate(()=>window.renderInvite('blue',{pendingPlayerRequestSeat:'Player 2'}));
 await expect(page.getByTestId('pending-player-request-notice')).toContainText('awaiting approval');await expect(dialog.getByRole('heading',{name:'Waiting for approval',exact:true})).toBeVisible();
});
