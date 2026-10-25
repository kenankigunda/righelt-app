import { test, expect } from '@playwright/test';
import {waitForOverlayEntry} from '../e2e/support/overlay-motion.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/browser-integration/support/computer-entry.html');
  await page.waitForFunction(() => window.fixtureReady);
});

test('preparation preserves usable controls and stable loading until real readiness', async ({ page }) => {
  await page.clock.install({ time: Date.now() });
  await page.clock.pauseAt(Date.now() + 1);
  await page.locator('#open').click();
  const start = page.getByRole('button', { name: 'Start game', exact: true });
  const status = page.getByRole('status');
  await expect(start).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Player 2 · Blue', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Player 2 · Blue', exact: true }).check();
  await page.evaluate(() => window.requests[0].progress({ phase: 'fetching-model', received: 50, total: 100 }));
  await page.clock.runFor(200);
  await expect(status.locator('.loading-pieces')).toBeVisible();
  await page.clock.runFor(4799);
  await expect(status).not.toContainText('bytes');
  await page.clock.runFor(1);
  await expect(status).toContainText('50 of 100 bytes');
  await expect(start).toHaveText('Start game');
  await page.evaluate(() => window.requests[0].resolve());
  await expect(start).toBeEnabled();
  await expect(status).toContainText('Ready to play');
  await expect(status.locator('.loading-pieces')).toHaveCount(0);
  await start.click();
  expect(await page.evaluate(() => window.created)).toEqual([{ opponent: 'babs', side: 'p2' }]);
});

test('preparation failure, retry and dismissal never create or enable a stale game', async ({ page }) => {
  await page.locator('#open').click();
  await page.evaluate(() => window.requests[0].reject(Error('model-checksum')));
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.created)).toEqual([]);
  await page.locator('#open').click();
  await page.evaluate(() => window.requests[1].resolve());
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
  await page.getByRole('group', { name: 'Opponent', exact: true }).getByRole('radio', { name: 'Friend', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
  await page.evaluate(() => window.requests[2].resolve());
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  expect(await page.evaluate(() => window.created)).toEqual([{ opponent: 'friend', side: 'p1' }]);
  expect(await page.evaluate(() => window.cancelled)).toBeGreaterThanOrEqual(2);
});

for(const width of [320,390])test(`native opponent cards preserve keyboard choice and focus through preparation at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:844});await page.locator('#open').click();
 const dialog=page.getByRole('dialog',{name:'Play again',exact:true});
 await waitForOverlayEntry(dialog);
 const group=dialog.getByRole('group',{name:'Opponent',exact:true}),radios=group.getByRole('radio');
 await expect(radios).toHaveCount(5);
 await expect.poll(()=>group.locator('img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0))).toBe(true);await expect(dialog.getByRole('group',{name:'Your side',exact:true}).getByRole('radio')).toHaveCount(2);
 const babs=group.getByRole('radio',{name:'Babs',exact:true}),tau=group.getByRole('radio',{name:'Tau',exact:true});
 await expect(babs).toBeChecked();await babs.focus();await page.keyboard.press('ArrowRight');
 await expect(tau).toBeChecked();await expect(tau).toBeFocused();
 await page.evaluate(()=>{window.focusedOpponent=document.activeElement;window.requests.at(-1).progress({phase:'fetching-model',received:10,total:100});});
 await expect(tau).toBeFocused();expect(await tau.evaluate(el=>el===window.focusedOpponent)).toBe(true);
 for(const radio of await radios.all()){
  const rect=await radio.evaluate(el=>el.closest('label').getBoundingClientRect().toJSON());
  expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.left).toBeGreaterThanOrEqual(0);expect(rect.right).toBeLessThanOrEqual(width);
 }
 await group.getByRole('radio',{name:'Friend',exact:true}).check();
 await expect(dialog.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();
 await expect(tau).not.toBeChecked();await expect(group.getByRole('radio',{name:'Friend',exact:true})).toBeChecked();
 // Flush the layout/ResizeObserver delivery before awaiting the resulting
 // height animation; immediately querying animations can precede its creation.
 await dialog.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 await expect.poll(()=>dialog.evaluate(element=>{
  const bounds=element.getBoundingClientRect();
  return !element.getAnimations().some(animation=>(animation.playState==='running'||animation.pending)&&Number.isFinite(animation.effect?.getComputedTiming().endTime)) && [...element.querySelectorAll('[data-rematch-start],[data-modal-close]')].every(button=>button.getBoundingClientRect().bottom<=bounds.bottom);
 })).toBe(true);
 const startRect=await dialog.getByRole('button',{name:'Start game',exact:true}).boundingBox(),cancelRect=await dialog.getByRole('button',{name:'Cancel',exact:true}).boundingBox();
 const dialogRect=await dialog.boundingBox();
 expect(startRect.y+startRect.height).toBeLessThanOrEqual(dialogRect.y+dialogRect.height);expect(cancelRect.y+cancelRect.height).toBeLessThanOrEqual(dialogRect.y+dialogRect.height);
 await page.screenshot({path:info.outputPath(`opponent-cards-${width}.png`)});
 await dialog.getByRole('button',{name:'Start game',exact:true}).click();
 expect(await page.evaluate(()=>window.created)).toEqual([{opponent:'friend',side:'p1'}]);
});

test('starting a card choice disables every opponent and side until cancellation',async({page})=>{
 await page.locator('#open').click();
 const dialog=page.getByRole('dialog',{name:'Play again',exact:true});
 await dialog.getByRole('group',{name:'Opponent',exact:true}).getByRole('radio',{name:'Self-play',exact:true}).check();
 await page.evaluate(()=>{window.startDelay=new Promise(resolve=>window.releaseStart=resolve);});
 await dialog.getByRole('button',{name:'Start game',exact:true}).click();
 for(const radio of await dialog.getByRole('radio').all())await expect(radio).toBeDisabled();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('#open').click();
 await page.evaluate(()=>window.releaseStart());
 await expect(dialog).toBeVisible();await expect(dialog.getByRole('group',{name:'Opponent',exact:true}).getByRole('radio',{name:'Babs',exact:true})).toBeChecked();
 expect(await page.evaluate(()=>window.created)).toEqual([{opponent:'self',side:'p1'}]);
});
