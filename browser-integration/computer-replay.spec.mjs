import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const removalFixture=JSON.parse(readFileSync(new URL('../packages/game-engine/test/fixtures/destruction-project.json',import.meta.url),'utf8'));
const open=async page=>{await page.goto('/browser-integration/support/computer-replay.html');await page.waitForFunction(()=>window.fixtureReady);};
const token=(page,id)=>page.locator(`.computer-replay .piece-token[data-piece-id="${id}"]:not(.ghost)`);
const rect=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height};});
const expectRect=(actual,expected)=>{for(const key of ['left','top','width','height'])expect(Math.abs(actual[key]-expected[key]),key).toBeLessThanOrEqual(1);};
test.use({viewport:{width:390,height:844},video:'on'});

test('actual adapter animates exact stacked push, retreat, and follow tokens without changing live state',async({page},info)=>{
  await open(page);
  const writes=[];page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
  const liveBefore=await page.locator('#live-board').innerHTML();
  await page.evaluate(()=>window.replayFixture.start());
  const actions=await page.evaluate(()=>window.replayFixture.payload.frames.map(frame=>frame.action));
  for(const [index,action]of actions.entries()){
    const source=await rect(token(page,action.actorId));
    await page.evaluate(()=>window.replayFixture.advance());
    const motion=await page.evaluate(id=>{
      const motion=window.replayFixture.motions.findLast(item=>item.id===id);
      if(!motion)throw Error(`No animation for ${id}`);
      motion.animation.pause();motion.animation.currentTime=0;
      return{target:motion.target,end:motion.frames.at(-1).transform,base:motion.base,ids:window.replayFixture.motions.map(item=>item.id)};
    },action.actorId);
    expectRect(await rect(token(page,action.actorId)),source);
    // Advancing the real WAAPI animation must land exactly on its adapter's
    // stacked/nonstacked baseline, with no snap when the animation is canceled.
    await page.evaluate(id=>{const motion=window.replayFixture.motions.findLast(item=>item.id===id);motion.animation.currentTime=520;},action.actorId);
    expectRect(await rect(token(page,action.actorId)),motion.target);
    expect(motion.end).toBe(motion.base);
    if(index===0){
      const frame=await page.evaluate(()=>window.replayFixture.payload.frames[0]);
      const stacked=frame.after.pieces.filter(p=>p.position.row===action.to.row&&p.position.col===action.to.col);
      expect(stacked).toHaveLength(2);
      expect(motion.ids).toEqual([action.actorId]);
      for(const piece of stacked)await expect(token(page,piece.id)).toHaveCount(1);
      await page.screenshot({path:info.outputPath('stacked-push-end.png')});
    }
  }
  await page.evaluate(()=>window.replayFixture.advance());
  await expect(page.locator('.computer-replay')).toHaveCount(0);
  expect(await page.evaluate(()=>window.replayFixture.unchanged)).toBe(true);
  expect(await page.locator('#live-board').innerHTML()).toBe(liveBefore);
  expect(await page.evaluate(()=>({writes:window.replayFixture.writes,timers:window.replayFixture.timers.size,adapters:window.replayFixture.activeAdapters}))).toEqual({writes:0,timers:0,adapters:1});
  expect(writes).toEqual([]);
});

test('actual removal ghosts retain source geometry and release every renderer on stop',async({page},info)=>{
  await open(page);
  const payload=await page.evaluate(fixture=>window.replayFixture.createRemovalPayload(fixture),removalFixture);
  const removed=payload.frames[0].before.pieces.filter(piece=>!payload.frames[0].after.pieces.some(after=>after.id===piece.id));expect(removed.length).toBeGreaterThan(0);
  await page.evaluate(payload=>window.replayFixture.start(payload),payload);
  const before=await rect(token(page,removed[0].id));
  await page.evaluate(()=>window.replayFixture.advance());
  const ghost=page.locator(`.computer-replay > .piece-token[data-piece-id="${removed[0].id}"]`);
  await expect(ghost).toHaveCount(1);expectRect(await rect(ghost),before);await expect(ghost).toHaveCSS('transform','none');
  await page.screenshot({path:info.outputPath('recorded-removal.png')});
  await page.getByRole('button',{name:'Stop replay',exact:true}).click();
  await expect(page.locator('.computer-replay')).toHaveCount(0);
  expect(await page.evaluate(()=>({unchanged:window.replayFixture.unchanged,timers:window.replayFixture.timers.size,adapters:window.replayFixture.activeAdapters,writes:window.replayFixture.writes}))).toEqual({unchanged:true,timers:0,adapters:1,writes:0});
});

for(const reason of ['revision','replacement','background','destroy'])test(`actual renderer cancels cleanly on ${reason}`,async({page})=>{
  await open(page);await page.evaluate(()=>window.replayFixture.start());
  await page.evaluate(reason=>{
    const fixture=window.replayFixture;
    if(reason==='revision')fixture.controller.reconcile({gameId:'fixture',revision:2,lineageHead:'follow'});
    if(reason==='replacement'){fixture.start();fixture.controller.stop('stopped');}
    if(reason==='background'){Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}
    if(reason==='destroy')fixture.controller.destroy();
  },reason);
  await expect(page.locator('.computer-replay')).toHaveCount(0);
  expect(await page.evaluate(()=>({unchanged:window.replayFixture.unchanged,timers:window.replayFixture.timers.size,adapters:window.replayFixture.activeAdapters,writes:window.replayFixture.writes}))).toEqual({unchanged:true,timers:0,adapters:1,writes:0});
});

test('reduced motion uses static manual steps and returns to unchanged live presentation',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await open(page);await page.evaluate(()=>window.replayFixture.start());
  expect(await page.evaluate(()=>window.replayFixture.controller.snapshot().manual)).toBe(true);
  expect(await page.evaluate(()=>window.replayFixture.timers.size)).toBe(0);
  expect(await page.evaluate(()=>window.replayFixture.motions.length)).toBe(0);
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.locator('.computer-replay')).toHaveCount(0);
  expect(await page.evaluate(()=>window.replayFixture.unchanged&&window.replayFixture.writes===0&&window.replayFixture.activeAdapters===1)).toBe(true);
});
