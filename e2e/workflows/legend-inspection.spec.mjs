import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';

for(const width of [390,1440])test(`legend independently inspects a blue commander and red supply point at ${width}px`,async({page,baseURL,browserName},info)=>{
 await page.setViewportSize({width,height:1000});
 const catalog=JSON.parse(await readFile(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
 const scenario=catalog.scenarios.find(item=>item.title==='Standard rush');expect(scenario).toBeTruthy();
 const {gameId}=await importScenarioGame(page,scenario,baseURL);await switchGamePanel(page,'board');
 const before=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
 const blueCommander=before.board.state.pieces.find(piece=>piece.kind==='commander'&&piece.owner==='P2');expect(blueCommander).toBeTruthy();
 const square=point=>page.locator(`#shell-board .cell[data-row="${point.row}"][data-col="${point.col}"]`);
 const legend=page.locator('.overlay-key'),command=legend.locator('[data-board-inspection="command"]'),supply=legend.locator('[data-board-inspection="supply"]');
 const writes=[];page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))writes.push({method:request.method(),path:new URL(request.url()).pathname});});
 await square(blueCommander.position).click();
 if(before.canRecordMove&&before.board.state.sideToMove===blueCommander.owner){await expect(square(blueCommander.position)).toHaveClass(/selected-piece/);await expect(page.locator('#shell-board-preview-label')).not.toHaveAttribute('aria-busy','true');await square(blueCommander.position).click();}
 // Human-controlled commanders keep complete move previews first. Read-only
 // commanders enter combined connections directly.
 const blueSupplyLines=page.locator('#shell-overlay-lines [data-legend-kind="supply"][data-connection-owner="P2"]');
 await expect(page.locator('#shell-overlay-lines [data-legend-kind="command"][data-connection-owner="P2"]').first()).toBeAttached();
 await expect(blueSupplyLines.first()).toBeAttached();
 const directRed=page.locator('#shell-board .cell:has(.supply-point-marker.supply-point-p1)');await directRed.click();
 await expect(blueSupplyLines).toHaveCount(0);await expect(page.locator('#shell-overlay-lines [data-legend-kind="supply"][data-connection-owner="P1"]').first()).toBeAttached();
 await expect(square(blueCommander.position)).toHaveClass(/selected-piece/);
 await directRed.click();await expect(page.locator('#shell-overlay-lines [data-legend-kind="supply"]')).toHaveCount(0);await expect(page.locator('#shell-overlay-lines [data-legend-kind="command"][data-connection-owner="P2"]').first()).toBeAttached();
 await command.click();
 await expect(command).toHaveAttribute('aria-pressed','true');
 const redSupply=page.locator('#shell-board .cell:has(.supply-point-marker.supply-point-p1)');
 await expect(redSupply).toHaveCount(1);await redSupply.click();
 await expect(command).toHaveAttribute('aria-pressed','true');await expect(supply).toHaveAttribute('aria-pressed','true');
 await expect(redSupply).toHaveClass(/selected-supply-point/);await expect(redSupply).toHaveAttribute('data-selected-supply-owner','P1');
 await expect(square(blueCommander.position)).toHaveClass(/selected-piece/);
 await expect(command).toHaveAccessibleName('Blue commander inspection');await expect(supply).toHaveAccessibleName('Red supply point inspection');
 await expect.poll(()=>legend.evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);
 const visuals=await legend.evaluate(element=>{
  const color=variable=>{const probe=document.createElement('span');probe.style.color=`var(${variable})`;element.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value;};
  const inspect=kind=>{const button=element.querySelector(`[data-board-inspection="${kind}"]`),label=button.querySelector('.legend-inspection-label'),style=getComputedStyle(button),text=getComputedStyle(label),icon=button.querySelector('.swatch');return {icon:getComputedStyle(icon).color,underline:text.textDecorationColor,weight:text.textDecorationThickness,offset:text.textUnderlineOffset,decoration:text.textDecorationLine,text:text.color,background:style.backgroundColor,shadow:style.boxShadow,height:button.getBoundingClientRect().height};};
  return {red:color('--player-p1'),blue:color('--player-p2'),ink:color('--ink'),connectionSupply:color('--connection-supply'),command:inspect('command'),supply:inspect('supply')};
 });
 for(const [kind,color]of [['command',visuals.blue],['supply',visuals.red]]){
  expect(visuals[kind]).toMatchObject({icon:color,underline:color,weight:'2px',offset:'5px',decoration:'underline',text:visuals.ink,shadow:'none'});expect(visuals[kind].background).toMatch(/rgba\([^)]*,\s*0\)$/);expect(visuals[kind].height).toBeGreaterThanOrEqual(44);
  const lines=page.locator(`#shell-overlay-lines [data-legend-kind="${kind}"]`);await expect(lines.first()).toBeAttached();await expect(page.locator('#shell-overlay-lines')).toBeVisible();expect(await lines.evaluateAll(nodes=>nodes.every(node=>Number(node.getAttribute('x1'))!==Number(node.getAttribute('x2'))||Number(node.getAttribute('y1'))!==Number(node.getAttribute('y2'))))).toBe(true);expect(await lines.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).stroke))).toEqual(Array(await lines.count()).fill(kind==='supply'?visuals.connectionSupply:color));await expect(lines.first()).toHaveAttribute('stroke-dasharray',kind==='supply'?'7 5':'2 6');await expect(lines.first()).toHaveAttribute('stroke-width','3');await expect(lines.first()).toHaveAttribute('stroke-linecap','round');
 }
 const entriesMatch=()=>page.evaluate(()=>['command','supply','group'].every(kind=>{const drawn=kind==='group'?document.querySelector('#shell-board .group-strength-badge'):document.querySelector(`#shell-overlay-lines [data-legend-kind="${kind}"]`);return document.querySelector(`.overlay-key [data-legend-entry="${kind}"]`).hidden===!drawn;}));
 await expect.poll(entriesMatch).toBe(true);
 await page.screenshot({path:info.outputPath(`legend-blue-command-red-supply-${width}.png`)});
 await supply.click();await expect(supply).toHaveAttribute('aria-pressed','false');await expect(command).toHaveAttribute('aria-pressed','true');await expect(redSupply).not.toHaveClass(/selected-supply-point/);
 await supply.click();await command.click();await expect(command).toHaveAttribute('aria-pressed','false');await expect(supply).toHaveAttribute('aria-pressed','true');await expect.poll(entriesMatch).toBe(true);
 await square({row:9,col:9}).focus();await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab');await expect(command).toBeFocused();await command.press('Space');await expect(command).toBeFocused();await expect(command).toHaveAttribute('aria-pressed','true');expect(await command.evaluate(button=>getComputedStyle(button).outlineStyle)).toBe('solid');await page.screenshot({path:info.outputPath(`legend-keyboard-focus-${width}.png`)});
 const after=await page.evaluate(readProjectedGame,{id:gameId,guest:true});expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(after.board.state).toEqual(before.board.state);expect(after.moves).toEqual(before.moves);expect(writes).toEqual([]);
});
