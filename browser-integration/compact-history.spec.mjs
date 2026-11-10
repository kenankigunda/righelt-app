import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const scenario=JSON.parse(readFileSync(new URL('../e2e/support/history-narration-scenarios.json',import.meta.url))).find(example=>example.name==='Push, retreat and followers').scenario;
for(const width of [320,1440])for(const scale of [100,200])test(`compact rail native target hierarchy at ${width}px and ${scale}%`,async({page},info)=>{
 await page.addInitScript(scenario=>{window.compactScenario=scenario;},scenario);
 await page.setViewportSize({width,height:1100});await page.goto('/browser-integration/support/compact-history.html');await page.waitForFunction(()=>window.fixtureReady);expect(await page.evaluate(()=>window.fixtureError??null)).toBeNull();await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
 const turn=page.getByTestId('history-turn');await expect(turn.locator('.history-turn-heading')).toHaveText('Turn 37');await expect(turn.locator('.history-move-line')).toHaveCount(6);
 expect(await turn.getByTestId('history-move-item').evaluateAll(nodes=>nodes.map(node=>node.dataset.moveId))).toEqual(['record-5','record-4','record-3','record-2','record-1','record-0']);
 const rail=await turn.locator(':scope > .history-list-nested').evaluate(node=>({rail:getComputedStyle(node).borderLeftColor,owner:getComputedStyle(node.parentElement).color,defender:getComputedStyle(node.querySelector('[data-move-id="record-1"]')).color}));expect(rail.rail).toBe(rail.owner);expect(rail.defender).not.toBe(rail.owner);
 const backgrounds=await turn.locator('.history-turn-hit,.history-move-hit').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));expect(backgrounds.every(value=>value==='rgba(0, 0, 0, 0)')).toBe(true);
 const turnHit=turn.locator(':scope > .history-turn-hit');await turnHit.focus();await page.keyboard.press('Space');await expect(turn.locator(':scope > .history-turn-hit')).toHaveCount(0);expect(await page.evaluate(()=>window.historyActions)).toEqual(['jump-history-turn']);
 const defender=turn.locator('[data-testid="history-move-item"][data-move-id="record-1"]');await defender.locator('.history-move-hit').focus();await page.keyboard.press('Enter');await expect(defender).toHaveClass(/is-selected/);await expect(defender.locator('.history-move-hit')).toHaveCount(0);expect(await page.evaluate(()=>window.historyActions)).toEqual(['jump-history-turn','jump-history']);
 const selected=await defender.boundingBox();await page.mouse.click(selected.x+selected.width-4,selected.y+4);expect(await page.evaluate(()=>window.historyActions)).toEqual(['jump-history-turn','jump-history']);
 await defender.getByRole('button',{name:'Undo before this move',exact:true}).click();expect(await page.evaluate(()=>window.historyActions)).toEqual(['jump-history-turn','jump-history','revert-to-move']);
 expect(await page.locator('button button')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 if(width===320){for(const button of await page.locator('.history-move-hit,.history-item-actions button').all()){const rect=await button.boundingBox();expect(rect.height).toBeGreaterThanOrEqual(44);}}
 await page.screenshot({path:info.outputPath('compact-selected-defender.png'),fullPage:true});
});

test('undone disclosure retains native priority above the aggregate target',async({page},info)=>{
 await page.addInitScript(scenario=>{window.compactScenario=scenario;},scenario);await page.goto('/browser-integration/support/compact-history.html');await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(()=>window.addUndoneHistory());
 const toggle=page.getByRole('button',{name:'1 move undone',exact:true});await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
 const row=page.locator('[data-move-id="undone-record"]');await expect(row).toBeVisible();expect(await page.evaluate(()=>window.historyActions)).toEqual(['toggle-undone-group']);
 const hit=row.locator(':scope > .history-move-hit');
 const geometry=await hit.evaluate(node=>{const style=getComputedStyle(node),box=node.getBoundingClientRect(),owner=node.parentElement.getBoundingClientRect();return{position:style.position,background:style.backgroundColor,border:style.borderTopWidth,x:box.x,y:box.y,width:box.width,height:box.height,owner:{x:owner.x,y:owner.y,width:owner.width,height:owner.height}};});
 expect(geometry.position).toBe('absolute');expect(geometry.background).toBe('rgba(0, 0, 0, 0)');expect(geometry.border).toBe('0px');
 for(const key of ['x','y','width','height'])expect(Math.abs(geometry[key]-geometry.owner[key])).toBeLessThanOrEqual(1);
 await hit.click();await expect(row).toHaveClass(/is-selected/);await expect(row.locator('.history-move-hit')).toHaveCount(0);
 expect(await page.evaluate(()=>window.historyActions)).toEqual(['toggle-undone-group','jump-history']);
 await page.screenshot({path:info.outputPath('compact-undone-native-target.png'),fullPage:true});
 await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-expanded','false');expect(await page.evaluate(()=>window.historyActions)).toEqual(['toggle-undone-group','jump-history','toggle-undone-group']);
});

test('native History hover stays a quiet owner wash rather than a generic paper button',async({page},info)=>{
 await page.addInitScript(scenario=>{window.compactScenario=scenario;},scenario);await page.goto('/browser-integration/support/compact-history.html');await page.waitForFunction(()=>window.fixtureReady);
 for(const target of [page.locator('.history-turn-hit').first(),page.locator('.history-move-hit').first()]){
  await target.hover({position:{x:12,y:12}});
  await expect.poll(()=>target.evaluate(node=>getComputedStyle(node).backgroundColor)).toMatch(/0\.05\b/);
  await expect.poll(()=>target.evaluate(node=>getComputedStyle(node).boxShadow)).toBe('none');
 }
 await page.screenshot({path:info.outputPath('compact-native-hover.png'),fullPage:true});
});
