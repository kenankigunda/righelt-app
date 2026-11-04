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
import {createGamesViaApi,createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,joinAsViewer,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {isOperationRequest} from '../support/shared-request.mjs';
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const label=page=>page.locator('#shell-board-preview-label');
const context=page=>page.locator('#app [data-board-context]:has(.board-context-replay)');
const replayButton=page=>context(page).getByRole('button',{name:'Show me again',exact:true});
const assertUnchanged=(before,after)=>{expect(after.gameplayRevision).toBe(before.gameplayRevision);expect(after.board.state).toEqual(before.board.state);expect(after.moves.map(move=>({id:move.moveId,undone:move.undone}))).toEqual(before.moves.map(move=>({id:move.moveId,undone:move.undone})));};
for(const width of [390,1440])test(`human opponent replay preserves authority and read-only inspection at ${width}px`,async({ownedRoleContext,baseURL,browserName},info)=>{
 const contexts=await Promise.all([0,1,2].map(()=>ownedRoleContext({viewport:{width,height:900}})));
 const [owner,opponent,viewer]=await Promise.all(contexts.map(context=>context.newPage()));
  // Replay owns native roles and moves. Repeated Friend-story creation has
  // separate coverage in the reopening/Pass workflow below.
  const [gameId]=await createGamesViaApi(owner,1),gameHash=`#/game/${encodeURIComponent(gameId)}`;
  await owner.goto(`${baseURL}/${gameHash}`);await expect(owner.getByTestId('game-shell')).toHaveAttribute('data-game-id',gameId);
  await expect(owner.getByTestId('game-role')).toContainText('Player 1');
  await expect(owner.locator('[data-action="play-as-both-players"]')).toBeEnabled();
  await expect(owner.getByTestId('sync-recovery-banner')).toHaveCount(0);
  await expect(owner.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  await openDirectGameLink(opponent,baseURL,gameHash);await requestPlayerJoin(opponent);await acceptPendingRequest(owner);
  await expect(opponent.getByTestId('game-role')).toContainText('Player 2');
  await openDirectGameLink(viewer,baseURL,gameHash);await joinAsViewer(viewer);
  await Promise.all([owner,opponent,viewer].map(page=>switchGamePanel(page,'board')));
  const initial=await projected(owner,gameId),action=initial.legalActions.find(action=>action.type==='move'&&action.from&&action.to);expect(action).toBeTruthy();
  await submitPlayableAction(owner,action);
  await expect(replayButton(opponent)).toBeVisible();await expect(context(opponent)).toContainText('Your opponent moved');
  await expect(replayButton(viewer)).toBeVisible();await expect(context(viewer)).toContainText('Guest 1 moved');
  for(const page of [owner,viewer])await expect(label(page).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  // The accepted summary is independently hosted. Its real primary action stays
  // in the finite Board slot, with no narration or offscreen hidden duplicate.
  await expect(label(opponent)).not.toContainText('Your opponent moved');
  await expect(label(opponent).getByRole('button',{name:'Pass',exact:true})).toBeVisible();
  const gray=await context(opponent).evaluate(notice=>({face:getComputedStyle(notice).backgroundColor,border:getComputedStyle(notice).borderColor,ink:getComputedStyle(notice).color,marker:getComputedStyle(notice,'::before').backgroundColor}));
  expect(gray).toEqual({face:'rgb(236, 236, 236)',border:'rgb(170, 170, 170)',ink:'rgb(40, 40, 40)',marker:'rgb(102, 102, 102)'});
  const close=context(opponent).getByRole('button',{name:'Dismiss Board context',exact:true});
  expect(await close.evaluate(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,icon:button.querySelector('svg').getBoundingClientRect().width,background:getComputedStyle(button).backgroundColor}))).toMatchObject({width:44,height:44,icon:16,background:'rgba(0, 0, 0, 0)'});
  await opponent.screenshot({path:info.outputPath(`native-gray-${width}.png`)});
  if(width===390){
   await opponent.setViewportSize({width,height:600});
   await opponent.evaluate(()=>document.documentElement.style.fontSize='32px');
   await opponent.evaluate(()=>document.fonts.ready);
   const explanation=context(opponent).getByRole('region',{name:'Board explanation',exact:true});
   await expect(explanation).toHaveAttribute('tabindex','0');
   await expect(context(opponent).locator('.board-context-scroll-cue')).toBeVisible();
   const primary=label(opponent).getByRole('button',{name:'Pass',exact:true});
   const initial=await primary.boundingBox();
   // Keep the selected top layout's initial below-fold condition visible in
   // evidence. Native keyboard traversal owns the visibility correction.
   // macOS WebKit's default keyboard profile skips native buttons with Tab.
   // Option+Tab visits all controls without changing OS preferences or markup.
   // Linux CI retains plain Tab and the same clearance assertions below.
   const traversalKey=process.platform==='darwin'&&browserName==='webkit'?'Alt+Tab':'Tab';
   await info.attach('Native keyboard traversal profile',{body:JSON.stringify({platform:process.platform,browserName,traversalKey}),contentType:'application/json'});
   for(let index=0;index<40&&!await primary.evaluate(el=>el===document.activeElement);index++)await opponent.keyboard.press(traversalKey);
   await expect(primary).toBeFocused();
   const clearance=await primary.evaluate(button=>{
    const notice=document.querySelector('[data-alert-stack-card].is-active'),nav=document.querySelector('.shell-mobile-tabbar'),rect=button.getBoundingClientRect();
    return {top:rect.top,bottom:rect.bottom,noticeBottom:notice?.getBoundingClientRect().bottom??0,navTop:nav?.getBoundingClientRect().top??innerHeight,scrollY,unmapped:document.querySelectorAll('[data-prompt-unmapped="true"]').length,overflow:document.querySelectorAll('[data-prompt-overflow="true"]').length};
   });
   expect(clearance.unmapped).toBe(0);expect(clearance.overflow).toBe(0);expect(clearance.top).toBeGreaterThanOrEqual(clearance.noticeBottom+8);expect(clearance.bottom).toBeLessThanOrEqual(clearance.navTop-8);
   await info.attach('Selected top short200 initial and native focus clearance',{body:JSON.stringify({initial,clearance}),contentType:'application/json'});
   await opponent.screenshot({path:info.outputPath('native-gray-mobile-short200-keyboard.png')});
   await opponent.evaluate(()=>document.documentElement.style.fontSize='');await opponent.setViewportSize({width,height:900});
  }


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
  await submitPlayableAction(opponent,next);await expect(viewer.locator('.computer-replay')).toHaveCount(0);await expect(context(viewer)).toContainText('Guest 2 moved');
  const advanced=await projected(opponent,gameId),seenByViewer=await projected(viewer,gameId);assertUnchanged(advanced,seenByViewer);
  for(const write of viewerWrites){
   expect(write.method).toBe('POST');expect(write.path).toBe(`/api/shell/games/${gameId}/decision-history`);
   expect(write.body).toEqual({identityId:viewerIdentity,metadataOnly:true,cursor:null,historyRevision:advanced.gameplayRevision,mode:'additional',protocolVersion:2});
  }viewer.off('request',watch);
  await expect(context(viewer)).toContainText('Guest 2 moved');
  const boardBox=await viewer.getByTestId('game-board').boundingBox();
  await context(viewer).getByRole('button',{name:'Dismiss Board context',exact:true}).click();
  await expect(context(viewer)).toHaveCount(0);
  const afterDismiss=await viewer.getByTestId('game-board').boundingBox();
  expect(afterDismiss).toEqual(boardBox);
  await switchGamePanel(viewer,'history');
  const fallback=viewer.locator('.history-live-replay').getByRole('button',{name:'Show me again',exact:true});
  await expect(fallback).toBeVisible();await expect(fallback).toHaveCount(1);
  await fallback.click();await expect(viewer.locator('.computer-replay')).toBeVisible();
  if(width===390)await expect(viewer.locator('[data-mobile-panel="board"]')).toHaveAttribute('data-active','true');
  await label(viewer).getByRole('button',{name:'Stop replay',exact:true}).click();await expect(viewer.locator('.computer-replay')).toHaveCount(0);


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
  await expect(context(owner)).toContainText('Your opponent moved');await expect(replayButton(owner)).toBeVisible();
  const pass=label(owner).getByRole('button',{name:'Pass',exact:true});await expect(pass).toBeVisible();
  const beforePass=await projected(owner,gameId),passWrites=[];const trackPass=request=>{if(isOperationRequest(request,'apply'))passWrites.push(request.postDataJSON())};owner.on('request',trackPass);
  await pass.click();await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(beforePass.board.state.turnIndex+1);
  const passed=await projected(owner,gameId);expect(passed.gameplayRevision).toBe(beforePass.gameplayRevision+1);expect(passed.moves.at(-1).action).toEqual({type:'pass'});expect(passWrites).toHaveLength(1);owner.off('request',trackPass);
  await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
});
