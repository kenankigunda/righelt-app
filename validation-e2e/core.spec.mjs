import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../scripts/validation/model.mjs';
import {createGameFromHome,openDirectGameLink,joinAsViewer,makeAnyLegalMove,getHistoryMoveCount,setOfflineState} from '../e2e/support/app.mjs';
async function proof(page,info,label,locator){
 if(!process.env.RIGHELT_EVIDENCE_DIR)return;
 const dir=path.join(process.env.RIGHELT_EVIDENCE_DIR,'images');await mkdir(dir,{recursive:true});const images=[];
 for(const [kind,target,options]of [['context',page,{fullPage:false}],['component',locator,{}]]){
   const bytes=await target.screenshot({animations:'disabled',...options});const digest=hash(bytes);const name=`${info.project.name}-${label}-${kind}-${digest.slice(0,12)}.png`;await writeFile(path.join(dir,name),bytes);
   const thumb=await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();const c=document.createElement('canvas');c.width=Math.min(480,image.width);c.height=Math.round(image.height*c.width/image.width);c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];},bytes.toString('base64'));await writeFile(path.join(dir,`thumb-${name}`),Buffer.from(thumb,'base64'));
   images.push({src:`images/${name}`,thumbnail:`images/thumb-${name}`,caption:`${label} · ${info.project.name} · ${kind}`,digest});
 }
 if(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+10)){const bytes=await page.screenshot({fullPage:true,animations:'disabled'});const digest=hash(bytes);const name=`${info.project.name}-${label}-full-${digest.slice(0,12)}.png`;await writeFile(path.join(dir,name),bytes);images.push({src:`images/${name}`,caption:`${label} · full page`,digest});}
 await info.attach('proof',{body:JSON.stringify(images),contentType:'application/json'});
}
async function geometry(page){await expect(page.getByTestId('game-board')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);}

test('create, move, viewer live update, reload and reconnect',async({page,context,browser,baseURL},info)=>{
 const options=info.project.use;const viewerContext=await browser.newContext({baseURL,viewport:options.viewport,isMobile:options.isMobile,hasTouch:options.hasTouch});const viewer=await viewerContext.newPage();
 try{
  const {gameHash}=await createGameFromHome(page);
  const players=page.locator('[data-action="switch-game-panel"][data-panel="players"]');if(await players.isVisible())await players.click();
  await page.getByRole('button',{name:'Play as both players',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play as both players',exact:true})).toHaveCount(0);
  const board=page.locator('[data-action="switch-game-panel"][data-panel="board"]');if(await board.isVisible())await board.click();
  await geometry(page);await proof(page,info,'created',page.getByTestId('game-board'));
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);const before=await getHistoryMoveCount(viewer);
  await makeAnyLegalMove(page);await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(before);
  await viewer.reload();await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(before);await geometry(viewer);await proof(viewer,info,'viewer-reloaded',viewer.getByTestId('game-board'));
  await setOfflineState(viewer,true);const offlineCount=await getHistoryMoveCount(viewer);await makeAnyLegalMove(page,'p2');await setOfflineState(viewer,false);await expect(viewer.getByTestId('game-shell')).toBeVisible();await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(before);
  await expect.poll(()=>getHistoryMoveCount(viewer)).toBeGreaterThan(offlineCount);
  await proof(viewer,info,'reconnected',viewer.getByTestId('game-board'));
  // Persistent synthetic fixture: the next merge stage must still hydrate this identity/game.
  if(process.env.RIGHELT_CONTINUITY_FILE&&info.project.name==='mid-wide'){
   await writeFile(process.env.RIGHELT_CONTINUITY_FILE,JSON.stringify({hash:gameHash,count:await getHistoryMoveCount(page),role:await page.getByTestId('game-role').textContent(),storage:await context.storageState()}));
  }
 }finally{await viewerContext.close();}
});

test('previous-stage identity and game survive migrations',async({browser,baseURL},info)=>{
 const file=process.env.RIGHELT_CONTINUITY_INPUT;test.skip(!file,'Baseline has no preceding stage');
 const prior=JSON.parse(await readFile(file,'utf8'));const opts=info.project.use;const context=await browser.newContext({baseURL,storageState:prior.storage,viewport:opts.viewport,isMobile:opts.isMobile,hasTouch:opts.hasTouch});
 try{const page=await context.newPage();await page.goto(`/${prior.hash}`);await expect(page.getByTestId('game-role')).toHaveText(prior.role);await expect.poll(()=>getHistoryMoveCount(page)).toBeGreaterThanOrEqual(prior.count);await proof(page,info,'upgrade-retained',page.getByTestId('game-board'));}finally{await context.close();}
});
