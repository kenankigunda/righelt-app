import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
import {COMPUTER_TIMING,CURRENT_COMPUTER_MODEL} from '../../packages/shared-types/src/computer-play.ts';
const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const terminalScenario=catalog.scenarios.find(record=>record.title==='Capture supply point to win by unsupplying the commander');
const request=(page,path,body)=>page.evaluate(async({path,body})=>{
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({identityId,protocolVersion:2,...body})})});
 const result=await response.json();if(!response.ok)throw Error(`${path}: ${response.status} ${JSON.stringify(result)}`);return result;
},{path,body});
for(const width of [390,1440])test(`completed computer games stay read-only and Players identities remain clear at ${width}px`,async({page,browser,baseURL},info)=>{
 await page.setViewportSize({width,height:1000});
 // A parser-only document proves the fallback before app execution. Its
 // auxiliary page inspects only the actually served native SVG, not app state.
 if(width===1440){
  const parser=await browser.newContext({javaScriptEnabled:false});
  try{
   const initial=await parser.newPage();await initial.goto(baseURL);await expect(initial).toHaveTitle('Righelt');
   const icon=initial.locator('link[rel="icon"]');await expect(icon).toHaveAttribute('type','image/svg+xml');
   const href=await icon.evaluate(element=>element.href);expect(new URL(href).origin).toBe(new URL(baseURL).origin);
   const response=await initial.request.get(href);expect(response.ok()).toBe(true);expect(response.headers()['content-type']).toContain('image/svg+xml');
   const specimen=await parser.newPage();await specimen.goto(baseURL);await specimen.evaluate(()=>{document.body.replaceChildren();document.body.style.cssText='margin:0;background:white';});
   const metrics=await specimen.evaluate(async href=>{
    const result=[];for(const size of [16,32]){
     const image=new Image(size,size);image.src=href;image.alt=`Righelt favicon ${size}`;document.body.append(image);await image.decode();
     const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const context=canvas.getContext('2d');context.drawImage(image,0,0,size,size);
     const pixels=context.getImageData(0,0,size,size).data;let visible=0,red=0,blue=0;
     for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>128){visible++;if(pixels[i]>pixels[i+2]*1.3&&pixels[i]>pixels[i+1]*1.3)red++;if(pixels[i+2]>pixels[i]*1.3&&pixels[i+2]>pixels[i+1]*1.1)blue++;}
     result.push({size,visible,red,blue,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight});
    }return result;
   },href);
   for(const metric of metrics){expect(metric.visible).toBeGreaterThan(metric.size*metric.size*.1);expect(metric.red).toBeGreaterThan(0);expect(metric.blue).toBeGreaterThan(0);}
   for(const size of [16,32]){const image=specimen.getByRole('img',{name:`Righelt favicon ${size}`,exact:true});const path=info.outputPath(`favicon-${size}.png`);await image.screenshot({path});await info.attach(`favicon-${size}`,{path,contentType:'image/png'});}
   const path=info.outputPath('document-icon-metrics.json');await writeFile(path,JSON.stringify({fallbackTitle:await initial.title(),href,metrics},null,2),{mode:0o600});await info.attach('document-icon-metrics',{path,contentType:'application/json'});
  }finally{await parser.close();}
 }

 const {gameId:sourceId}=await importScenarioGame(page,terminalScenario,baseURL,{open:false});
 await expect(page).toHaveTitle('Righelt');
 const identityId=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
 const {game:source}=await request(page,`/api/shell/games/${sourceId}?identityId=${encodeURIComponent(identityId)}`);
 expect(source.board.state.outcome.status).toBe('p1_win');
 // Branch the acknowledged terminal position through the real API. This keeps
 // a real computer seat without inventing a result or a fake local projection.
 const {game:finished}=await request(page,'/api/shell/history/branch',{sourceGameId:sourceId,sourceGameplayRevision:source.gameplayRevision,creatorSide:'p1',computer:{p1:null,p2:'horus'},computerModelId:CURRENT_COMPUTER_MODEL.id});
 expect(finished.board.state.outcome.status).toBe('p1_win');expect(finished.computer.seats.p2).toBe('horus');
 const automatic=[];page.on('request',value=>{
  if(value.method()!=='POST')return;
  const path=new URL(value.url()).pathname;if(!path.startsWith(`/api/shell/games/${finished.id}/`))return;
  const body=value.postDataJSON();
  if(path.endsWith('/shared')&&body.payload?.operation==='computer-control'||path.endsWith('/decision-attempt')&&body.operation==='write'&&body.kind==='computer'||path.endsWith('/apply')&&body.payload?.computer)automatic.push({path,body});
 });
 await page.goto(`/#/game/${finished.id}`);await expect(page.getByTestId('game-board')).toBeVisible();await expect(page).toHaveTitle(`game-${finished.id.slice(5,11)} | Righelt`);
 await switchGamePanel(page,'players');
 const computer=page.getByRole('button',{name:'Horus, Blue, Computer player, Game finished',exact:true});await expect(computer).toBeVisible();await expect(computer).toHaveAccessibleName('Horus, Blue, Computer player, Game finished');
 const bot=computer.locator('.computer-status-badge > .righelt-icon');await expect(bot).toBeVisible();expect((await bot.boundingBox()).width).toBe(22);const mark=computer.locator('.computer-status-mark');await expect(mark).toBeVisible();expect((await mark.boundingBox()).width).toBe(15);await expect(computer.locator('[data-computer-activity]')).toHaveAttribute('data-computer-activity','finished');
 await expect(computer).not.toContainText('Computer');await computer.click();await expect(page.getByRole('button',{name:'Resume here',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('completed-computer-players.png')});
 await switchGamePanel(page,'history');const summary=page.getByTestId('history-result-summary');await expect(summary).toContainText('You won');await expect(summary).toContainText('Red');
 expect(await summary.evaluate(element=>Boolean(element.compareDocumentPosition(element.parentElement.querySelector('[data-testid="history-list"]'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await page.getByRole('button',{name:'View result',exact:true}).click();await page.getByRole('button',{name:'Review game',exact:true}).click();await expect(summary).toBeVisible();
 await page.reload();await expect(summary).toBeVisible();await expect(summary).toContainText('You won');
 await page.screenshot({path:info.outputPath('completed-history-result.png')});
 await switchGamePanel(page,'board');await expect(page.locator('#shell-board-turn-indicator')).toHaveText('Game complete');await expect(page.locator('#shell-board-preview-label')).toHaveText('Review the game in History');await expect(page.locator('[data-alert-stack-card].is-active [data-board-context] .board-context-content').filter({hasText:/^Game complete$/})).toHaveCount(0);await expect(page.locator('.board-message-activity')).toHaveAttribute('data-loading-state','idle');
 await expect(page.locator('#shell-board-preview-label [data-board-message-action="pass"],#shell-board-preview-label [data-board-preview-action="pass"],#shell-board-preview-label [data-board-preview-action="end-turn"]')).toHaveCount(0);
 const revision=finished.gameplayRevision;await page.waitForTimeout(COMPUTER_TIMING.renewAfterMs+250);
 const {game:after}=await request(page,`/api/shell/games/${finished.id}?identityId=${encodeURIComponent(identityId)}`);expect(after.gameplayRevision).toBe(revision);expect(automatic).toEqual([]);
 const {game:guests}=await request(page,'/api/shell/games',{selfPlayMode:true});await page.goto(`/#/game/${guests.id}`);await switchGamePanel(page,'players');
 for(const [index,color]of [[1,'Red'],[2,'Blue']]){
  const row=page.getByTestId(`participant-player-${index}`);await expect(row.locator('.player-name')).toHaveText(`Guest ${index}`);await expect(row.getByRole('button')).toHaveAccessibleName(new RegExp(`Guest ${index}, you, ${color}`));
 }
 await page.screenshot({path:info.outputPath('guest-player-identities.png')});
 await info.attach('completed-game-authority',{contentType:'application/json',body:JSON.stringify({gameId:finished.id,before:revision,after:after.gameplayRevision,automatic})});
});
