import {test as base,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
// Teardown has Playwright's separate bounded fixture phase. Setup and every
// behavior assertion retain the existing 60-second test budget.
const test=base.extend({
 ownedRoleContext:async({browser},use)=>{
  const owned=ownedContexts(browser);
  try{await use(options=>owned.create(options));}
  finally{await owned.close();}
 },
});
import {createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,joinAsViewer,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {isOperationRequest} from '../support/shared-request.mjs';
import {listLegalActions} from '../../apps/web/generated/packages/game-engine/src/index.js';
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const label=page=>page.locator('#shell-board-preview-label');
const replayButton=page=>label(page).getByRole('button',{name:'Show me again',exact:true});
const assertUnchanged=(before,after)=>{expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(after.board.state).toEqual(before.board.state);expect(after.moves.map(move=>({id:move.moveId,undone:move.undone}))).toEqual(before.moves.map(move=>({id:move.moveId,undone:move.undone})));};
for(const width of [390,1440])test(`human opponent replay preserves authority and read-only inspection at ${width}px`,async({ownedRoleContext,baseURL},info)=>{
 const contexts=await Promise.all([0,1,2].map(()=>ownedRoleContext({viewport:{width,height:900}})));
 const [owner,opponent,viewer]=await Promise.all(contexts.map(context=>context.newPage()));
  const {gameId,gameHash}=await createGameFromHome(owner);
  await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
  await expect(opponent.getByTestId('game-role')).toContainText('Player 2');
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  await Promise.all([owner,opponent,viewer].map(page=>switchGamePanel(page,'board')));
  const initial=await projected(owner,gameId),action=initial.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(action).toBeTruthy();
  await submitPlayableAction(owner,action);
  await expect(replayButton(opponent)).toBeVisible();await expect(label(opponent)).toContainText('Your opponent moved');
  await expect(replayButton(viewer)).toBeVisible();await expect(label(viewer)).toContainText('Guest 1 moved');
  for(const page of [owner,viewer])await expect(label(page).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  // An inactive seated player can still inspect a piece and its command lines.
  const saved=await projected(owner,gameId),piece=saved.board.state.pieces.find(piece=>piece.owner==='P1');
  const cell=(page,point)=>page.locator(`[data-testid="game-board"] .cell[data-row="${point.row}"][data-col="${point.col}"]`);
  await cell(owner,piece.position).click();await expect(label(owner)).toContainText('Supply and command lines for piece at');await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  await owner.locator('[data-board-inspection="command"]').click();await expect(label(owner)).toContainText('Supply and command lines for piece at');await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  const writes=[];const listen=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))writes.push({method:request.method(),path:new URL(request.url()).pathname});};opponent.on('request',listen);
  const before=await projected(opponent,gameId);
  await opponent.emulateMedia({reducedMotion:'reduce'});await replayButton(opponent).click();await expect(opponent.locator('.computer-replay')).toBeVisible();await expect(label(opponent).getByRole('button',{name:'Next',exact:true})).toBeVisible();
  await opponent.screenshot({path:info.outputPath('human-replay-manual.png')});
  await label(opponent).getByRole('button',{name:'Next',exact:true}).click();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  await replayButton(opponent).click();await label(opponent).getByRole('button',{name:'Stop replay',exact:true}).click();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  await opponent.emulateMedia({reducedMotion:'no-preference'});await replayButton(opponent).click();await expect(opponent.locator('.computer-replay')).toBeVisible();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  assertUnchanged(before,await projected(opponent,gameId));expect(writes).toEqual([]);opponent.off('request',listen);
  // A real new revision from the active player cancels a spectator's visual replay.
  await viewer.emulateMedia({reducedMotion:'reduce'});await replayButton(viewer).click();await expect(viewer.locator('.computer-replay')).toBeVisible();
  const viewerIdentity=await viewer.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
  const viewerWrites=[];const watch=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))viewerWrites.push({method:request.method(),path:new URL(request.url()).pathname,body:request.postDataJSON()})};viewer.on('request',watch);
  const current=await projected(opponent,gameId),next=current.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(next).toBeTruthy();
  await submitPlayableAction(opponent,next);await expect(viewer.locator('.computer-replay')).toHaveCount(0);await expect(label(viewer)).toContainText('Guest 2 moved');
  const advanced=await projected(opponent,gameId),seenByViewer=await projected(viewer,gameId);assertUnchanged(advanced,seenByViewer);
  for(const write of viewerWrites){
   expect(write.method).toBe('POST');expect(write.path).toBe(`/api/shell/games/${gameId}/decision-history`);
   expect(write.body).toEqual({identityId:viewerIdentity,metadataOnly:true,cursor:null,historyRevision:advanced.gameplayRevision,mode:'additional',protocolVersion:2});
  }viewer.off('request',watch);

});

for(const width of [390,1440])test(`reopening human play preserves narration and submits one native Pass at ${width}px`,async({ownedRoleContext,baseURL})=>{
 const contexts=await Promise.all([0,1].map(()=>ownedRoleContext({viewport:{width,height:900}})));
 const [owner,opponent]=await Promise.all(contexts.map(context=>context.newPage()));
 const {gameId,gameHash}=await createGameFromHome(owner);
 await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
 await expect(opponent.getByTestId('game-role')).toContainText('Player 2');
 await Promise.all([owner,opponent].map(page=>switchGamePanel(page,'board')));
 for(const [index,page] of [owner,opponent].entries()){
  await expect.poll(async()=>(await projected(page,gameId)).board.state.sideToMove).toBe(index===0?'P1':'P2');
  const state=await projected(page,gameId);
  const action=state.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(action).toBeTruthy();
  await submitPlayableAction(page,action);
  if(index===0){
   await expect(replayButton(opponent)).toBeVisible();
   const moved=await projected(owner,gameId),piece=moved.board.state.pieces.find(piece=>piece.owner==='P1');expect(piece).toBeTruthy();
   expect(moved.board.state.pieces.some(piece=>piece.position.row===4&&piece.position.col===4)).toBe(false);
   await owner.locator('[data-testid="game-board"] .cell[data-row="4"][data-col="4"]').click();
   await owner.locator(`[data-testid="game-board"] .cell[data-row="${piece.position.row}"][data-col="${piece.position.col}"]`).click();
   await expect(label(owner)).toContainText('Supply and command lines for piece at');
  }
 }
  // Reopening the live game clears inspection and exposes legal Pass beside narration.
  await owner.reload();await expect(owner.getByTestId('game-shell')).toBeVisible();await switchGamePanel(owner,'board');
  await expect(label(owner)).toContainText('Your opponent moved');await expect(replayButton(owner)).toBeVisible();
  const pass=label(owner).getByRole('button',{name:'Pass',exact:true});await expect(pass).toBeVisible();
  const beforePass=await projected(owner,gameId),passWrites=[];const trackPass=request=>{if(isOperationRequest(request,'apply'))passWrites.push(request.postDataJSON())};owner.on('request',trackPass);
  await pass.click();await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(beforePass.board.state.turnIndex+1);
  const passed=await projected(owner,gameId);expect(passed.gameplayRevision).toBe(beforePass.gameplayRevision+1);expect(passed.moves.at(-1).action).toEqual({type:'pass'});expect(passWrites).toHaveLength(1);owner.off('request',trackPass);
  await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
});

async function createOverviewFriendGame({ownedRoleContext,baseURL,width}) {
 const contexts=await Promise.all([0,1].map(()=>ownedRoleContext({viewport:{width,height:820},hasTouch:width===390})));
 const [owner,opponent]=await Promise.all(contexts.map(context=>context.newPage()));
 const {gameId,gameHash}=await createGameFromHome(owner);
 await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
 await expect(opponent.getByTestId('game-role')).toContainText('Player 2');
 await Promise.all([owner,opponent].map(page=>switchGamePanel(page,'board')));
 const initial=await projected(owner,gameId),action=initial.legalActions.find(action=>action.type==='move'&&action.to?.row===4&&action.to?.col===6);
 expect(action).toBeTruthy();await submitPlayableAction(owner,action);
 const board=opponent.getByTestId('game-board'),cell=point=>board.locator(`.cell[data-row="${point.row}"][data-col="${point.col}"]`);
 await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 return {owner,opponent,gameId,board,cell};
}

for(const width of [390,1440])test(`live opponent overview preserves play and visit intent at ${width}px`,async({ownedRoleContext,baseURL},info)=>{
 const {owner,opponent,gameId,board,cell}=await createOverviewFriendGame({ownedRoleContext,baseURL,width});
 await expect(board.locator('.cell.source,.cell.target,.axis-strong,.axis-medium')).toHaveCount(0);
 await expect(opponent.getByTestId('history-return-live')).toHaveCount(0);
 await expect(replayButton(opponent)).toBeVisible();
 await opponent.screenshot({path:info.outputPath(`live-overview-${width}.png`),fullPage:true});
 const before=await projected(opponent,gameId),writes=[];
 const watch=request=>{if(isOperationRequest(request,'apply')||isOperationRequest(request,'end-turn'))writes.push(request.postDataJSON());};opponent.on('request',watch);
 const enemy=before.board.state.pieces.find(piece=>piece.owner==='P1'),own=before.board.state.pieces.find(piece=>piece.owner==='P2');
 const empty=()=>{for(let row=1;row<9;row++)for(let col=1;col<9;col++)if(!before.board.state.pieces.some(piece=>piece.position.row===row&&piece.position.col===col))return{row,col};};
 await cell(enemy.position).click();await expect(board).toHaveAttribute('data-display-overlay','none');
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 await cell({row:0,col:9}).click();await expect(board).toHaveAttribute('data-display-overlay','none');
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 await cell(own.position).click();await expect(board).toHaveAttribute('data-display-overlay','none');
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expect(replayButton(opponent)).toBeVisible();
 await expect(board).toHaveAttribute('data-display-overlay','none');
 assertUnchanged(before,await projected(opponent,gameId));expect(writes).toEqual([]);opponent.off('request',watch);
 await opponent.reload();await expect(opponent.getByTestId('game-shell')).toBeVisible();await switchGamePanel(opponent,'board');
 await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 await cell(own.position).click();await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expect(board).toHaveAttribute('data-display-overlay','none');
 await opponent.locator('.shell-header-title-link').click();await expect(opponent.getByTestId('home-create-game')).toBeVisible();
 await opponent.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`).click();await switchGamePanel(opponent,'board');
 await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 });

for(const width of [390,1440])test(`unfinished human turn reopens live and a new opponent turn restores overview at ${width}px`,async({ownedRoleContext,baseURL})=>{
 const {owner,opponent,gameId,board}=await createOverviewFriendGame({ownedRoleContext,baseURL,width});
 // Project a second actor and approach before rushing: a lone actor's rush
 // settles immediately, so it cannot prove reopening an unfinished turn.
 const approach=listLegalActions((await projected(opponent,gameId)).board.state).find(action=>action.type==='project'&&action.to?.row===4&&action.to?.col===3);expect(approach).toBeTruthy();await submitPlayableAction(opponent,approach);
 await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(2);
 const answer=(await projected(owner,gameId)).legalActions.find(action=>action.type==='move'&&action.to?.row===4&&action.to?.col===5);expect(answer).toBeTruthy();await submitPlayableAction(owner,answer);
 await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 const reposition=listLegalActions((await projected(opponent,gameId)).board.state).find(action=>action.type==='move'&&action.actorId==='C2'&&action.to?.row===5&&action.to?.col===3);expect(reposition).toBeTruthy();await submitPlayableAction(opponent,reposition);
 await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(4);
 const close=listLegalActions((await projected(owner,gameId)).board.state).find(action=>action.type==='move'&&action.to?.row===5&&action.to?.col===5);expect(close).toBeTruthy();await submitPlayableAction(owner,close);
 await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 const ready=await projected(opponent,gameId),rush=listLegalActions(ready.board.state).find(action=>action.type==='rush'&&action.from&&action.to);expect(rush).toBeTruthy();
 await submitPlayableAction(opponent,rush);
 await expect.poll(async()=>(await projected(opponent,gameId)).moves.some(move=>move.actorSide==='P2'&&move.turnIndex===5)).toBe(true);
 expect((await projected(opponent,gameId)).board.state.turnIndex).toBe(5);
 await opponent.reload();await expect(opponent.getByTestId('game-shell')).toBeVisible();await switchGamePanel(opponent,'board');
 await expect(board).toHaveAttribute('data-display-overlay','none');
 await label(opponent).getByRole('button',{name:'End turn',exact:true}).click();
 await expect.poll(async()=>(await projected(owner,gameId)).board.state.sideToMove).toBe('P1');
 const next=await projected(owner,gameId),nextAction=next.legalActions.find(action=>action.type==='move'&&action.from&&action.to);
 await submitPlayableAction(owner,nextAction);
 await expect(board).toHaveAttribute('data-display-overlay','recorded-turn');
 await expect(opponent.getByTestId('history-return-live')).toHaveCount(0);
});
