import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';

const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const terminal=catalog.scenarios.find(record=>record.title==='Capture supply point to win by unsupplying the commander');
const readGame=async(page,gameId)=>page.evaluate(async gameId=>{
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
 const body=await response.json();if(!response.ok||!body.game)throw Error(`Read game failed HTTP ${response.status}`);return body.game;
},gameId);

for(const width of [390,1440])test(`completed game opens on its decisive turn and keeps that review accessible at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:1000});
 const {gameId}=await importScenarioGame(page,terminal,baseURL,{open:false});
 const game=await readGame(page,gameId),activeMoves=game.moves.filter(move=>move.undone!==true);
 expect(game.board.state.outcome.status).toBe('p1_win');expect(activeMoves.length).toBeGreaterThan(1);
 const finalTurn=activeMoves.at(-1).turnIndex,earlierTurn=activeMoves.find(move=>move.turnIndex<finalTurn).turnIndex;

 await page.goto('about:blank');await page.goto('/#/');
 const completed=page.locator('[data-home-section-root="completed"]');
 const card=completed.locator(`a[data-game-id="${gameId}"]`);await expect(card).toBeVisible();
 const result=card.locator('.home-card-result-line');await expect(result).toContainText(`won on Turn ${finalTurn+1}`);
 await expect(card.locator('.mini-board-preview-board .cell.history-role-source')).not.toHaveCount(0);
 await expect(card.locator('.mini-board-preview-board .cell.history-role-target')).not.toHaveCount(0);
 await expect(card.locator('.move-ghost')).toHaveCount(0);
 const paint=await result.evaluate(line=>{
  const strong=line.querySelector('strong'),suffix=line.querySelector('span');
  const winnerBounds=strong.getBoundingClientRect(),suffixBounds=suffix.getBoundingClientRect();
  return{winner:getComputedStyle(strong).color,suffix:getComputedStyle(suffix).color,lineHeight:line.getBoundingClientRect().height,winnerHeight:winnerBounds.height,suffixHeight:suffixBounds.height,gap:suffixBounds.left-winnerBounds.right,overflow:line.scrollWidth-line.clientWidth};
 });
 expect(paint.winner).not.toBe(paint.suffix);expect(paint.gap).toBeGreaterThan(1);expect(paint.lineHeight).toBeLessThanOrEqual(Math.max(paint.winnerHeight,paint.suffixHeight)+1);expect(paint.overflow).toBeLessThanOrEqual(1);

 if(width===390){
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect(result).toBeVisible();expect(await result.evaluate(line=>line.scrollWidth-line.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.emulateMedia({forcedColors:'active'});expect(await page.evaluate(()=>matchMedia('(forced-colors:active)').matches)).toBe(true);
  await expect(result).toBeVisible();await card.scrollIntoViewIfNeeded();await card.screenshot({path:info.outputPath('completed-card-200-percent-forced-colors.png')});
  await page.emulateMedia({forcedColors:'none'});await page.evaluate(()=>document.documentElement.style.fontSize='100%');
 }

 await card.focus();await expect(card).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.getByTestId('game-board')).toBeVisible();
 await expect(page.locator('#shell-board-turn-indicator')).toHaveText(new RegExp(`^(?:You|Guest(?: [12])?|.+) won on Turn ${finalTurn+1}$`));
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 await expect(page.locator('[data-testid="game-board"] .cell.history-role-source')).not.toHaveCount(0);
 await expect(page.locator('[data-testid="game-board"] .cell.history-role-target')).not.toHaveCount(0);

 await switchGamePanel(page,'history');
 const selected=page.locator('.history-turn-heading[aria-current="true"]');await expect(selected).toHaveText(`Turn ${finalTurn+1}`);
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 const earlier=page.locator(`[data-action="jump-history-turn"][data-turn-index="${earlierTurn}"]`);await earlier.focus();await expect(earlier).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('.history-turn-heading[aria-current="true"]')).toHaveText(`Turn ${earlierTurn+1}`);
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 await switchGamePanel(page,'board');await expect(page.locator('#shell-board-turn-indicator')).toHaveText(`Turn ${earlierTurn+1}`);
 await switchGamePanel(page,'history');await expect(page.locator('.history-turn-heading[aria-current="true"]')).toHaveText(`Turn ${earlierTurn+1}`);

 await page.locator('a[href="#/"]').first().click();
 const reentryCard=page.locator('[data-home-section-root="completed"]').locator(`a[data-game-id="${gameId}"]`);await expect(reentryCard).toBeVisible();
 await reentryCard.focus();await page.keyboard.press('Enter');
 await expect(page.locator('.history-turn-heading[aria-current="true"]')).toHaveText(`Turn ${finalTurn+1}`);
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);

 await page.reload();await expect(page.locator('.history-turn-heading[aria-current="true"]')).toHaveText(`Turn ${finalTurn+1}`);
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('completed-decisive-turn-review.png'),fullPage:true});
});
