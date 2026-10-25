import {test,expect} from '@playwright/test';
import {createGameFromHome,makeAnyLegalMove,returnToLive,createIsolatedPage,openDirectGameLink,closeContextQuietly,getHistoryMoveCount,switchGamePanel} from '../support/app.mjs';

import {readProjectedGame} from '../support/computer-projection.mjs';

for(const width of [390,1440])test(`lazy history retains the selected board through failure and works from cache offline at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const {gameId}=await createGameFromHome(page);
 await switchGamePanel(page,'players');
 const playBoth=page.locator('button[data-action="play-as-both-players"]');
 await playBoth.click();await expect(playBoth).toHaveCount(0);
 await switchGamePanel(page,'board');
 await makeAnyLegalMove(page,'p1');await makeAnyLegalMove(page,'p2');
 await page.reload();await expect(page.getByTestId('game-board')).toBeVisible();
 const game=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
 const moves=game.moves.filter(move=>!move.undone);expect(moves).toHaveLength(2);
 for(const move of moves)expect(move.moveId).toBeTruthy();
 const rowFor=move=>page.locator(`[data-testid="history-move-item"][data-move-id="${move.moveId}"]`);
 // Start at the later move, then fail loading the earlier one. Narrow history
 // owns an after-state preview; its board remains the live board throughout.
 const narrow=await page.locator('#app').getAttribute('data-shell-layout-mode')==='narrow';
 const liveBoard=narrow?await page.getByTestId('game-board').innerHTML():null;
 await switchGamePanel(page,'history');
 await rowFor(moves[1]).locator('.history-item-info').click();
 await expect(rowFor(moves[1])).toHaveClass(/is-selected/);
 const selectedSurface=narrow?rowFor(moves[1]).getByTestId('history-inline-preview'):page.getByTestId('game-board');
 await expect(selectedSurface.locator('.cell')).toHaveCount(100);
 const selected=await selectedSurface.innerHTML();
 let fail=true,reads=0;
 await page.route(`**/api/shell/games/${gameId}/decision-snapshot`,async route=>{reads++;if(fail)await route.abort();else await route.continue();});
 await rowFor(moves[0]).locator('.history-move-line').click();
 await expect(page.getByText('This move couldn’t load. Your current view is still available.')).toBeVisible();
 const status=page.getByTestId('history-load-status');
 await expect(status).toBeVisible();
 expect(await status.evaluate(element=>Boolean(element.closest('[data-tool="history"],section.panel')))).toBe(true);
 const statusBox=await status.boundingBox(),logoBox=await page.getByRole('img',{name:'Righelt',exact:true}).boundingBox();
 expect(statusBox.y).toBeGreaterThanOrEqual(logoBox.y+logoBox.height);
 expect(await selectedSurface.innerHTML()).toBe(selected);
 if(narrow)expect(await page.getByTestId('game-board').innerHTML()).toBe(liveBoard);
 await expect(rowFor(moves[1])).toHaveClass(/is-selected/);
 await page.screenshot({path:info.outputPath(`history-retry-${width}.png`)});
 fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(rowFor(moves[0])).toHaveClass(/is-selected/);
 if(narrow){await expect(rowFor(moves[0]).getByTestId('history-inline-preview').locator('.cell')).toHaveCount(100);expect(await page.getByTestId('game-board').innerHTML()).toBe(liveBoard);}
 await returnToLive(page);await switchGamePanel(page,'board');const before=reads;
 await page.context().setOffline(true);
 try{await switchGamePanel(page,'history');await rowFor(moves[0]).locator('.history-item-info').click();await expect(rowFor(moves[0])).toHaveClass(/is-selected/);expect(reads).toBe(before);if(narrow)await expect(rowFor(moves[0]).getByTestId('history-inline-preview').locator('.cell')).toHaveCount(100);await returnToLive(page);}
 finally{await page.context().setOffline(false);}
});

test('a browser without WebSockets keeps a viewer current through HTTP polling',async({browser,baseURL})=>{
 const creator=await createIsolatedPage(browser),viewer=await createIsolatedPage(browser);
 try{
  await viewer.page.addInitScript(()=>{window.WebSocket=undefined;});
  const {gameHash}=await createGameFromHome(creator.page);
  await openDirectGameLink(viewer.page,baseURL,gameHash);
  await expect(viewer.page.getByTestId('game-board')).toBeVisible();
  const before=await getHistoryMoveCount(viewer.page);
  await makeAnyLegalMove(creator.page,'p1');
  await expect.poll(()=>getHistoryMoveCount(viewer.page),{timeout:12000}).toBeGreaterThan(before);
  await expect(viewer.page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 }finally{await closeContextQuietly(creator.context);await closeContextQuietly(viewer.context);}
});
