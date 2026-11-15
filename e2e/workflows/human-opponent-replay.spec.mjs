import {readFileSync} from 'node:fs';
import {installOwnedFocusObservation} from '../support/owned-replay-focus-observer.mjs';
const ownedFocusRecipes=JSON.parse(readFileSync(new URL('../support/owned-replay-focus-recipes.json',import.meta.url),'utf8'));
import {test as base,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
// Owned contexts retain their existing cleanup phase. The replay-specific
// prerequisite slot below is separate from its original 60-second body.
const test=base.extend({
 ownedRoleContext:async({browser,baseURL,browserName},use,info)=>{
  const owned=ownedContexts(browser),observations=[];let roleIndex=0;
  try{await use(async options=>{
   const role=roleIndex++,context=await owned.create(options);
   if(process.env.RIGHELT_OWNED_REPLAY_FOCUS_OBSERVER==='1'&&browserName==='firefox'&&info.title==='human opponent replay preserves authority and read-only inspection at 390px'&&role===1){
    observations.push(await installOwnedFocusObservation(context,{baseURL,recipes:ownedFocusRecipes}));
   }
   return context;
  });}
  finally{
   try{for(const observation of observations)await observation.finish(info);}
   catch{console.error('owned-replay-focus-finalization-incomplete');}
   finally{await owned.close();}
  }
 },
});
import {createGamesViaApi,createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,joinAsViewer,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {isOperationRequest} from '../support/shared-request.mjs';
import {listLegalActions} from '../../apps/web/generated/packages/game-engine/src/index.js';
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const label=page=>page.locator('#shell-board-preview-label');
const context=page=>page.locator('#app [data-incoming-context]');
const replayButton=page=>context(page).getByRole('button',{name:'Show me again',exact:true});
const assertUnchanged=(before,after)=>{expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(after.board.state).toEqual(before.board.state);expect(after.moves.map(move=>({id:move.moveId,undone:move.undone}))).toEqual(before.moves.map(move=>({id:move.moveId,undone:move.undone})));};
// These two replay cases keep their native prerequisites in a separate 40s
// setup/teardown slot so the responsive replay and authority journey retains
// its original 60-second body.
const replayTest=test.extend({
 humanReplayPrerequisites:[async({ownedRoleContext,baseURL},use,info)=>{
  const widths=new Map([390,1440].map(width=>[`human opponent replay preserves authority and read-only inspection at ${width}px`,width]));
  const width=widths.get(info.title);
  if(width===undefined)throw Error('Native replay prerequisites require an original replay case');
 const contexts=await Promise.all([0,1,2].map(()=>ownedRoleContext({viewport:{width,height:900}})));
 const [owner,opponent,viewer]=await Promise.all(contexts.map(context=>context.newPage()));
  // Replay owns native roles and moves. Repeated Friend-story creation has
  // separate coverage in the reopening/Pass workflow below.
  const [gameId]=await createGamesViaApi(owner,1),gameHash=`#/game/${encodeURIComponent(gameId)}`;
  await owner.goto(`${baseURL}/${gameHash}`);await expect(owner.getByTestId('game-shell')).toHaveAttribute('data-game-id',gameId);
  await expect(owner.getByTestId('game-role')).toContainText('Guest');
  await expect(owner.locator('[data-action="play-as-both-players"]')).toBeEnabled();
  await expect(owner.getByTestId('sync-recovery-banner')).toHaveCount(0);
  await expect(owner.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
  await expect(opponent.getByTestId('game-role')).toContainText('Guest 2');
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  await Promise.all([owner,opponent,viewer].map(page=>switchGamePanel(page,'board')));
  await use({owner,opponent,viewer,gameId});
 },{timeout:40000}],
});
for(const width of [1440])replayTest(`human opponent replay preserves authority and read-only inspection at ${width}px`,async({humanReplayPrerequisites:{owner,opponent,viewer,gameId},browserName},info)=>{
  // Keep the wide incoming-History replay, authority, and inspection journey
  // here. Narrow layouts deliberately omit the removed incoming flyout and
  // retain their Board interaction coverage in the focused overview cases.
  const initial=await projected(owner,gameId),action=initial.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(action).toBeTruthy();
  await submitPlayableAction(owner,action);
  await expect(replayButton(opponent)).toBeVisible();await expect(context(opponent)).toContainText('Guest 1 moved');
  await expect(replayButton(viewer)).toBeVisible();await expect(context(viewer)).toContainText('Guest 1 moved');
  for(const page of [owner,viewer])await expect(label(page).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  // The accepted summary is independently hosted. Its real primary action stays
  // in the finite Board slot, with no narration or offscreen hidden duplicate.
  await expect(label(opponent)).not.toContainText('Your opponent moved');
  await expect(label(opponent).getByRole('button',{name:'Pass',exact:true})).toBeVisible();
  await expect(context(opponent)).toHaveCount(1);
  await expect(context(opponent)).toHaveClass(/history-incoming/);
  await expect(opponent.locator('[data-alert-stack-card] [data-incoming-context]')).toHaveCount(0);
  await opponent.screenshot({path:info.outputPath(`incoming-turn-${width}.png`)});
  // An inactive seated player can still inspect a piece and its command lines.
  const saved=await projected(owner,gameId),piece=saved.board.state.pieces.find(piece=>piece.owner==='P1');
  const cell=(page,point)=>page.locator(`[data-testid="game-board"] .cell[data-row="${point.row}"][data-col="${point.col}"]`);
  expect(piece.kind).toBe('commander');await cell(owner,piece.position).click();await expect(label(owner)).toHaveText('Supply lines');
  const explanation=owner.getByRole('region',{name:'Board explanation',exact:true});
  await expect(explanation).toContainText('Commander at');await expect(explanation).toContainText('has a supply line but no connected units.');await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  await owner.locator('[data-board-inspection="command"]').click();await expect(label(owner)).toHaveText('No connection');await expect(explanation).toContainText('Commander at');await expect(explanation).toContainText('has no connections.');await expect(owner.locator('#shell-overlay-lines [data-legend-kind="supply"]')).toHaveCount(0);await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  const writes=[];const listen=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))writes.push({method:request.method(),path:new URL(request.url()).pathname});};opponent.on('request',listen);
  const before=await projected(opponent,gameId);
  await opponent.emulateMedia({reducedMotion:'reduce'});await replayButton(opponent).click();await expect(opponent.locator('.computer-replay')).toBeVisible();await expect(label(opponent).getByRole('button',{name:'Next',exact:true})).toBeVisible();
  await opponent.screenshot({path:info.outputPath('human-replay-manual.png')});
  await label(opponent).getByRole('button',{name:'Next',exact:true}).click();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  await replayButton(opponent).click();const stopReplay=label(opponent).getByRole('button',{name:'Stop replay',exact:true});await stopReplay.focus();await expect(stopReplay).toBeFocused();await stopReplay.press('Enter');await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  const postStopFocus=await replayButton(opponent).evaluate(button=>{const active=document.activeElement;return {replayFocused:active===button,activeTag:active?.tagName??null,activeAction:active?.dataset?.action??active?.dataset?.boardMessageAction??null,activeText:active?.textContent?.trim().slice(0,80)??null,activeConnected:active?.isConnected??false,replayConnected:button.isConnected};});
  await info.attach('Native focus immediately after Stop replay',{body:JSON.stringify(postStopFocus),contentType:'application/json'});expect(postStopFocus,JSON.stringify(postStopFocus)).toMatchObject({replayFocused:true});
  await opponent.emulateMedia({reducedMotion:'no-preference'});await replayButton(opponent).click();await expect(opponent.locator('.computer-replay')).toBeVisible();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  assertUnchanged(before,await projected(opponent,gameId));expect(writes).toEqual([]);opponent.off('request',listen);
  // A real new revision from the active player cancels a spectator's visual replay.
  await viewer.emulateMedia({reducedMotion:'reduce'});await replayButton(viewer).click();await expect(viewer.locator('.computer-replay')).toBeVisible();
  const viewerIdentity=await viewer.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
  const viewerWrites=[];const watch=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))viewerWrites.push({method:request.method(),path:new URL(request.url()).pathname,body:request.postDataJSON()})};viewer.on('request',watch);
  const current=await projected(opponent,gameId),next=current.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(next).toBeTruthy();
  await submitPlayableAction(opponent,next);await expect(viewer.locator('.computer-replay')).toHaveCount(0);await expect(context(viewer)).toContainText('Guest 2 moved');
  const advanced=await projected(opponent,gameId),seenByViewer=await projected(viewer,gameId);assertUnchanged(advanced,seenByViewer);
  for(const write of viewerWrites){
   expect(write.method).toBe('POST');expect(write.path).toBe(`/api/shell/games/${gameId}/decision-history`);
   expect(write.body).toEqual({identityId:viewerIdentity,metadataOnly:true,cursor:null,historyRevision:advanced.gameplayRevision,mode:'additional',protocolVersion:2});
  }viewer.off('request',watch);
  await expect(context(viewer)).toContainText('Guest 2 moved');
  await replayButton(viewer).click();
  await expect(viewer.locator('.computer-replay')).toBeVisible();
  if(width===390)await expect(viewer.locator('[data-mobile-panel="board"]')).toHaveAttribute('data-active','true');
  await label(viewer).getByRole('button',{name:'Stop replay',exact:true}).click();await expect(viewer.locator('.computer-replay')).toHaveCount(0);


});

for(const width of [390,1440])test(`reopening human play preserves narration and submits one native Pass at ${width}px`,async({ownedRoleContext,baseURL})=>{
 const contexts=await Promise.all([0,1].map(()=>ownedRoleContext({viewport:{width,height:900}})));
 const [owner,opponent]=await Promise.all(contexts.map(context=>context.newPage()));
 const {gameId,gameHash}=await createGameFromHome(owner);
 await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
 await expect(opponent.getByTestId('game-role')).toContainText('Guest 2');
 await Promise.all([owner,opponent].map(page=>switchGamePanel(page,'board')));
 for(const [index,page] of [owner,opponent].entries()){
  await expect.poll(async()=>(await projected(page,gameId)).board.state.sideToMove).toBe(index===0?'P1':'P2');
  const state=await projected(page,gameId);
  const action=state.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(action).toBeTruthy();
  await submitPlayableAction(page,action);
  if(index===0){
   if(width===1440)await expect(replayButton(opponent)).toBeVisible();
   else await expect(opponent.locator('[data-incoming-context],.incoming-move-flyout,.history-incoming,[data-action="toggle-incoming-narration"]')).toHaveCount(0);
   const moved=await projected(owner,gameId),piece=moved.board.state.pieces.find(piece=>piece.owner==='P1');expect(piece).toBeTruthy();
   expect(moved.board.state.pieces.some(piece=>piece.position.row===4&&piece.position.col===4)).toBe(false);
   await owner.locator('[data-testid="game-board"] .cell[data-row="4"][data-col="4"]').click();
   await owner.locator(`[data-testid="game-board"] .cell[data-row="${piece.position.row}"][data-col="${piece.position.col}"]`).click();
   // The finite Board label and the complete scrollable explanation are separate surfaces.
   await expect(label(owner)).toHaveText('Supply lines');
   const inspectionHelp=owner.getByRole('region',{name:'Board explanation',exact:true}).filter({hasText:'has a supply line but no connected units'});
   await expect(inspectionHelp).toBeVisible();await expect(inspectionHelp).toContainText('has a supply line but no connected units');
   await expect(inspectionHelp.locator('.board-preview-coordinate-chip')).toHaveText(`${piece.position.row}, ${piece.position.col}`);
   await expect(inspectionHelp).toContainText('no connected units.');
  }
 }
  // Reopening the live game clears inspection and exposes legal Pass beside narration.
  await owner.reload();await expect(owner.getByTestId('game-shell')).toBeVisible();await switchGamePanel(owner,'board');
  if(width===1440){await expect(context(owner)).toContainText('Guest 2 moved');await expect(replayButton(owner)).toBeVisible();}
  else await expect(owner.locator('[data-incoming-context],.incoming-move-flyout,.history-incoming,[data-action="toggle-incoming-narration"]')).toHaveCount(0);
  const pass=label(owner).getByRole('button',{name:'Pass',exact:true});await expect(pass).toBeVisible();
  const beforePass=await projected(owner,gameId),passWrites=[];const trackPass=request=>{if(isOperationRequest(request,'apply'))passWrites.push(request.postDataJSON())};owner.on('request',trackPass);
  await pass.click();await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(beforePass.board.state.turnIndex+1);
  const passed=await projected(owner,gameId);expect(passed.gameplayRevision).toBe(beforePass.gameplayRevision+1);expect(passed.moves.at(-1).action).toEqual({type:'pass'});expect(passWrites).toHaveLength(1);owner.off('request',trackPass);
  await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
});

async function expectLiveOverview(page,board,visible) {
 const washes=board.locator('.previous-turn-source,.previous-turn-target,.previous-turn-deletion');
 if(!visible){await expect(washes).toHaveCount(0);return;}
 // A usable live Pass and square-only paint together establish this surface.
 await expect(label(page).getByRole('button',{name:'Pass',exact:true})).toBeEnabled();
 await expect(washes.first()).toBeVisible();
 await expect(board).toHaveAttribute('data-presentation-context','previous-turn');
 await expect(board.locator('.recorded-action-source-piece,.move-ghost,.history-role-source,.history-role-target')).toHaveCount(0);
}

async function createOverviewFriendGame({ownedRoleContext,baseURL,width}) {
 const contexts=await Promise.all([0,1].map(()=>ownedRoleContext({viewport:{width,height:820},hasTouch:width===390})));
 const [owner,opponent]=await Promise.all(contexts.map(context=>context.newPage()));
 // Authoritative fixture creation is not the behavior under test here. Native
 // Friend creation has separate workflow coverage.
 const [gameId]=await createGamesViaApi(owner,1),gameHash=`#/game/${encodeURIComponent(gameId)}`;
 await owner.goto(`${baseURL}/${gameHash}`);await expect(owner.getByTestId('game-shell')).toHaveAttribute('data-game-id',gameId);
 await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
 await expect(opponent.getByTestId('game-role')).toContainText('Guest 2');
 await Promise.all([owner,opponent].map(page=>switchGamePanel(page,'board')));
 const initial=await projected(owner,gameId),action=initial.legalActions.find(action=>action.type==='move'&&action.to?.row===4&&action.to?.col===6);
 expect(action).toBeTruthy();await submitPlayableAction(owner,action);
 const board=opponent.getByTestId('game-board'),cell=point=>board.locator(`.cell[data-row="${point.row}"][data-col="${point.col}"]`);
 await expectLiveOverview(opponent,board,true);
 await expect(cell(action.from)).toHaveClass(/previous-turn-source/);
 await expect(cell(action.to)).toHaveClass(/previous-turn-target/);
 const washPaint=await Promise.all([action.from,action.to].map(point=>cell(point).evaluate(node=>getComputedStyle(node).backgroundImage)));
 expect(washPaint[0],`source and destination washes must remain visually distinct: ${JSON.stringify(washPaint)}`).not.toBe(washPaint[1]);
 await expect(cell(action.to).locator(`.piece-token[data-piece-id="${action.actorId}"]:not(.move-ghost)`)).toBeVisible();
 return {owner,opponent,gameId,board,cell};
}

for(const width of [390,1440])test(`live opponent overview preserves play and visit intent at ${width}px`,async({ownedRoleContext,baseURL},info)=>{
 const {owner,opponent,gameId,board,cell}=await createOverviewFriendGame({ownedRoleContext,baseURL,width});
 await expect(board.locator('.cell.source,.cell.target,.axis-strong,.axis-medium')).toHaveCount(0);
 await expect(opponent.getByTestId('history-return-live')).toHaveCount(0);
 if(width===1440)await expect(replayButton(opponent)).toBeVisible();
 else await expect(opponent.locator('[data-incoming-context],.incoming-move-flyout,.history-incoming,[data-action="toggle-incoming-narration"]')).toHaveCount(0);
 await opponent.screenshot({path:info.outputPath(`live-overview-${width}.png`),fullPage:true});
 const before=await projected(opponent,gameId),writes=[];
 const watch=request=>{if(isOperationRequest(request,'apply')||isOperationRequest(request,'end-turn'))writes.push(request.postDataJSON());};opponent.on('request',watch);
 const enemy=before.board.state.pieces.find(piece=>piece.owner==='P1'),own=before.board.state.pieces.find(piece=>piece.owner==='P2');
 const empty=()=>{for(let row=1;row<9;row++)for(let col=1;col<9;col++)if(!before.board.state.pieces.some(piece=>piece.position.row===row&&piece.position.col===col))return{row,col};};
 await cell(enemy.position).click();await expectLiveOverview(opponent,board,false);
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expectLiveOverview(opponent,board,true);
 await cell({row:0,col:9}).click();await expectLiveOverview(opponent,board,false);
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expectLiveOverview(opponent,board,true);
 await cell(own.position).click();await expectLiveOverview(opponent,board,false);
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();
 if(width===1440)await expect(replayButton(opponent)).toBeVisible();
 else await expect(opponent.locator('[data-incoming-context],.incoming-move-flyout,.history-incoming,[data-action="toggle-incoming-narration"]')).toHaveCount(0);
 await expectLiveOverview(opponent,board,true);
 assertUnchanged(before,await projected(opponent,gameId));expect(writes).toEqual([]);opponent.off('request',watch);
 await opponent.reload();await expect(opponent.getByTestId('game-shell')).toBeVisible();await switchGamePanel(opponent,'board');
 await expectLiveOverview(opponent,board,true);
 await cell(own.position).click();await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expectLiveOverview(opponent,board,true);
 await opponent.locator('.shell-header-title-link').click();await expect(opponent.getByTestId('home-create-game')).toBeVisible();
 await opponent.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`).click();await switchGamePanel(opponent,'board');
 await expectLiveOverview(opponent,board,true);
 });

for(const width of [390,1440])test(`unfinished human turn reopens live and a new opponent turn restores overview at ${width}px`,async({ownedRoleContext,baseURL})=>{
 const {owner,opponent,gameId,board}=await createOverviewFriendGame({ownedRoleContext,baseURL,width});
 // Project a second actor and approach before rushing: a lone actor's rush
 // settles immediately, so it cannot prove reopening an unfinished turn.
 const approach=listLegalActions((await projected(opponent,gameId)).board.state).find(action=>action.type==='project'&&action.to?.row===4&&action.to?.col===3);expect(approach).toBeTruthy();await submitPlayableAction(opponent,approach);
 await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(2);
 const answer=(await projected(owner,gameId)).legalActions.find(action=>action.type==='move'&&action.to?.row===4&&action.to?.col===5);expect(answer).toBeTruthy();await submitPlayableAction(owner,answer);
 await expectLiveOverview(opponent,board,true);
 const reposition=listLegalActions((await projected(opponent,gameId)).board.state).find(action=>action.type==='move'&&action.actorId==='C2'&&action.to?.row===5&&action.to?.col===3);expect(reposition).toBeTruthy();await submitPlayableAction(opponent,reposition);
 await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(4);
 const close=listLegalActions((await projected(owner,gameId)).board.state).find(action=>action.type==='move'&&action.to?.row===5&&action.to?.col===5);expect(close).toBeTruthy();await submitPlayableAction(owner,close);
 await expectLiveOverview(opponent,board,true);
 const ready=await projected(opponent,gameId),rush=listLegalActions(ready.board.state).find(action=>action.type==='rush'&&action.from&&action.to);expect(rush).toBeTruthy();
 await submitPlayableAction(opponent,rush);
 await expect.poll(async()=>(await projected(opponent,gameId)).moves.some(move=>move.actorSide==='P2'&&move.turnIndex===5)).toBe(true);
 expect((await projected(opponent,gameId)).board.state.turnIndex).toBe(5);
 await opponent.reload();await expect(opponent.getByTestId('game-shell')).toBeVisible();await switchGamePanel(opponent,'board');
 await expectLiveOverview(opponent,board,false);
 await label(opponent).getByRole('button',{name:'End turn',exact:true}).click();
 await expect.poll(async()=>(await projected(owner,gameId)).board.state.sideToMove).toBe('P1');
 const next=await projected(owner,gameId),nextAction=next.legalActions.find(action=>action.type==='move'&&action.from&&action.to);
 await submitPlayableAction(owner,nextAction);
 await expectLiveOverview(opponent,board,true);
 await expect(opponent.getByTestId('history-return-live')).toHaveCount(0);
});
