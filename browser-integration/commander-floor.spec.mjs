// Actual native paint and geometry under the complete application CSS cascade.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
const state=JSON.parse(readFileSync('apps/web/scenarios/catalog.json','utf8')).scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;

test('real non-target rush commander shares the quiet cell floor under the actual full CSS cascade',async({page},info)=>{
 await page.setViewportSize({width:1200,height:1000});
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async state=>{
  const {listLegalActions}=await import('/apps/web/generated/packages/game-engine/src/index.js');
  await window.boardFixture.setup('rush',true);
  await window.boardFixture.configure(state,listLegalActions(state));
 },state);
 await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
 const source=page.locator('.cell[data-row="4"][data-col="6"]');await expect(source.locator('.piece-token.commander')).toHaveCount(1);await source.click();
 const target=page.locator('.rush-guidance-other');await expect(target).toHaveCount(1);await expect(target).toHaveAttribute('aria-label',/Other legal rush/);await target.hover();
 const floor=target.locator('.piece-token.commander.move-ghost > .commander-floor');await expect(floor).toHaveCount(1);
 const sample=await floor.evaluate(node=>{
  const cell=node.closest('.cell'),token=node.closest('.piece-token'),svg=token.querySelector('svg'),mineral=svg.querySelector('.piece-mineral'),cellStyle=getComputedStyle(cell),paint=el=>{const c=getComputedStyle(el);return{color:c.backgroundColor,image:c.backgroundImage,size:c.backgroundSize,origin:c.backgroundOrigin};};
  return{cell:paint(cell),floor:paint(node),cornerFraction:parseFloat(cellStyle.borderTopLeftRadius)/cell.getBoundingClientRect().width,allShadowsInset:cellStyle.boxShadow.split(/,(?![^(]*\))/).every(part=>part.includes('inset')),mineral:mineral?{fill:getComputedStyle(mineral).fill,pointerEvents:getComputedStyle(mineral).pointerEvents,strokeOpacity:Number(getComputedStyle(mineral).strokeOpacity)}:null,quiet:getComputedStyle(cell).getPropertyValue('--surface-hover-quiet').trim(),path:svg.querySelector('.piece-body').getAttribute('d'),viewBox:svg.getAttribute('viewBox'),tokenWidth:token.getBoundingClientRect().width,clip:getComputedStyle(node).clipPath,cells:document.querySelectorAll('#board > .cell').length,applied:window.boardFixture.applied().length,styles:[...document.styleSheets].map(sheet=>sheet.href)};
 });
 const metricsPath=info.outputPath('quiet-commander-floor-metrics.json');
 await writeFile(metricsPath,JSON.stringify(sample,null,2),{mode:0o600});
 await info.attach('Actual quiet cell and commander floor',{path:metricsPath,contentType:'application/json'});
 expect(sample.cornerFraction).toBeLessThan(.08);expect(sample.allShadowsInset).toBe(true);expect(sample.mineral).not.toBeNull();expect(sample.mineral.fill).toBe('none');expect(sample.mineral.pointerEvents).toBe('none');expect(sample.mineral.strokeOpacity).toBeGreaterThan(0);expect(sample.mineral.strokeOpacity).toBeLessThanOrEqual(.3);
 expect(sample.floor).toEqual(sample.cell);expect(sample.cell.image).toMatch(/^linear-gradient\(/);expect(sample.cell.image).not.toContain('url(');expect(sample.cell.color).toMatch(/^rgb\(/);
 expect(sample.quiet).toBe('rgb(37 43 45 / 6%)');expect(sample.path).toBe('M3 7L8 2H16L21 7V17L24 20V24H0V20L3 17Z M6 11H18V16H6Z');expect(sample.viewBox).toBe('0 0 24 24');expect(sample.tokenWidth).toBe(20);expect(sample.clip).not.toBe('none');expect(sample.cells).toBe(100);expect(sample.applied).toBe(0);
 const screenshotPath=info.outputPath('quiet-rush-commander-floor.png');
 await page.screenshot({path:screenshotPath});
 await info.attach('quiet rush commander floor',{path:screenshotPath,contentType:'image/png'});
});
