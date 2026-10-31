import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
const examples=JSON.parse(readFileSync(new URL('../support/history-narration-scenarios.json',import.meta.url)));
const point=at=>`(${at.row}, ${at.col})`;
const actionCopy=action=>({rush:`rushed from ${point(action.from)} to ${point(action.to)}`,project:`projected new piece from ${point(action.from)} to ${point(action.to)}`,push:`pushed onto ${point(action.to)}`,retreat:`retreated from ${point(action.from)} to ${point(action.to)}`,follow:`followed from ${point(action.from)} to ${point(action.to)}`})[action.type];
for(const width of [390,1440])for(const example of examples)test(`${example.name}: acknowledged narration and fixed inspection title at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:1100});
 const {gameId}=await importScenarioGame(page,example.scenario,baseURL);
 const game=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
 const moves=game.moves.filter(move=>!move.undone&&move.action.type!=='end_turn');expect(moves.length).toBeGreaterThan(0);
 await switchGamePanel(page,'history');
 for(const move of moves){
  const row=page.locator(`[data-testid="history-move-item"][data-move-id="${move.moveId}"]`);await row.locator(':scope > .history-move-hit').click();
  const narration=width<900?page.locator('.history-inline-narration'):page.locator('#shell-board-preview-label');
  await expect.poll(()=>narration.evaluate(node=>{const copy=node.cloneNode(true);for(const chip of copy.querySelectorAll('.board-preview-coordinate-chip'))chip.textContent=`(${chip.textContent})`;return copy.textContent;})).toContain(actionCopy(move.action));
  await expect(row).toContainText(`Move ${move.displayMoveNumber??move.index+1}:`);
  if(width>=900)await expect(page.locator('.board-heading:not(.board-heading-sizing)')).toContainText(`Move ${move.displayMoveNumber??move.index+1}`);
  else{await expect(page.getByTestId('history-inline-preview').locator('h2,h3')).toHaveCount(0);}
  const chips=narration.locator('.board-preview-coordinate-chip');await expect(chips).not.toHaveCount(0);
 }
 const last=page.locator(`[data-testid="history-move-item"][data-move-id="${moves.at(-1).moveId}"]`);
 await last.locator('xpath=ancestor::li[contains(@class,"history-turn")]/button[contains(@class,"history-turn-hit")]').click();
 const narration=width<900?page.locator('.history-inline-narration'):page.locator('#shell-board-preview-label');
 const plain=()=>narration.evaluate(node=>{const copy=node.cloneNode(true);for(const chip of copy.querySelectorAll('.board-preview-coordinate-chip'))chip.textContent=`(${chip.textContent})`;return copy.textContent;});
 if(example.name==='Three rushes')await expect.poll(plain).toContain('rushed 3 pieces to (5, 5), (6, 4), and (5, 3)');
 if(example.name==='Push, retreat and followers')await expect.poll(plain).toContain('pushed onto (7, 0) and had 4 pieces follow');
 await page.screenshot({path:info.outputPath('acknowledged-turn-narration.png'),fullPage:true});
 await info.attach('recorded-narration-contract',{body:JSON.stringify({gameId,moves:moves.map(move=>({moveId:move.moveId,index:move.index,actorSide:move.actorSide,action:move.action}))}),contentType:'application/json'});
});
