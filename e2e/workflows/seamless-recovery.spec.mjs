import {test,expect} from '@playwright/test';
import {createGameFromHome,makeAnyLegalMove,openHistoryMode,returnToLive,createIsolatedPage,openDirectGameLink,closeContextQuietly,getHistoryMoveCount} from '../support/app.mjs';

for(const width of [390,1440])test(`lazy history retains the selected board through failure and works from cache offline at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});
 const {gameId}=await createGameFromHome(page);
 const tabs=await page.getByRole('button',{name:'Players',exact:true}).isVisible();
 if(tabs)await page.getByRole('button',{name:'Players',exact:true}).click();
 await page.getByRole('button',{name:'Play as both players',exact:true}).click();
 if(tabs)await page.getByRole('button',{name:'Board',exact:true}).click();
 await makeAnyLegalMove(page,'p1');await makeAnyLegalMove(page,'p2');
 await page.reload();await expect(page.getByTestId('game-board')).toBeVisible();
 await openHistoryMode(page,0);
 const selected=await page.getByTestId('game-board').innerHTML();
 let fail=true,reads=0;
 await page.route(`**/api/shell/games/${gameId}/decision-snapshot`,async route=>{reads++;if(fail)await route.abort();else await route.continue();});
 await page.locator('[data-testid="history-move-item"][data-move-index="0"] .history-move-line').click();
 await expect(page.getByText('This move couldn’t load. Your current view is still available.')).toBeVisible();
 const status=page.getByTestId('history-load-status');
 await expect(status).toBeVisible();
 expect(await status.evaluate(element=>Boolean(element.closest('[data-tool="history"],section.panel')))).toBe(true);
 const statusBox=await status.boundingBox(),logoBox=await page.getByRole('img',{name:'Righelt',exact:true}).boundingBox();
 expect(statusBox.y).toBeGreaterThanOrEqual(logoBox.y+logoBox.height);
 expect(await page.getByTestId('game-board').innerHTML()).toBe(selected);
 await expect(page.locator('[data-testid="history-move-item"][data-move-index="1"]')).toHaveClass(/is-selected/);
 await page.screenshot({path:info.outputPath(`history-retry-${width}.png`)});
 fail=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.locator('[data-testid="history-move-item"][data-move-index="0"]')).toHaveClass(/is-selected/);
 await returnToLive(page);const before=reads;
 await page.context().setOffline(true);
 try{await openHistoryMode(page,0);expect(reads).toBe(before);await returnToLive(page);}
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
