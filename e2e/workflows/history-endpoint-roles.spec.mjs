import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
const cases=JSON.parse(readFileSync(new URL('../support/history-endpoint-role-scenarios.json',import.meta.url)));
const expectedRoles=moves=>{
 const cells=new Map();
 for(const {action}of moves)for(const [role,at]of [['source',action.from],['target',action.to]]){
  if(!at)continue;const key=`${at.row},${at.col}`,cell=cells.get(key)??{row:at.row,col:at.col,source:false,target:false};cell[role]=true;cells.set(key,cell);
 }
 return [...cells.values()].sort((a,b)=>a.row-b.row||a.col-b.col);
};
const actualRoles=root=>root.locator('.history-role-source,.history-role-target').evaluateAll(cells=>cells.map(cell=>({row:Number(cell.dataset.row),col:Number(cell.dataset.col),source:cell.classList.contains('history-role-source'),target:cell.classList.contains('history-role-target')})).sort((a,b)=>a.row-b.row||a.col-b.col));
const actualPieces=root=>root.locator('.piece-token[data-piece-id]:not(.move-ghost):not(.history-destruction-piece)').evaluateAll(tokens=>tokens.map(token=>({id:token.dataset.pieceId,row:Number(token.closest('.cell').dataset.row),col:Number(token.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)));
const expectedPieces=snapshot=>snapshot.pieces.map(piece=>({id:piece.id,...piece.position})).sort((a,b)=>a.id.localeCompare(b.id));
const expectRoleStyles=async root=>{
 await expect(async()=>{
 const styles=await root.locator('.history-role-source,.history-role-target').evaluateAll(cells=>cells.map(cell=>{const s=getComputedStyle(cell);return{source:cell.classList.contains('history-role-source'),target:cell.classList.contains('history-role-target'),border:s.borderTopStyle,width:s.borderTopWidth,color:s.borderTopColor,shadow:s.boxShadow};}));
 for(const style of styles){expect(style.width).toBe('2px');expect(style.border).toBe(style.source?'dashed':'solid');expect(style.color).toBe(style.source?'rgb(118, 80, 166)':'rgb(31, 122, 90)');if(style.source&&style.target)expect(style.shadow).toContain('rgb(31, 122, 90) 0px 0px 0px 2px inset');}
 }).toPass({timeout:10000});
};
for(const width of [390,1440])for(const example of cases)test(`${example.name}: History separates endpoint roles at ${width}px`,async({page,baseURL},info)=>{
 await page.setViewportSize({width,height:1100});
 const {gameId}=await importScenarioGame(page,example.scenario,baseURL);
 const game=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
 const moves=game.moves.filter(move=>!move.undone),turnMoves=moves.filter(move=>move.turnIndex===moves.at(-1).turnIndex),move=turnMoves[0];
 expect(turnMoves.length).toBeGreaterThan(0);
 await switchGamePanel(page,'history');
 const row=page.locator(`[data-testid="history-move-item"][data-move-id="${move.moveId}"]`);await row.locator('.history-item-info').click();
 const preview=()=>width<900?page.getByTestId('history-inline-preview'):page.getByTestId('game-board');
 await expect.poll(()=>actualRoles(preview())).toEqual(expectedRoles([move]));await expectRoleStyles(preview());
 await expect.poll(()=>actualPieces(preview())).toEqual(expectedPieces(move.snapshot));
 await page.screenshot({path:info.outputPath('history-single-endpoint-roles.png'),fullPage:true});
 const heading=row.locator('xpath=ancestor::li[contains(@class,"history-turn")]/div[contains(@class,"history-turn-heading")]');await heading.click();
 await expect.poll(()=>actualRoles(preview())).toEqual(expectedRoles(turnMoves));await expectRoleStyles(preview());
 await expect(preview().locator('.axis-strong,.axis-medium')).toHaveCount(0);
 await expect.poll(()=>actualPieces(preview())).toEqual(expectedPieces(turnMoves.at(-1).snapshot));
 for(const scale of [100,200]){
  await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);
  await expectRoleStyles(preview());await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath(`history-turn-endpoint-roles-${scale}.png`),fullPage:true});
 }
 await page.getByTestId('history-return-live').click();await switchGamePanel(page,'board');
 await expect(page.getByTestId('game-board').locator('.history-role-source,.history-role-target')).toHaveCount(0);
 await info.attach('acknowledged-endpoint-role-contract',{body:JSON.stringify({gameId,moveId:move.moveId,turnMoveIds:turnMoves.map(move=>move.moveId),roles:expectedRoles(turnMoves)}),contentType:'application/json'});
});
