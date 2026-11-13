import {test as base,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
import {createGamesViaApi,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {isOperationRequest} from '../support/shared-request.mjs';

const test=base.extend({
 ownedRoleContext:async({browser},use)=>{
  const owned=ownedContexts(browser);
  try{await use(options=>owned.create(options));}finally{await owned.close();}
 },
});
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const label=page=>page.locator('#shell-board-preview-label');

for(const width of [390,1440])test(`previous opponent turn uses restorable square-only washes at ${width}px`,async({ownedRoleContext,baseURL},info)=>{
 const contexts=await Promise.all([0,1].map(()=>ownedRoleContext({viewport:{width,height:820},hasTouch:width===390})));
 const [owner,opponent]=await Promise.all(contexts.map(context=>context.newPage()));
 const [gameId]=await createGamesViaApi(owner,1),gameHash=`#/game/${encodeURIComponent(gameId)}`;
 await owner.goto(`${baseURL}/${gameHash}`);await expect(owner.getByTestId('game-shell')).toHaveAttribute('data-game-id',gameId);
 await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
 await Promise.all([owner,opponent].map(page=>switchGamePanel(page,'board')));
 const initial=await projected(owner,gameId),action=initial.legalActions.find(value=>value.type==='move'&&value.to?.row===4&&value.to?.col===6);
 expect(action).toBeTruthy();await submitPlayableAction(owner,action);
 const board=opponent.getByTestId('game-board'),cell=point=>board.locator(`.cell[data-row="${point.row}"][data-col="${point.col}"]`);
 const washes=board.locator('.previous-turn-source,.previous-turn-target,.previous-turn-deletion');
 await expect(label(opponent).getByRole('button',{name:'Pass',exact:true})).toBeEnabled();
 await expect(board).toHaveAttribute('data-presentation-context','previous-turn');
 await expect(cell(action.from)).toHaveClass(/previous-turn-source/);await expect(cell(action.to)).toHaveClass(/previous-turn-target/);
 await expect(board.locator('.recorded-action-source-piece,.move-ghost,.history-role-source,.history-role-target')).toHaveCount(0);
 const [sourcePaint,targetPaint,plainPaint]=await Promise.all([action.from,action.to,{row:0,col:0}].map(point=>cell(point).evaluate(node=>getComputedStyle(node).backgroundImage)));
 expect(sourcePaint).not.toBe(targetPaint);expect(sourcePaint).not.toBe(plainPaint);expect(targetPaint).not.toBe(plainPaint);
 const before=await projected(opponent,gameId),writes=[];const watch=request=>{if(isOperationRequest(request,'apply')||isOperationRequest(request,'end-turn'))writes.push(request.postDataJSON());};opponent.on('request',watch);
 const own=before.board.state.pieces.find(piece=>piece.owner==='P2'),empty=(()=>{for(let row=1;row<9;row++)for(let col=1;col<9;col++)if(!before.board.state.pieces.some(piece=>piece.position.row===row&&piece.position.col===col))return{row,col};})();
 await cell(own.position).click();await expect(washes).toHaveCount(0);
 await cell(empty).click();await expect(washes.first()).toBeVisible();
 await opponent.reload();await expect(opponent.getByTestId('game-shell')).toBeVisible();await switchGamePanel(opponent,'board');await expect(washes.first()).toBeVisible();
 expect((await projected(opponent,gameId)).gameplayRevision).toBe(before.gameplayRevision);expect(writes).toEqual([]);opponent.off('request',watch);
 await opponent.screenshot({path:info.outputPath(`previous-turn-wash-${width}.png`),fullPage:true});
});
