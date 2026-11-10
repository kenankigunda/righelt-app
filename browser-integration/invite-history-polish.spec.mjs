import {writeFile} from 'node:fs/promises';
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
 await page.evaluate(()=>window.historyRequests[1].resolve({available:true,items:[{id:'a',at:'2026-01-01',move:{moveId:'a',turnIndex:0,turnMoveIndex:0,actorSide:'P1',notation:'MOVE A',undone:false,snapshot:window.archiveSnapshot}},{id:'b',at:'2026-01-01',move:{turnIndex:1,turnMoveIndex:0,actorSide:'P2',notation:'MOVE B',undone:true}}],nextCursor:{eventSeq:2,ordinal:0}}));
 await expect(page.locator('[data-archive-move-id]')).toHaveCount(2);await expect(page.locator('[data-archive-move-id="a"]')).toHaveAttribute('aria-label','Guest 1');await expect(page.locator('[data-archive-move-id="b"]')).toHaveAttribute('aria-label','Guest 2');await expect(page.locator('.history-actor')).toHaveCount(0);await expect(page.locator('.history-turn-heading')).toHaveText(['Turn 2','Turn 1']);await expect(page.locator('[data-archive-move-id="b"]')).toContainText('Undone');
 const selected=page.locator('[data-archive-move-id="a"]');await selected.getByRole('button').click();await expect(selected).toHaveClass(/is-selected/);await expect(selected.getByRole('button')).toHaveCount(0);await expect(selected.locator('.history-archive-select')).toHaveAttribute('aria-current','true');await expect(selected.locator('[data-action="inspect-history-archive"]')).toHaveCount(0);
 await expect(selected.locator('[data-testid="history-inline-preview"] .cell')).toHaveCount(100);
 expect(await selected.evaluate(el=>el.querySelector('.history-move-at').compareDocumentPosition(el.querySelector('.history-inline-preview'))&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
 await expect(selected.locator('[data-action="revert-to-move"],[data-action="launch-history-branch"]')).toHaveCount(0);expect(await page.evaluate(()=>window.historyRequests.length)).toBe(2);
 await page.evaluate(()=>window.returnArchiveLive());await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);await expect(selected).not.toHaveClass(/is-selected/);
 await page.getByRole('button',{name:'Load more history',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(3);
 await page.evaluate(()=>window.historyRequests[2].reject(Error('unavailable')));await expect(page.getByRole('status')).toContainText('We couldn’t load more history');await expect(page.locator('[data-archive-move-id]')).toHaveCount(2);
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(4);
 expect(await page.evaluate(()=>window.historyRequests[3].values.cursor)).toEqual({eventSeq:2,ordinal:0});
 await page.evaluate(()=>window.historyRequests[3].resolve({available:true,items:[{id:'c',at:'2026-01-01',move:{turnIndex:2,turnMoveIndex:0,actorSide:'P1',notation:'PASS',undone:false}}],nextCursor:null}));await expect(page.locator('[data-archive-move-id]')).toHaveCount(3);
 await expect(page.getByRole('button',{name:/More game history|Load more history|Retry/})).toHaveCount(0);
 await page.evaluate(()=>window.renderHistory());expect(await page.evaluate(()=>window.historyRequests.length)).toBe(4);await page.screenshot({path:info.outputPath('additional-history-exhausted.png')});
});

test('short games with no additional records never show an archive CTA',async({page})=>{
 await page.evaluate(()=>window.renderHistory());await expect.poll(()=>page.evaluate(()=>window.historyRequests.length)).toBe(1);
 await page.evaluate(()=>window.historyRequests[0].resolve({available:false,items:[],nextCursor:null}));await expect(page.locator('[data-testid="additional-history"]')).toBeAttached();await expect(page.getByRole('button')).toHaveCount(0);
});

for(const route of ['home','game','invite'])test(`held ${route} Edge cuts keep moving without moving the surface`,async({page},info)=>{
 const fonts=await page.evaluate(route=>window.holdSweep(route),route);
 const fontPath=info.outputPath(`held-${route}-font-readiness.json`);await writeFile(fontPath,JSON.stringify(fonts,null,2));await info.attach('held-surface-font-readiness',{path:fontPath,contentType:'application/json'});
 expect(fonts.after.status).toBe('loaded');expect(fonts.after.runs.every(run=>run.ready)).toBe(true);
 const frame=page.locator('.loading-edge-frame');await expect(frame).toHaveCount(1);
 const paths=frame.locator('g polygon');await expect(paths).toHaveCount(2);
 const geometry=()=>page.locator('.shell-main-content section.panel').first().evaluate(e=>e.getBoundingClientRect().toJSON());
 const before=await geometry();
 const motion=await paths.evaluateAll(nodes=>{window.heldPaths=nodes;window.heldAnimations=nodes.map(node=>node.getAnimations()[0]);return {animations:window.heldAnimations.map(animation=>({duration:animation.effect.getTiming().duration,iterations:animation.effect.getTiming().iterations,playState:animation.playState})),colors:nodes.map(node=>getComputedStyle(node).stroke),classes:nodes.map(node=>node.getAttribute('class')),offsets:nodes.map(node=>getComputedStyle(node).strokeDashoffset)};});
 expect(motion.animations).toEqual([{duration:2400,iterations:Infinity,playState:'running'},{duration:2400,iterations:Infinity,playState:'running'}]);expect(motion.classes).toEqual(['loading-edge-p1','loading-edge-p2']);expect(motion.colors).toEqual(await Promise.all(['#p1','#p2'].map(selector=>page.locator(selector).evaluate(node=>getComputedStyle(node).backgroundColor))));
 await expect.poll(async()=>(await paths.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).strokeDashoffset))).every((offset,index)=>offset!==motion.offsets[index])).toBe(true);
 expect(await geometry()).toEqual(before);
 expect(await paths.evaluateAll(nodes=>nodes.every((node,index)=>node===window.heldPaths[index]&&node.getAnimations()[0]===window.heldAnimations[index]))).toBe(true);
 await page.screenshot({path:info.outputPath(`held-${route}-edge.png`),fullPage:true});
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('html')).toHaveAttribute('data-loading-hidden','');expect(await paths.evaluateAll(nodes=>nodes.every(node=>node.getAnimations()[0].playState==='paused'))).toBe(true);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('html')).not.toHaveAttribute('data-loading-hidden');expect(await paths.evaluateAll(nodes=>nodes.every(node=>node.getAnimations()[0].playState==='running'))).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});expect(await paths.evaluateAll(nodes=>nodes.every(node=>node.getAnimations().length===0))).toBe(true);await expect(frame).toBeVisible();expect(await geometry()).toEqual(before);
 await page.evaluate(()=>window.finishSweep());await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-active','false');await expect(frame).toHaveCount(0);
});


test('held Home slow context uses one external notice without moving cards or restarting its source cue',async({page},info)=>{
 await page.evaluate(()=>window.holdSweep('home'));
 const source=page.locator('.home-games-section[data-home-section-root="my"]');
 await expect(source).toHaveAttribute('data-loading-state','pending');
 await expect(source).not.toHaveAttribute('data-loading-phase','slow');
 await expect(source).toHaveAttribute('data-loading-phase','visible');
 const baseline=await source.evaluate(node=>{const cue=node.querySelector(':scope > .loading-pieces');window.heldSourceCue=cue;window.heldSourceAnimation=cue.querySelector('i').getAnimations()[0];return {rect:node.getBoundingClientRect().toJSON(),time:window.heldSourceAnimation.currentTime};});
 // Observe the actual threshold transition. The assertion's polling schedule can
 // otherwise take its last sample before 5s and time out after the phase changes.
 await source.evaluate(node=>new Promise((resolve,reject)=>{
  const observer=new MutationObserver(check);
  const timer=setTimeout(()=>{observer.disconnect();reject(new Error(`Expected slow loading phase within 5000ms, received ${node.dataset.loadingPhase}`));},5000);
  function check(){if(node.dataset.loadingPhase==='slow'){observer.disconnect();clearTimeout(timer);resolve();}}
  observer.observe(node,{attributes:true,attributeFilter:['data-loading-phase']});check();
 }));
 await expect(source).toHaveAttribute('data-loading-phase','slow');
 const notice=page.getByTestId('slow-loading-notice');await expect(notice).toBeVisible();
 await expect(page.locator('.shell-header-status [role="status"]')).toHaveCount(1);
 await expect(page.locator('.shell-header-status [role="status"]')).toHaveText('Your games are taking a little longer to load.');
 await expect(source.locator('.loading-context')).toHaveCount(0);
 const slow=await source.evaluate(node=>({rect:node.getBoundingClientRect().toJSON(),elapsed:performance.now()-window.heldOperationStartedAt,same:node.querySelector(':scope > .loading-pieces')===window.heldSourceCue&&window.heldSourceCue.querySelector('i').getAnimations()[0]===window.heldSourceAnimation,time:window.heldSourceAnimation.currentTime}));
 const receiptPath=info.outputPath('held-home-slow-context.json');await writeFile(receiptPath,JSON.stringify({baseline,slow},null,2));await info.attach('held-home-slow-context',{path:receiptPath,contentType:'application/json'});
 expect(slow.elapsed).toBeGreaterThanOrEqual(5000);expect(slow.rect).toEqual(baseline.rect);expect(slow.same).toBe(true);expect(slow.time).toBeGreaterThan(baseline.time);
 await notice.evaluate(node=>window.heldSlowNotice=node);
 await page.evaluate(()=>window.holdUrgentLoadingNotice(true));await expect(page.locator('.shell-game-alert-stack-card.is-active [data-testid="urgent-loading-test"]')).toBeVisible();
 const slowCard=page.locator('.shell-game-alert-stack-card').filter({has:notice});
 await expect(slowCard).not.toHaveClass(/is-active/);await expect(slowCard).toHaveAttribute('aria-hidden','true');await expect(slowCard).toHaveAttribute('inert','');
 await expect(page.getByRole('status')).toHaveCount(0);
 expect(await notice.evaluate(node=>node===window.heldSlowNotice)).toBe(true);
 await page.evaluate(()=>window.holdUrgentLoadingNotice(false));await expect(notice).toBeVisible();expect(await notice.evaluate(node=>node===window.heldSlowNotice)).toBe(true);
 expect(await source.evaluate(node=>node.getBoundingClientRect().toJSON())).toEqual(baseline.rect);
 await page.screenshot({path:info.outputPath('held-home-slow-context.png'),fullPage:true});
 await page.evaluate(()=>window.finishSweep());await expect(notice).toHaveCount(0);await expect(source).not.toHaveAttribute('data-loading-phase',/./);
 await expect(source.locator('.loading-pieces,.loading-context')).toHaveCount(0);
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
