import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('semantic message controller preserves native press geometry and snaps metric changes',async({page},info)=>{
 await page.setViewportSize({width:390,height:1000});
 let releaseFont;const heldFont=new Promise(resolve=>{releaseFont=resolve;});
 await page.route('**/Manrope-variable.ttf',async route=>{await heldFont;await route.continue();});
 try{
  await page.goto('/browser-integration/support/board-message.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{await window.boardFixture.setup('pass',false);window.compositionCopy=(long=false)=>({text:long?'An acknowledged opponent move needs a longer explanation with several coordinate descriptions so the same replay action wraps below this complete sentence.':'Acknowledged move',action:{id:'replay-next',label:'Next'}});window.boardFixture.message(window.compositionCopy());});
  const next=page.getByRole('button',{name:'Next',exact:true});
  const settled=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(a=>a.playState==='running'));};
  await expect(page.locator('.board-message-slot')).toHaveAttribute('data-height-managed','true');await settled();
  const results=[];
  for(const input of ['pointer','Enter','Space']){
   await page.evaluate(()=>window.boardFixture.message(window.compositionCopy()));await settled();await next.focus();
   const before=await next.boundingBox(),board=await page.locator('#board').boundingBox();
   await next.evaluate(button=>{window.heldCompositionButton=button;});
   if(input==='pointer'){await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();}else await page.keyboard.down(input);
   await page.evaluate(()=>{window.boardFixture.message(window.compositionCopy(true));return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
   expect(await next.evaluate(button=>button===window.heldCompositionButton)).toBe(true);
   expect(await next.boundingBox()).toEqual(before);expect((await page.locator('#board').boundingBox()).y).toBe(board.y);
   if(input==='pointer')await page.mouse.up();else await page.keyboard.up(input);
   await expect.poll(()=>page.evaluate(()=>window.boardFixture.messageActions().length)).toBe(results.length+1);
   await expect(page.locator('#preview')).toContainText('longer explanation');await settled();results.push(input);
  }
  // Out-of-band authority/availability changes stay immediate and must also
  // survive the deferred release refresh through the full runtime status owner.
  await page.evaluate(()=>window.boardFixture.message({text:'Select a piece or',action:{id:'pass',label:'Pass'}}));await settled();
  const pass=page.getByRole('button',{name:'Pass',exact:true});const passRect=await pass.boundingBox();
  await page.mouse.move(passRect.x+passRect.width/2,passRect.y+passRect.height/2);await page.mouse.down();
  await page.evaluate(()=>window.boardFixture.gateInteraction(true));await expect(pass).toBeDisabled();
  await page.mouse.up();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(pass).toBeDisabled();expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
  await page.evaluate(()=>window.boardFixture.gateInteraction(false));
  // A container-only width change and a real deferred font completion are
  // metric invalidations; neither may start the presentation-height animation.
  await page.evaluate(()=>{document.querySelector('main').style.width='280px';});
  await page.waitForFunction(()=>document.querySelector('.board-message-slot').getBoundingClientRect().width<=280);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.locator('.board-message-slot').evaluate(node=>node.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  releaseFont();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.locator('.board-message-slot').evaluate(node=>node.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{window.boardFixture.message(window.compositionCopy());return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  expect(await page.locator('.board-message-slot').evaluate(node=>node.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
  await writeFile(info.outputPath('message-composition-native.json'),JSON.stringify({nativeActions:results,checks:'held pointer/Enter/Space, same DOM and geometry, container resize, actual font completion, reduced motion; no gameplay writes'},null,2));
  await page.screenshot({path:info.outputPath('message-composition-390.png')});
 }finally{releaseFont();await page.unrouteAll({behavior:'wait'});}
});

test('real rush auto-selection replaces the global obligation at narrow enlarged text',async({page},info)=>{
 await page.setViewportSize({width:390,height:1100});
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  const engine=await import('/apps/web/generated/packages/game-engine/src/index.js');
  const catalog=await(await fetch('/apps/web/scenarios/catalog.json')).json();
  const state=catalog.scenarios.find(value=>value.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;
  document.documentElement.style.fontSize='200%';
  await window.boardFixture.setup('rush',false,{rushGuidanceClient:{analyze:async snapshot=>engine.analyzeRushSupplyGuidance(snapshot),cancel(){},destroy(){}}});
  await window.boardFixture.configure(state,engine.listLegalActions(state));
  await document.fonts.ready;
 });
 await expect.poll(()=>page.evaluate(()=>window.boardFixture.selection().selectedPieceId)).toBe('U1-7');
 await expect(page.locator('#preview')).not.toContainText('Obligatory');
 await expect(page.locator('#preview')).not.toContainText('Rush to restore supply');
 await page.waitForFunction(()=>!document.querySelector('.board-message-slot').getAnimations().some(a=>a.playState==='running'));
 const fit=await page.locator('main').evaluate(main=>{const board=main.querySelector('#board').getBoundingClientRect(),slot=main.querySelector('.board-message-slot').getBoundingClientRect();return{board:board.toJSON(),slot:slot.toJSON(),overflow:document.documentElement.scrollWidth>innerWidth};});
 expect(fit.overflow).toBe(false);expect(fit.slot.bottom).toBeLessThanOrEqual(fit.board.top+.1);
 expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
 await writeFile(info.outputPath('rush-message-fit.json'),JSON.stringify(fit,null,2));
 await page.screenshot({path:info.outputPath('rush-message-390-200.png')});
});
