import {e2eControlPort} from '../../scripts/e2e-control.mjs';
import {test,expect} from '@playwright/test';
import {createGameFromHome,makeAnyLegalMove,getHistoryMoveCount,openHistoryMode,returnToLive} from '../support/app.mjs';

test.skip(process.env.RIGHELT_E2E_STORAGE_ARCHIVES!=='1','Requires the disposable local archive fixture');
const control=async(request,baseURL,route,body)=>{
 const url=new URL(baseURL);url.port=String(e2eControlPort(url.port));url.pathname=route;
 const result=await request.post(url.href,{data:body});expect(result.ok()).toBe(true);return route==='/storage'?result.json():null;
};

test('archive preserves browser history, direct links and exactly-once resumed play',async({page,request,baseURL},info)=>{
 test.setTimeout(120000);
 const {gameId,gameHash}=await createGameFromHome(page);
 await page.getByRole('button',{name:'Play as both players',exact:true}).click();
 await expect(page.getByRole('button',{name:'Play as both players',exact:true})).toHaveCount(0);
 await makeAnyLegalMove(page);
 const count=await getHistoryMoveCount(page);
 await control(request,baseURL,'/storage',{action:'age',gameId});
 let archived;
 for(let i=0;i<20;i++){
  await control(request,baseURL,'/storage',{action:'tick',gameId});
  archived=await control(request,baseURL,'/storage',{action:'status',gameId});
  if(archived.archive?.status==='archived')break;
 }
 expect(archived.archive?.status).toBe('archived');expect(archived.payload).toBe(false);
 await page.reload();
 await expect(page.getByTestId('game-role')).toContainText('both players');
 await expect.poll(()=>getHistoryMoveCount(page)).toBe(count);
 await expect(page.getByRole('img',{name:'Connected',exact:true})).toHaveCount(2);
 await openHistoryMode(page,0);
 await expect(page.getByTestId('history-return-live')).toBeVisible();
 await returnToLive(page);
 expect((await control(request,baseURL,'/storage',{action:'status',gameId})).archive?.status).toBe('archived');
 await expect(page.getByRole('img',{name:'Connected',exact:true})).toHaveCount(2);
 await page.screenshot({path:info.outputPath('archived-history.png')});
 await makeAnyLegalMove(page,'p2');
 await expect.poll(()=>getHistoryMoveCount(page)).toBe(count+1);
 expect((await control(request,baseURL,'/storage',{action:'status',gameId})).archive).toBeNull();
 await page.goto('/');await page.goto(gameHash);
 await expect.poll(()=>getHistoryMoveCount(page)).toBe(count+1);
 await page.screenshot({path:info.outputPath('restored-game.png')});
});

test('reset fences a stale tab and creates a fresh game in the new generation',async({page,request,baseURL},info)=>{
 test.setTimeout(120000);
 const {gameId}=await createGameFromHome(page);
 const before=await (await request.get('/api/shell/bootstrap')).json();
 await control(request,baseURL,'/reset-storage',{});
 const after=await (await request.get('/api/shell/bootstrap')).json();expect(after.storageGeneration).not.toBe(before.storageGeneration);
 // The stale client still holds the old generation until it sees the fence.
 const rejected=await request.post(`/api/shell/games/${gameId}/play-as-both`,{headers:{'X-Righelt-Storage-Generation':before.storageGeneration},data:{identityId:'stale',protocolVersion:2}});
 expect(rejected.status()).toBe(409);expect((await rejected.json()).error).toBe('storage_reset');
 await expect(page).toHaveURL(/#\/$/);
 await expect(page.getByRole('status').filter({hasText:'The saved data was reset'})).toBeVisible();
 await page.screenshot({path:info.outputPath('storage-reset.png')});
 const fresh=await createGameFromHome(page);expect(fresh.gameId).not.toBe(gameId);
 const removed=await request.get(`/api/shell/games/${gameId}?identityId=stale`);expect(removed.status()).toBe(404);
});
