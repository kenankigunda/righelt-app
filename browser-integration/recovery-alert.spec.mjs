import {test,expect} from "@playwright/test";
import {runScopedAxeScan} from "../e2e/support/ux.mjs";

const modes=["recording","overdue","reconnect","storage","paused","upgrade","signin","failure","resolved","information"];
const pending={id:"fixture",sharedMutationsBlocked:true,syncStatus:"confirming",recoveryStartedAt:null};
async function openFixture(page){await page.goto("/browser-integration/support/recovery.html");await page.waitForFunction(()=>window.fixtureReady);}
async function containedControls(page){
 const geometry=await page.getByTestId("fixture-alert").evaluate(alert=>{
  const card=alert.getBoundingClientRect();
  return {card:{x:card.x,y:card.y,right:card.right,bottom:card.bottom},width:innerWidth,height:innerHeight,
   controls:[...alert.querySelectorAll('button,a.button-link')].map(button=>{const b=button.getBoundingClientRect();return {label:button.textContent,width:b.width,height:b.height,x:b.x,y:b.y,right:b.right,bottom:b.bottom,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button,a.button-link')===button};}),
   messageVisible:alert.querySelector('.shell-game-alert-copy').scrollHeight<=alert.querySelector('.shell-game-alert-copy').clientHeight+1};
 });
 expect(geometry.card.x).toBeGreaterThanOrEqual(-1);expect(geometry.card.right).toBeLessThanOrEqual(geometry.width+1);
 expect(geometry.card.y).toBeGreaterThanOrEqual(-1);expect(geometry.card.bottom).toBeLessThanOrEqual(geometry.height+1);
 expect(geometry.messageVisible).toBe(true);
 for(const control of geometry.controls){
  expect(control.width,control.label).toBeGreaterThanOrEqual(44);expect(control.height,control.label).toBeGreaterThanOrEqual(44);
  expect(control.x,control.label).toBeGreaterThanOrEqual(geometry.card.x-1);expect(control.right,control.label).toBeLessThanOrEqual(geometry.card.right+1);
  expect(control.y,control.label).toBeGreaterThanOrEqual(geometry.card.y-1);expect(control.bottom,control.label).toBeLessThanOrEqual(geometry.card.bottom+1);
  expect(control.hit,control.label).toBe(true);
 }
 for(let i=0;i<geometry.controls.length;i++)for(let j=i+1;j<geometry.controls.length;j++){
  const a=geometry.controls[i],b=geometry.controls[j];expect(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,`${a.label} overlaps ${b.label}`).toBe(true);
 }
 return geometry;
}

for(const width of [320,375,390,479,480,481,899,900,901,1440]) test(`alert modes retain reachable controls at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:"reduce"});await openFixture(page);
 const boardBefore=await page.getByTestId("game-board").boundingBox();
 for(const mode of modes){
  await page.evaluate(mode=>window.renderMode(mode),mode);
  const geometry=await containedControls(page);
  if(width<=900){expect(geometry.card.x).toBe(0);expect(geometry.card.y).toBe(0);expect(geometry.card.right).toBe(width);}
  const alert=page.getByTestId("fixture-alert"),actions=alert.locator('.shell-game-alert-actions');
  if(await actions.count()){
   const copy=await alert.locator('.shell-game-alert-copy').boundingBox(),buttons=await actions.boundingBox();
   if(width<480)expect(buttons.y).toBeGreaterThanOrEqual(copy.y+copy.height);
   else expect(buttons.x).toBeGreaterThanOrEqual(copy.x+copy.width);
  }
  const caret=alert.getByRole('button',{name:'Details',exact:true});
  if(await caret.count()){
   const collapsed=await caret.boundingBox();await caret.click();await expect(caret).toHaveAttribute('aria-expanded','true');
   await containedControls(page);const expanded=await caret.boundingBox();expect(expanded.x).toBeCloseTo(collapsed.x,1);expect(expanded.y).toBeCloseTo(collapsed.y,1);
   expect(await caret.evaluate(el=>document.activeElement===el)).toBe(true);
   await caret.press('Enter');await expect(caret).toHaveAttribute('aria-expanded','false');
  }
 }
 await page.evaluate(()=>window.renderMode('storage',{longMessage:true,stacked:true}));await containedControls(page);
 expect((await runScopedAxeScan({page,include:'[data-testid="fixture-alert"]'})).violations).toEqual([]);
 expect(await page.getByTestId('game-board').boundingBox()).toEqual(boardBefore);
 if((width===390&&info.project.name==='webkit')||(width===1440&&info.project.name==='chromium')){
  await page.screenshot({path:info.outputPath('alert-collapsed.png')});await page.getByRole('button',{name:'Details',exact:true}).click();await page.screenshot({path:info.outputPath('alert-expanded.png')});
 }
});

for(const viewport of [{width:667,height:320},{width:390,height:460}]) test(`expanded details remain usable in ${viewport.width}x${viewport.height}`,async({page})=>{
 await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await openFixture(page);
 await page.evaluate(()=>{window.renderMode('storage');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Unavailable');}}});});
 await page.getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('button',{name:'Copy full details',exact:true}).click();
 await expect(page.getByTestId('fixture-alert')).toContainText('Copy the full details below');await containedControls(page);
 const details=page.locator('.issue-details');expect(await details.evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');
 expect((await page.getByTestId('fixture-alert').boundingBox()).y+(await page.getByTestId('fixture-alert').boundingBox()).height).toBeLessThanOrEqual(viewport.height-70);
 await page.getByRole('button',{name:'Details',exact:true}).click();await containedControls(page);
});

test('enlarged text retains alert actions and disclosure',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await openFixture(page);
 await page.evaluate(()=>{document.documentElement.style.fontSize='32px';window.renderMode('storage',{longMessage:true});});
 await containedControls(page);await page.getByRole('button',{name:'Details',exact:true}).click();await containedControls(page);
 // Capture the clipboard adapter to verify native control feedback, not OS clipboard permissions.
 const expected=await page.evaluate(async()=>{
  const diagnostics=(await import('/apps/web/shell/issue-diagnostics.js')).issueDiagnostics;
  const id=document.querySelector('.issue-diagnostic').dataset.incidentId;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedFullDetails=value;}}});
  return diagnostics.text(id);
 });
 const copy=page.getByRole('button',{name:'Copy full details',exact:true});await copy.click();
 await expect(page.locator('.issue-details [role="status"]')).toHaveText('Full details copied.');
 expect(await page.evaluate(()=>window.copiedFullDetails)).toBe(expected);
 await expect(copy).toBeFocused();await containedControls(page);
 await copy.press('Tab');const report=page.locator('.issue-details pre');await expect(report).toBeFocused();
 const readable=()=>report.evaluate(pre=>{
  const box=pre.getBoundingClientRect(),outer=pre.closest('.issue-details').getBoundingClientRect();
  const line=parseFloat(getComputedStyle(pre).lineHeight);
  return {height:box.height,visible:Math.max(0,Math.min(box.bottom,outer.bottom,innerHeight)-Math.max(box.top,outer.top,0)),line};
 });
 await expect.poll(async()=>{const box=await readable();return box.visible>=box.line;}).toBe(true);
 const box=await readable();expect(box.height).toBeGreaterThanOrEqual(box.line);
 await report.press('ArrowDown');await expect(report).toBeFocused();
 await page.screenshot({path:info.outputPath('enlarged-readable-details.png')});
});

for(const reduced of [false,true]) test(`confirmation fades the board and sweeps right${reduced?' with static reduced motion':''}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await openFixture(page);
 await page.clock.install();const frozen=await page.evaluate(()=>Date.now());await page.clock.setFixedTime(frozen);await page.clock.pauseAt(frozen);await page.clock.setSystemTime(frozen);
 const board=page.getByTestId('game-board'),before=await board.boundingBox();const wrap=page.getByTestId('game-board-wrap');
 await page.evaluate(game=>window.setRecovery(game),pending);await expect(wrap).toHaveAttribute('aria-busy','true');
 await page.clock.runFor(199);await expect(page.locator('.reconnect-background')).toBeHidden();
 await page.clock.runFor(2);await expect(page.locator('.reconnect-background')).toBeVisible();
 await page.clock.runFor(200);await expect.poll(()=>board.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(.2);
 const animation=await page.locator('.reconnect-background').evaluate(el=>getComputedStyle(el,'::before').animationName);
 if(reduced)expect(animation).toBe('none');
 else{
  expect(animation).toBe('reconnect-sweep');
  const motion=await page.locator('.reconnect-background').evaluate(el=>{const animation=el.getAnimations({subtree:true}).find(a=>a.animationName==='reconnect-sweep');if(!animation)throw Error('Missing sweep animation');animation.pause();animation.currentTime=0;const start=new DOMMatrixReadOnly(getComputedStyle(el,'::before').transform).m41;animation.currentTime=1800;const end=new DOMMatrixReadOnly(getComputedStyle(el,'::before').transform).m41;return {start,end};});
  expect(motion.end).toBeGreaterThan(motion.start);
 }
 await page.evaluate(game=>window.setRecovery({...game,recoveryEpisodeId:'new-socket-generation'}),pending);await expect(wrap).toHaveAttribute('data-loading-phase','visible');
 expect(await board.boundingBox()).toEqual(before);expect(await page.locator('.reconnect-background').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
 if(info.project.name==='webkit')await page.screenshot({path:info.outputPath(reduced?'board-static.png':'board-sweep.png')});
 await page.evaluate(game=>window.setRecovery({...game,inHistoryMode:true}),pending);await expect(wrap).toHaveAttribute('aria-busy','false');await expect(page.locator('.reconnect-background')).toBeHidden();
 await page.clock.runFor(200);await expect.poll(()=>board.evaluate(el=>Number(getComputedStyle(el).opacity))).toBe(1);
 await page.evaluate(game=>window.setRecovery({...game,recoveryIssue:'invalid_credentials'}),pending);await expect(wrap).toHaveAttribute('aria-busy','false');
 await page.clock.resume();
});

for(const width of [320,390])test(`recovery actions keep icons, labels and navigation at ${width}px with enlarged text`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});await openFixture(page);
 await page.evaluate(()=>{document.documentElement.style.fontSize='200%';window.renderMode('overdue',{diagnostics:false});});
 const alert=page.getByTestId('fixture-alert'),reload=alert.getByRole('button',{name:'Reload game',exact:true}),home=alert.getByRole('link',{name:'Home',exact:true});
 await expect(reload).toHaveAttribute('data-action','reconnect-safely');await expect(home).toHaveAttribute('href','#/');
 for(const control of [reload,home]){
  await expect(control.locator('svg')).toHaveAttribute('aria-hidden','true');
  await expect(control.locator('svg path')).toHaveAttribute('d',/.+/);
 }
 await containedControls(page);await reload.focus();await expect(reload).toBeFocused();
 // Safari's default keyboard navigation uses Option-Tab to include links.
 await page.keyboard.press(info.project.name==='webkit'?'Alt+Tab':'Tab');await expect(home).toBeFocused();
 await page.screenshot({path:info.outputPath('recovery-actions-enlarged.png')});
 await home.press('Enter');await expect(page).toHaveURL(/#\/$/);
 for(const mode of ['storage','paused','upgrade','signin']){
  await page.evaluate(mode=>window.renderMode(mode,{diagnostics:false}),mode);
  for(const control of await alert.locator('.shell-game-alert-actions button').all())await expect(control.locator('svg path')).toHaveAttribute('d',/.+/);
  await containedControls(page);
 }
 expect((await runScopedAxeScan({page,include:'[data-testid="fixture-alert"]'})).violations).toEqual([]);
});

for(const width of [320,390])test(`normal recovery keeps Home beside Reload game at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});await openFixture(page);
 await page.evaluate(()=>window.renderMode('overdue',{diagnostics:false}));
 const alert=page.getByTestId('fixture-alert'),reload=alert.getByRole('button',{name:'Reload game',exact:true}),home=alert.getByRole('link',{name:'Home',exact:true});
 await containedControls(page);const a=await reload.boundingBox(),b=await home.boundingBox();expect(b.x).toBeGreaterThanOrEqual(a.x+a.width);expect(b.y).toBeCloseTo(a.y,1);
 await page.screenshot({path:info.outputPath('recovery-actions-normal.png')});
});

test('recovery fixture follows the actual quiet and actionable timing contract',async({page})=>{
 await openFixture(page);await page.clock.install();const started=await page.evaluate(()=>Date.now());
 const game={recovering:true,recoveryStartedAt:started};
 for(const [elapsed,visible,actionable] of [[3999,false,false],[4000,true,false],[14999,true,false],[15000,true,true]]){
  await page.clock.setFixedTime(started+elapsed);await page.evaluate(game=>window.renderMode('quiet',{game,diagnostics:false}),game);
  await expect(page.getByTestId('fixture-alert')).toHaveCount(visible?1:0);
  await expect(page.getByRole('button',{name:'Reload game',exact:true})).toHaveCount(actionable?1:0);
 }
});
