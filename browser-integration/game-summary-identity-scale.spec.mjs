import {test,expect} from '@playwright/test';

const open=async page=>{await page.goto('/browser-integration/support/game-summary-identity-scale.html');await page.waitForFunction(()=>window.fixtureReady);};
const metrics=page=>page.evaluate(()=>{
 const box=node=>{const value=node.getBoundingClientRect();return{x:value.x,y:value.y,width:value.width,height:value.height,right:value.right,bottom:value.bottom,centerY:value.y+value.height/2};};
 const root=document.documentElement,summary=document.querySelector('#summary'),matchup=summary.querySelector('.game-title-matchup'),players=document.querySelector('#players');
 const summaryPlayers=[...matchup.querySelectorAll('.game-title-player')].map(node=>({box:box(node),name:box(node.querySelector('bdi')),emblem:box(node.querySelector('.player-emblem')),fontSize:parseFloat(getComputedStyle(node.querySelector('bdi')).fontSize),color:getComputedStyle(node).color}));
 const home=document.querySelector('#home'),homePlayer=home.querySelector('.game-title-player'),homeEmblem=homePlayer.querySelector('.player-emblem'),playerEmblem=players.querySelector('.player-emblem');
 return{rootFont:parseFloat(getComputedStyle(root).fontSize),viewport:innerWidth,scrollWidth:root.scrollWidth,summary:box(summary),matchup:box(matchup),summaryPlayers,date:box(summary.querySelector('.game-date-inlay')),
  home:{date:box(home.querySelector('.game-date-inlay')),fontSize:parseFloat(getComputedStyle(homePlayer.querySelector('bdi')).fontSize),emblem:box(homeEmblem),emblemAlign:getComputedStyle(homeEmblem).alignSelf,emblemMarginTop:parseFloat(getComputedStyle(homeEmblem).marginTop)},
  players:{emblem:box(playerEmblem),color:getComputedStyle(players.querySelector('.player-name')).color},focusables:summary.querySelectorAll('a,button,[tabindex]').length,sr:[...summary.querySelectorAll('.sr-only')].map(node=>node.textContent)};
});

test('Game Summary alone uses centered 16px names with existing 17px Tessera marks',async({page})=>{
 await open(page);
 for(const width of [320,390,1440])for(const scale of [100,200]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
  await page.evaluate(()=>window.renderCase('long'));
  const value=await metrics(page),expectedName=value.rootFont,expectedMark=value.rootFont*1.0625;
  expect(value.scrollWidth).toBeLessThanOrEqual(width);
  expect(value.focusables).toBe(0);
  expect(value.sr).toEqual(['Red: ','Blue: ']);
  expect(value.date.width).toBeCloseTo(value.rootFont*3,1);expect(value.date.height).toBeCloseTo(value.rootFont*3.5,1);
  expect(value.home.date.width).toBeCloseTo(value.date.width,2);expect(value.home.date.height).toBeCloseTo(value.date.height,2);
  for(const player of value.summaryPlayers){
   expect(player.fontSize).toBeCloseTo(expectedName,2);expect(player.emblem.width).toBeCloseTo(expectedMark,2);expect(player.emblem.height).toBeCloseTo(expectedMark,2);
   expect(Math.abs(player.emblem.centerY-player.name.centerY)).toBeLessThanOrEqual(1);
   expect(player.box.x).toBeGreaterThanOrEqual(value.matchup.x-1);expect(player.box.right).toBeLessThanOrEqual(value.matchup.right+1);
  }
  if(width<=390)expect(value.summaryPlayers[0].name.height).toBeGreaterThan(expectedName*1.5);
  expect(value.summaryPlayers[0].color).not.toBe(value.summaryPlayers[1].color);
  expect(value.home.fontSize).toBeCloseTo(expectedName,2);expect(value.home.emblem.width).toBeCloseTo(expectedMark,2);
  expect(value.home.emblemAlign).toBe('flex-start');expect(value.home.emblemMarginTop).toBeGreaterThan(0);
  expect(value.players.emblem.width).toBeCloseTo(34,2);expect(value.players.emblem.height).toBeCloseTo(34,2);
 }
});

test('summary identity stays explicit for relative, duplicate, anonymous, and escaped names',async({page})=>{
 await open(page);await page.setViewportSize({width:320,height:900});
 const expected={
  relative:['You','Babs'],
  duplicate:['Alex','Alex'],
  anonymous:['Guest 1','Guest 2'],
  escaped:['<Red & Co>','"Blue" > Red'],
 };
 for(const [name,labels] of Object.entries(expected)){
  await page.evaluate(name=>window.renderCase(name),name);
  await expect(page.locator('#summary .game-title-matchup bdi')).toHaveText(labels);
  await expect(page.locator('#summary .player-emblem')).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
 }
});

test('forced colors retain names, non-color seat labels, and stable multicolor marks',async({page},info)=>{
 await page.emulateMedia({forcedColors:'active'});await open(page);await page.evaluate(()=>window.renderCase('duplicate'));
 const summary=page.locator('#summary');await expect(summary.locator('.game-title-matchup bdi')).toHaveText(['Alex','Alex']);
 await expect(summary.locator('.sr-only')).toHaveText(['Red: ','Blue: ']);
 const styles=await summary.locator('.player-emblem').evaluateAll(nodes=>nodes.map(node=>({adjust:getComputedStyle(node).forcedColorAdjust,tiles:new Set([...node.querySelectorAll('.player-emblem-tile')].map(tile=>getComputedStyle(tile).fill)).size})));
 for(const style of styles){if(info.project.name!=='webkit')expect(style.adjust).toBe('none');expect(style.tiles).toBeGreaterThan(1);}
});
