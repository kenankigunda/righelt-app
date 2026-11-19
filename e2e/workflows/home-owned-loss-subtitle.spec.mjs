import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame} from '../support/app.mjs';
const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const readGame=(page,id)=>page.evaluate(async id=>{const identityId=localStorage.getItem('righelt.identity.id.v1'),response=await fetch('/api/shell/games/'+encodeURIComponent(id)+'?identityId='+encodeURIComponent(identityId));if(!response.ok)throw Error('Read game HTTP '+response.status);return(await response.json()).game;},id);
const canonical=game=>({gameplayRevision:game.gameplayRevision,moves:game.moves,turns:game.turns,snapshot:game.board.state});

test('owned completed Home losses retain their secondary result beneath the winner',async({page,baseURL},info)=>{
 test.setTimeout(90000);const losses=[];
 for(const [title,status,creatorSide]of[
  ['Capture supply point to win by unsupplying the commander','p1_win','p2'],
  ['Commander surrounded loss of supply','p2_win','p1'],
 ]){
  const scenario=catalog.scenarios.find(s=>s.title===title);expect(scenario).toBeTruthy();
  const {gameId}=await importScenarioGame(page,scenario,baseURL,{open:false}),source=await readGame(page,gameId);expect(source.board.state.outcome.status).toBe(status);
  const game=await page.evaluate(async args=>{const identityId=localStorage.getItem('righelt.identity.id.v1');const response=await fetch('/api/shell/history/branch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identityId,protocolVersion:2,...args})});const body=await response.json();if(!response.ok)throw Error('Create owned catalog branch HTTP '+response.status+': '+JSON.stringify(body));return body.game;},{sourceGameId:gameId,sourceGameplayRevision:source.gameplayRevision,creatorSide});
  expect(game.board.state.outcome.status).toBe(status);losses.push({id:game.id,winner:status==='p1_win'?'Red won':'Blue won',before:canonical(game)});
 }
 // These are fresh local catalog imports and real API branches, not projected
 // cards or a replacement Home renderer. No production fixture is used.
 await page.goto('about:blank');
 for(const width of[1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('/#/');
  const completed=page.locator('[data-home-section-root="completed"]');await expect(completed).toBeVisible();await expect(completed.locator('a[data-game-id]').first()).toBeVisible();
  for(const loss of losses){
   const card=completed.locator('a[data-game-id="'+loss.id+'"]');
   if(!await card.count()){const next=completed.locator('[data-action="home-page-next"]');if(await next.isEnabled())await next.click();else await completed.locator('[data-action="home-page-prev"]').click();}
   await expect(card).toBeVisible();await expect(card.locator('.home-card-result-line')).toContainText(loss.winner+' on Turn');await expect(card.locator('.home-card-result > .small')).toHaveText('You lost');
   await expect(card.locator('.mini-board-preview-board .cell')).toHaveCount(100);await expect(card).toContainText('Review game');
   const geometry=await card.evaluate(n=>{const line=n.querySelector('.home-card-result-line'),winner=line.querySelector('strong'),suffix=line.querySelector('span'),detail=n.querySelector('.home-card-result > .small'),r=x=>x.getBoundingClientRect();return{line:r(line).height,winnerHeight:r(winner).height,suffixHeight:r(suffix).height,bottom:r(line).bottom,detailTop:r(detail).top,winner:getComputedStyle(winner).color,suffix:getComputedStyle(suffix).color,detail:getComputedStyle(detail).color,overflow:line.scrollWidth-line.clientWidth};});
   expect(geometry.line).toBeLessThanOrEqual(Math.max(geometry.winnerHeight,geometry.suffixHeight)+1);expect(geometry.detailTop).toBeGreaterThanOrEqual(geometry.bottom-.5);expect(geometry.winner).not.toBe(geometry.suffix);expect(geometry.winner).not.toBe(geometry.detail);expect(geometry.overflow).toBeLessThanOrEqual(1);
   if(width===390||loss===losses[0])await card.screenshot({path:info.outputPath('owned-loss-'+width+'-'+losses.indexOf(loss)+'.png')});
   expect(canonical(await readGame(page,loss.id))).toEqual(loss.before);
  }
 }
});
