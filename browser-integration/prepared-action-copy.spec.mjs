import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

for(const width of [390,1440])for(const textSize of [100,200]){
 test(`prepared action wording preserves native confirmation and Board geometry (${width}px ${textSize}% text)`,async({page},info)=>{
  await page.setViewportSize({width,height:1200});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async size=>{document.documentElement.style.fontSize=size+'%';await document.fonts.ready;await window.boardFixture.setup('project',false);},textSize);
  const source=page.locator('#board [data-row="4"][data-col="2"]'),target=page.locator('#board [data-row="4"][data-col="3"]');
  await source.click();
  const before=await page.locator('#board').boundingBox();
  await target.click();
  const message=page.locator('#preview');
  await expect(message).toHaveText(/^Project new piece to\s+4,\s*3$/);
  await expect(message.locator('strong')).toContainText('Project new piece to');
  await expect(message.locator('.board-preview-coordinate-chip')).toHaveCount(1);
  await expect(message).not.toContainText('Confirm');
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const prepared=await page.locator('#board').boundingBox();
  expect(Math.abs(prepared.y-before.y)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('prepared-action.png')});
  await target.click();
  await expect.poll(()=>page.evaluate(()=>window.boardFixture.applied())).toEqual([{type:'project',actorId:'A',from:{row:4,col:2},to:{row:4,col:3}}]);
  await writeFile(info.outputPath('confirmation-proof.json'),JSON.stringify({width,textSize,before,prepared,applied:await page.evaluate(()=>window.boardFixture.applied())},null,2));
 });
}
