import {test,expect} from '@playwright/test';
import {mountT142NativeBoard} from '../support/t142-native-board-fixture.mjs';

const wash=locator=>locator.evaluate(element=>{const style=getComputedStyle(element,'::after'),rect=element.getBoundingClientRect(),ghost=element.querySelector('.move-ghost'),ghostStyle=ghost?getComputedStyle(ghost):null;return{rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},unavailable:element.classList.contains('mutation-unavailable-target')||element.dataset.mutationUnavailable==='true',pulse:element.dataset.mutationPulse??null,animation:style.animationName,duration:style.animationDuration,delay:style.animationDelay,border:style.borderStyle,ghost:{present:Boolean(ghost),animation:ghostStyle?.animationName??null,z:ghostStyle?.zIndex??null}};});

test('T-142 N01 production Pass surface preserves timing, ownership and preferences',async({page},info)=>{
  test.skip(info.project.name==='firefox','Firefox representative lane uses destination');
  const fixture=await mountT142NativeBoard(page),pass=fixture.pass;
  await expect(pass).toBeEnabled();const label=await pass.textContent(),before=await wash(pass);
  await fixture.setIncident(3999);await expect(pass).toBeDisabled();const grace=await wash(pass);expect(grace.pulse).toBeNull();expect(grace.animation).toBe('none');expect(grace.rect).toEqual(before.rect);expect(await pass.textContent()).toBe(label);
  await fixture.advanceIncident(4100);await expect(pass).toHaveAttribute('data-mutation-pulse','true');const pulsing=await wash(pass);expect(pulsing.duration).toBe('2.4s');expect(pulsing.delay).toBe('-0.1s');
  await fixture.advanceIncident(6500);const nextCycle=await wash(pass);expect(nextCycle.delay).toBe('-2.5s');expect(nextCycle.rect).toEqual(before.rect);
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});expect((await wash(pass)).animation).toBe('none');
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});await fixture.retire();await expect(pass).toBeEnabled();expect((await wash(pass)).pulse).toBeNull();expect(await fixture.commands()).toHaveLength(0);
});

test('T-142 N02/N04/N05/N06/N07 production destination fences spanning pointer input',async({page,context},info)=>{
  if(info.project.name==='firefox')await page.setViewportSize({width:390,height:844});
  const fixture=await mountT142NativeBoard(page),{target,source}=await fixture.selectMove(),prompt=fixture.prompt;
  if(info.project.name==='firefox')await page.addStyleTag({content:':root{font-size:200%}'});
  const sourceClass=await source.getAttribute('class'),promptText=await prompt.textContent(),box=await target.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await fixture.setIncident(4100);
  await expect(target).toHaveClass(/mutation-unavailable-target/);const initial=await wash(target);expect(initial).toMatchObject({pulse:'true',animation:'notification-processing',duration:'2.4s',delay:'-0.1s'});expect(initial.ghost).toEqual({present:true,animation:'none',z:'1'});expect(await source.getAttribute('class')).toBe(sourceClass);expect(await prompt.textContent()).toBe(promptText);
  await fixture.rerender();const rerendered=await wash(target);expect(rerendered.delay).toBe('-0.1s');expect(rerendered.ghost).toEqual({present:true,animation:'none',z:'1'});
  if(info.project.name==='chromium'){
    const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();await page.waitForTimeout(2700);await page.bringToFront();expect((await fixture.incident()).foregroundWaitMs).toBe(4100);await expect(target).toHaveAttribute('data-mutation-pulse','true');await other.close();
  }
  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});expect((await wash(target)).animation).toBe('none');await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  await fixture.recover();await page.mouse.up();await page.waitForTimeout(100);expect(await fixture.commands()).toHaveLength(0);await expect(target).not.toHaveClass(/mutation-unavailable-target/);expect((await wash(target)).pulse).toBeNull();
  await target.click();await expect.poll(async()=>(await fixture.commands()).length).toBe(1);
});

test('T-142 N04T touch-emulated destination does not replay across recovery',async({page,context},info)=>{
  test.skip(info.project.name!=='chromium','Touch-emulated proof runs once in Chromium');
  const fixture=await mountT142NativeBoard(page),{target}=await fixture.selectMove(),box=await target.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2,cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,radiusX:4,radiusY:4,force:1}]});await fixture.setIncident(4100);await expect(target).toHaveClass(/mutation-unavailable-target/);await fixture.recover();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);expect(await fixture.commands()).toHaveLength(0);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:2,radiusX:4,radiusY:4,force:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>(await fixture.commands()).length).toBe(1);await cdp.detach();
});
