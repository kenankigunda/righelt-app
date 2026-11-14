import {test,expect} from '@playwright/test';
import {closeContextQuietly,createGameFromHome,createIsolatedPage,switchGamePanel} from '../support/app.mjs';

test('localized etched start identity keeps its fixed slot on Home and Game',async({browser},info)=>{
 const {context,page}=await createIsolatedPage(browser);
 try{
  const {gameId}=await createGameFromHome(page);
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});
   await page.getByRole('link',{name:'Righelt'}).click();
   const card=page.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`),title=card.locator('.game-identity-title');
   await expect(card).toBeVisible();await expect(title.locator('.game-date-inlay')).toBeVisible();await expect(title.locator('.player-emblem')).toHaveCount(1);
   await expect(title.locator('.game-date-inlay')).toHaveAttribute('aria-label',/^Started .+, (late night|early morning|mid morning|noon|afternoon|evening|night)$/);
   const home=await title.evaluate(node=>{const icon=node.querySelector('.game-date-inlay'),names=node.querySelector('.game-title-matchup'),a=icon.getBoundingClientRect(),b=names.getBoundingClientRect(),root=document.documentElement;return{icon:a.toJSON(),names:b.toJSON(),rootFont:parseFloat(getComputedStyle(root).fontSize),overflow:root.scrollWidth-root.clientWidth};});
   expect(home.icon.width).toBeCloseTo(home.rootFont*3,1);expect(home.icon.height).toBeCloseTo(home.rootFont*3.5,1);expect(Math.abs(home.icon.top-home.names.top)).toBeLessThanOrEqual(1);expect(home.overflow).toBeLessThanOrEqual(1);
   if(width===390){await page.evaluate(()=>document.documentElement.style.fontSize='200%');const zoomed=await title.evaluate(node=>{const icon=node.querySelector('.game-date-inlay').getBoundingClientRect(),names=node.querySelector('.game-title-matchup').getBoundingClientRect(),root=document.documentElement;return{icon:icon.toJSON(),names:names.toJSON(),rootFont:parseFloat(getComputedStyle(root).fontSize),overflow:root.scrollWidth-root.clientWidth};});expect(zoomed.icon.width).toBeCloseTo(zoomed.rootFont*3,1);expect(zoomed.icon.height).toBeCloseTo(zoomed.rootFont*3.5,1);expect(Math.abs(zoomed.icon.top-zoomed.names.top)).toBeLessThanOrEqual(1);expect(zoomed.overflow).toBeLessThanOrEqual(1);await page.evaluate(()=>document.documentElement.style.fontSize='');}
   await card.click();await expect(page.getByTestId('game-shell')).toBeVisible();
   const summary=page.locator('[data-game-panel="summary"] .game-identity-title');if(!await summary.isVisible())await switchGamePanel(page,'summary');
   await expect(summary).toBeVisible();await expect(summary.locator('.game-date-inlay')).toBeVisible();
   let game;await expect.poll(async()=>{game=await summary.evaluate(node=>{const a=node.querySelector('.game-date-inlay').getBoundingClientRect(),b=node.querySelector('.game-title-matchup').getBoundingClientRect();return{icon:a.toJSON(),names:b.toJSON()};});return game.icon.width;},{message:'Expected the current patched Game identity to own a laid-out date slot'}).toBeGreaterThan(0);
   expect(game.icon.width).toBeCloseTo(home.icon.width,1);expect(game.icon.height).toBeCloseTo(home.icon.height,1);expect(Math.abs(game.icon.top-game.names.top)).toBeLessThanOrEqual(1);
  }
  await page.emulateMedia({forcedColors:'active'});await page.reload();await expect(page.getByTestId('game-shell')).toBeVisible();
  if(!await page.locator('[data-game-panel="summary"] .game-identity-title').isVisible())await switchGamePanel(page,'summary');
  const forced=page.locator('[data-game-panel="summary"] .game-date-inlay');await expect(forced).toBeVisible();
  const forcedStyle=await forced.evaluate(node=>({adjust:getComputedStyle(node).forcedColorAdjust,month:getComputedStyle(node.querySelector('.game-date-month')).fill}));
  if(info.project.name!=='webkit')expect(forcedStyle.adjust).toBe('none');
  expect(forcedStyle.month).not.toBe('rgba(0, 0, 0, 0)');
  await info.attach('game-date-identity',{body:Buffer.from(JSON.stringify({browser:info.project.name,widths:[390,1440],forcedColors:true})),contentType:'application/json'});
 }finally{await closeContextQuietly(context);}
});
