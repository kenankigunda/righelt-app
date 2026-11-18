import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const scenario=catalog.scenarios.find(record=>record.title==='Standard rush');
const canonical=async(page,id)=>page.evaluate(async id=>{
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(`/api/shell/games/${encodeURIComponent(id)}?identityId=${encodeURIComponent(identityId)}`);
 const body=await response.json();if(!response.ok||!body.game)throw Error(`Canonical read ${response.status}`);
 return {board:body.game.board,moves:body.game.moves,revision:body.game.gameplayRevision};
},id);
const settled=async page=>{
 await expect(page.locator('#app')).toHaveAttribute('data-shell-route','game');
 await expect(page.locator('#shell-route-transition-layer')).toHaveAttribute('data-phase','idle');
 await expect(page.getByTestId('game-board')).toBeVisible();
};
for(const width of [1440,390])test(`explicit ongoing Home entry is live while native traversal restores each visit at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:1000});
 const {gameId}=await importScenarioGame(page,scenario,baseURL);
 const before=await canonical(page,gameId);expect(before.board.state.outcome.status).toBe('ongoing');
 await settled(page);await switchGamePanel(page,'history');
 const row=page.getByTestId('history-move-item').first();
 const firstId=await row.getAttribute('data-move-id');
 await row.locator(':scope > .history-move-hit').click();await expect(row).toHaveAttribute('aria-current','true');
 // Keep the native mobile History visit; returning to Board deliberately means live there.
 const historySelected=()=>expect(page.locator(`[data-testid="history-move-item"][data-move-id="${firstId}"]`)).toHaveAttribute('aria-current','true');
 await page.getByRole('link',{name:'Righelt',exact:true}).click();
 await expect(page.locator('#app')).toHaveAttribute('data-shell-route','home');
 await page.goBack();await expect(page.locator('#app')).toHaveAttribute('data-shell-route','game');await historySelected();
 await page.goForward();await expect(page.locator('#app')).toHaveAttribute('data-shell-route','home');
 await page.locator(`[data-home-section-root="my"] a[data-game-id="${gameId}"]`).click();await settled(page);
 await expect(page.locator('#app')).toHaveAttribute('data-shell-game-panel','board');
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 await expect(page.locator('[data-testid="game-board"] .history-role-source')).toHaveCount(0);
 await expect(page.locator('[data-testid="game-board"] .history-role-target')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('explicit-home-live.png')});
 await page.goBack();await expect(page.locator('#app')).toHaveAttribute('data-shell-route','home');
 await page.goBack();await expect(page.locator('#app')).toHaveAttribute('data-shell-route','game');await historySelected();
 await page.goForward();await expect(page.locator('#app')).toHaveAttribute('data-shell-route','home');
 await page.goForward();await settled(page);
 await expect(page.getByTestId('history-return-live')).toHaveCount(0);
 expect(await canonical(page,gameId)).toEqual(before);
});
