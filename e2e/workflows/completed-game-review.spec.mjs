import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
import {COMPUTER_TIMING,CURRENT_COMPUTER_MODEL} from '../../packages/shared-types/src/computer-play.ts';
const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const terminalScenario=catalog.scenarios.find(record=>record.title==='Capture supply point to win by unsupplying the commander');
const request=(page,path,body)=>page.evaluate(async({path,body})=>{
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({identityId,protocolVersion:2,...body})})});
 const result=await response.json();if(!response.ok)throw Error(`${path}: ${response.status} ${JSON.stringify(result)}`);return result;
},{path,body});
for(const width of [390,1440])test(`completed computer games stay read-only and Players identities remain clear at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:1000});
 const {gameId:sourceId}=await importScenarioGame(page,terminalScenario,baseURL,{open:false});
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
 await page.goto(`/#/game/${finished.id}`);await expect(page.getByTestId('game-board')).toBeVisible();
 await switchGamePanel(page,'players');
 const computer=page.getByRole('button',{name:'Horus, Blue, Game finished',exact:true});await expect(computer).toBeVisible();await expect(computer).toHaveAccessibleDescription('Computer player');
 const mark=computer.locator('.player-kind-icon .righelt-icon');await expect(mark).toBeVisible();expect((await mark.boundingBox()).width).toBeLessThanOrEqual(16);
 await expect(computer).not.toContainText('Computer');await computer.click();await expect(page.getByRole('button',{name:'Resume here',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('completed-computer-players.png')});
 await switchGamePanel(page,'history');const summary=page.getByTestId('history-result-summary');await expect(summary).toContainText('You won');await expect(summary).toContainText('Red');
 expect(await summary.evaluate(element=>Boolean(element.compareDocumentPosition(element.parentElement.querySelector('[data-testid="history-list"]'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await page.getByRole('button',{name:'View result',exact:true}).click();await page.getByRole('button',{name:'Review game',exact:true}).click();await expect(summary).toBeVisible();
 await page.reload();await expect(summary).toBeVisible();await expect(summary).toContainText('You won');
 await page.screenshot({path:info.outputPath('completed-history-result.png')});
 await switchGamePanel(page,'board');await expect(page.locator('#shell-board-turn-indicator')).toHaveText('Game complete');await expect(page.locator('#shell-board-preview-label')).toHaveText('Game complete');await expect(page.locator('.board-message-activity')).toHaveAttribute('data-loading-state','idle');
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
