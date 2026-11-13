import {readFileSync} from 'node:fs';
import {installOwnedFocusObservation} from '../support/owned-replay-focus-observer.mjs';
const ownedFocusRecipes=JSON.parse(readFileSync(new URL('../support/owned-replay-focus-recipes.json',import.meta.url),'utf8'));
import {test as base,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
import {installNativeFocusTrail,nativeFocusCheckpoint,finishNativeFocusTrail} from '../support/native-focus-trail.mjs';
import {boardActionTraversalKey,readBoardTraversalStart} from '../support/native-board-keyboard.mjs';
import {assertMobileBoardCellAccess} from '../support/mobile-board-cell-access.mjs';
import {edgeDelta} from '../../browser-integration/support/message-semantic-geometry.mjs';
import {MOBILE_NAVIGATION} from '../../apps/web/shell/mobile-navigation.js';
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
for(const width of [390,1440])replayTest(`human opponent replay preserves authority and read-only inspection at ${width}px`,async({humanReplayPrerequisites:{owner,opponent,viewer,gameId},browserName},info)=>{
  // This case also carries native mobile geometry, stacking, hit ownership,
  // 200% text, and keyboard-return evidence. Keep that proof in the complete
  // multi-user journey while giving only its Chromium/mobile path enough time.
  if(width===390&&browserName==='chromium')info.setTimeout(90000);
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
  if(width===390)await expect(context(opponent)).toHaveClass(/incoming-move-flyout/);
  else await expect(context(opponent)).toHaveClass(/history-incoming/);
  await expect(opponent.locator('[data-alert-stack-card] [data-incoming-context]')).toHaveCount(0);
  await opponent.screenshot({path:info.outputPath(`incoming-turn-${width}.png`)});
  // Chromium's native pointer profile focuses the incoming replay control, so
  // it owns the bounded keyboard-return journey. Firefox on macOS deliberately
  // retains the previously clicked Board cell for pointer activation and still
  // runs the complete replay, authority and responsive contracts above/below.
  if(width===390&&browserName==='chromium'){
   const tall=await opponent.getByTestId('game-board').evaluate(node=>{const style=getComputedStyle(node);return {rect:node.getBoundingClientRect().toJSON(),css:{width:style.width,height:style.height},offset:{width:node.offsetWidth,height:node.offsetHeight}};});
   const tallBoard=tall.rect;
   await opponent.setViewportSize({width,height:740});await opponent.evaluate(()=>document.fonts.ready);
   const normal=await opponent.evaluate(()=>{
    const rect=selector=>{const node=document.querySelector(selector);return node?.getBoundingClientRect().toJSON()??null;};
    const metrics=selector=>{const node=document.querySelector(selector);if(!node)return null;const s=getComputedStyle(node);return {padding:s.padding,margin:s.margin,gap:s.gap,fontSize:s.fontSize,lineHeight:s.lineHeight,minHeight:s.minHeight};};
    const cells=[...document.querySelectorAll('#shell-board > .cell')].map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height};});
    const pass=document.querySelector('#shell-board-preview-label [data-board-message-action="pass"]');
    return {viewport:{width:innerWidth,height:innerHeight},scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,fonts:document.fonts.status,
     header:rect('.shell-header'),context:rect('[data-incoming-context]'),contextReplay:rect('[data-incoming-context] [data-action="replay-board-context"]'),
     panel:rect('[data-shell-panel="board"]'),heading:rect('.board-heading-slot'),slot:rect('.board-message-slot'),board:rect('#shell-board'),boardCss:{width:getComputedStyle(document.querySelector('#shell-board')).width,height:getComputedStyle(document.querySelector('#shell-board')).height},boardOffset:{width:document.querySelector('#shell-board').offsetWidth,height:document.querySelector('#shell-board').offsetHeight},wrap:rect('[data-testid="game-board-wrap"]'),legend:rect('[data-shell-panel="board"] .overlay-key'),nav:rect('.shell-mobile-tabbar'),navVisible:document.querySelector('.shell-mobile-tabbar')?.dataset.visible,
     frameReserve:document.querySelector('[data-game-shell-root]')?.style.getPropertyValue('--board-context-reserve'),cellCount:cells.length,minCellWidth:Math.min(...cells.map(r=>r.width)),minCellHeight:Math.min(...cells.map(r=>r.height)),
     pass:pass?.getBoundingClientRect().toJSON()??null,passHitHeight:pass?getComputedStyle(pass,'::before').height:null,
     metrics:Object.fromEntries(['[data-shell-panel="board"]','.board-heading-slot','.board-heading','.board-message-slot','.board-message-live','.board-wrap','.overlay-key','[data-incoming-context]'].map(selector=>[selector,metrics(selector)]))};
   });
   await info.attach('Normal390x740 Board and chrome geometry',{body:JSON.stringify({...normal,tallBoard,tall}),contentType:'application/json'});
   await opponent.screenshot({path:info.outputPath('incoming-mobile-normal740.png')});
   expect(normal.cellCount).toBe(100);expect(normal.board.bottom).toBeLessThanOrEqual(normal.viewport.height+1);
   expect(normal.boardCss).toEqual(tall.css);expect(normal.boardOffset).toEqual(tall.offset);
   for(const rect of [normal.board,tallBoard]){expect(rect.right).toBe(rect.left+rect.width);expect(rect.bottom).toBe(rect.top+rect.height);}
   for(const dimension of ['width','height'])edgeDelta(normal.board[dimension],tallBoard[dimension],0,0,[normal.board[dimension],tallBoard[dimension]],`unchanged Board ${dimension} across viewport heights`);
   const collapse=context(opponent).getByRole('button',{name:'Hide previous turn',exact:true});await collapse.click();await expect(context(opponent)).toHaveAttribute('data-expanded','false');
   await assertMobileBoardCellAccess(opponent,info,{before:await projected(opponent,gameId),readState:()=>projected(opponent,gameId),assertUnchanged});
   // Preserve the existing 900px manual Next/Stop replay viewport.
   await opponent.setViewportSize({width,height:900});
   const expand=context(opponent).getByRole('button',{name:'Show previous turn',exact:true});await expand.focus();await expand.press('Enter');await expect(context(opponent)).toHaveAttribute('data-expanded','true');
  }


  // An inactive seated player can still inspect a piece and its command lines.
  const saved=await projected(owner,gameId),piece=saved.board.state.pieces.find(piece=>piece.owner==='P1');
  const cell=(page,point)=>page.locator(`[data-testid="game-board"] .cell[data-row="${point.row}"][data-col="${point.col}"]`);
  expect(piece.kind).toBe('commander');await cell(owner,piece.position).click();await expect(label(owner)).toHaveText('Supply lines');
  const explanation=owner.getByRole('region',{name:'Board explanation',exact:true});
  await expect(explanation).toContainText('Supply line for commander at');await expect(explanation).toContainText('No connected units.');await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  await owner.locator('[data-board-inspection="command"]').click();await expect(label(owner)).toHaveText('No connection');await expect(explanation).toContainText('Commander at');await expect(explanation).toContainText('No connections.');await expect(owner.locator('#shell-overlay-lines [data-legend-kind="supply"]')).toHaveCount(0);await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
  const writes=[];const listen=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/'))writes.push({method:request.method(),path:new URL(request.url()).pathname});};opponent.on('request',listen);
  const before=await projected(opponent,gameId);
  await opponent.emulateMedia({reducedMotion:'reduce'});await replayButton(opponent).click();await expect(opponent.locator('.computer-replay')).toBeVisible();await expect(label(opponent).getByRole('button',{name:'Next',exact:true})).toBeVisible();
  await opponent.screenshot({path:info.outputPath('human-replay-manual.png')});
  await label(opponent).getByRole('button',{name:'Next',exact:true}).click();await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  await replayButton(opponent).click();const stopReplay=label(opponent).getByRole('button',{name:'Stop replay',exact:true});await stopReplay.focus();await expect(stopReplay).toBeFocused();await stopReplay.press('Enter');await expect(opponent.locator('.computer-replay')).toHaveCount(0);
  const postStopFocus=await replayButton(opponent).evaluate(button=>{const active=document.activeElement;return {replayFocused:active===button,activeTag:active?.tagName??null,activeAction:active?.dataset?.action??active?.dataset?.boardMessageAction??null,activeText:active?.textContent?.trim().slice(0,80)??null,activeConnected:active?.isConnected??false,replayConnected:button.isConnected};});
  await info.attach('Native focus immediately after Stop replay',{body:JSON.stringify(postStopFocus),contentType:'application/json'});expect(postStopFocus,JSON.stringify(postStopFocus)).toMatchObject({replayFocused:true});
  if(width===390&&browserName==='chromium'){
   const collapse=context(opponent).getByRole('button',{name:'Hide previous turn',exact:true});await collapse.click();await expect(context(opponent)).toHaveAttribute('data-expanded','false');
   await opponent.setViewportSize({width,height:600});
   await opponent.evaluate(()=>document.documentElement.style.fontSize='32px');
   await opponent.evaluate(()=>document.fonts.ready);
   const primary=label(opponent).getByRole('button',{name:'Pass',exact:true});
   const initial=await primary.boundingBox();
   const traversalKey=boardActionTraversalKey({platform:process.platform,browserName});
   let traversalStart,startFailure,lastTraversalStart;
   try{
    await expect.poll(async()=>lastTraversalStart=await primary.evaluate(readBoardTraversalStart)).toMatchObject({ready:true});
   }catch(error){startFailure=error;throw Error(`Native Board traversal start never became eligible: ${JSON.stringify(lastTraversalStart)}`,{cause:error});}
   finally{
    try{
     traversalStart=await primary.evaluate(readBoardTraversalStart);
     await info.attach('Native keyboard traversal profile',{body:JSON.stringify({platform:process.platform,browserName,traversalKey,traversalStart}),contentType:'application/json'});
    }catch(error){if(!startFailure)throw error;console.error('native-start-evidence-incomplete');}
   }
   expect(traversalStart,'Native traversal begins from the current incoming toggle after the expanded flyout is collapsed').toMatchObject({ready:true,startIsBody:false,startControlFocused:true,startAction:'toggle-incoming-narration'});
   const observeFocus=process.env.RIGHELT_FF_TRAVERSAL_OBSERVER==='1';
   if(observeFocus)await primary.evaluate(installNativeFocusTrail,{platform:process.platform,browserName,traversalKey});
   let traversalFailure;
   try{
    for(let index=0;index<40&&!await primary.evaluate(observeFocus?nativeFocusCheckpoint:el=>el===document.activeElement);index++)await opponent.keyboard.press(traversalKey);
    await expect(primary).toBeFocused();
   }catch(error){traversalFailure=error;throw error;}
   finally{
    if(observeFocus){
     let observationError;
     try{const trail=await opponent.evaluate(finishNativeFocusTrail);await info.attach('Native focus trail',{body:JSON.stringify(trail),contentType:'application/json'});if(!trail.complete)throw Error('Native focus trail truncated');}catch(error){observationError=error;}
     if(observationError){try{await info.attach('Native focus observation incomplete',{body:String(observationError),contentType:'text/plain'});}catch(error){console.error(JSON.stringify({kind:'native-focus-observation-attachment-failed',name:error?.name??'Error'}));}if(!traversalFailure)throw observationError;}
    }
   }
   const clearance=await primary.evaluate(button=>{
    const incoming=document.querySelector('[data-incoming-context]'),nav=document.querySelector('.shell-mobile-tabbar'),rect=button.getBoundingClientRect(),incomingRect=incoming?.getBoundingClientRect(),navRect=nav?.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,hit=document.elementFromPoint(x,y);
    return {top:rect.top,bottom:rect.bottom,incomingTop:incomingRect?.top??innerHeight,navTop:navRect?.top??innerHeight,obstacleTop:Math.min(incomingRect?.top??innerHeight,navRect?.top??innerHeight),centerOwned:hit===button||button.contains(hit),scrollY,unmapped:document.querySelectorAll('[data-prompt-unmapped="true"]').length,overflow:document.querySelectorAll('[data-prompt-overflow="true"]').length};
   });
   await info.attach('Short 200 percent text initial and native focus clearance',{body:JSON.stringify({initial,clearance}),contentType:'application/json'});
   expect(clearance.unmapped).toBe(0);expect(clearance.overflow).toBe(0);expect(clearance.top).toBeGreaterThanOrEqual(0);expect(clearance.bottom).toBeLessThanOrEqual(clearance.obstacleTop-8);expect(clearance.centerOwned).toBe(true);
   await opponent.screenshot({path:info.outputPath('incoming-mobile-short200-keyboard.png')});
   await opponent.mouse.move(4,300);await opponent.mouse.wheel(0,-10000);await expect.poll(()=>opponent.evaluate(()=>scrollY)).toBe(0);
   await opponent.mouse.wheel(0,MOBILE_NAVIGATION.hideDistance+8);await expect(opponent.locator('.shell-mobile-tabbar')).toHaveAttribute('data-visible','false');
   await opponent.evaluate(()=>document.documentElement.style.fontSize='');await opponent.setViewportSize({width,height:900});
   const expand=context(opponent).getByRole('button',{name:'Show previous turn',exact:true});await expand.focus();await expect(expand).toBeFocused();await expand.press('Enter');await expect(context(opponent)).toHaveAttribute('data-expanded','true');
  }
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
   await expect(replayButton(opponent)).toBeVisible();
   const moved=await projected(owner,gameId),piece=moved.board.state.pieces.find(piece=>piece.owner==='P1');expect(piece).toBeTruthy();
   expect(moved.board.state.pieces.some(piece=>piece.position.row===4&&piece.position.col===4)).toBe(false);
   await owner.locator('[data-testid="game-board"] .cell[data-row="4"][data-col="4"]').click();
   await owner.locator(`[data-testid="game-board"] .cell[data-row="${piece.position.row}"][data-col="${piece.position.col}"]`).click();
   // The finite Board label and the complete scrollable explanation are separate surfaces.
   await expect(label(owner)).toHaveText('Supply lines');
   const inspectionHelp=owner.getByRole('region',{name:'Board explanation',exact:true}).filter({hasText:'Supply line for commander at'});
   await expect(inspectionHelp).toBeVisible();await expect(inspectionHelp).toContainText('Supply line for commander at');
   await expect(inspectionHelp.locator('.board-preview-coordinate-chip')).toHaveText(`${piece.position.row}, ${piece.position.col}`);
   await expect(inspectionHelp).toContainText('No connected units.');
  }
 }
  // Reopening the live game clears inspection and exposes legal Pass beside narration.
  await owner.reload();await expect(owner.getByTestId('game-shell')).toBeVisible();await switchGamePanel(owner,'board');
  await expect(context(owner)).toContainText('Guest 2 moved');await expect(replayButton(owner)).toBeVisible();
  const pass=label(owner).getByRole('button',{name:'Pass',exact:true});await expect(pass).toBeVisible();
  const beforePass=await projected(owner,gameId),passWrites=[];const trackPass=request=>{if(isOperationRequest(request,'apply'))passWrites.push(request.postDataJSON())};owner.on('request',trackPass);
  await pass.click();await expect.poll(async()=>(await projected(owner,gameId)).board.state.turnIndex).toBe(beforePass.board.state.turnIndex+1);
  const passed=await projected(owner,gameId);expect(passed.gameplayRevision).toBe(beforePass.gameplayRevision+1);expect(passed.moves.at(-1).action).toEqual({type:'pass'});expect(passWrites).toHaveLength(1);owner.off('request',trackPass);
  await expect(label(owner).locator('[data-board-preview-action],[data-board-message-action="pass"]')).toHaveCount(0);
});

async function expectLiveOverview(page,board,visible) {
 const recorded=board.locator('.recorded-action-source-piece');
 if(!visible){await expect(recorded).toHaveCount(0);return;}
 // A source token alone could belong to an acknowledged/manual playback frame.
 // A usable live Pass and actual recorded paint together establish this surface.
 await expect(label(page).getByRole('button',{name:'Pass',exact:true})).toBeEnabled();
 await expect(recorded.first()).toBeVisible();
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
 await expect(cell(action.from).locator('.recorded-action-source-piece')).toBeVisible();
 await expect(cell(action.to).locator(`.piece-token[data-piece-id="${action.actorId}"]:not(.move-ghost)`)).toBeVisible();
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
 await cell(enemy.position).click();await expectLiveOverview(opponent,board,false);
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expectLiveOverview(opponent,board,true);
 await cell({row:0,col:9}).click();await expectLiveOverview(opponent,board,false);
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expectLiveOverview(opponent,board,true);
 await cell(own.position).click();await expectLiveOverview(opponent,board,false);
 await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expect(replayButton(opponent)).toBeVisible();
 await expectLiveOverview(opponent,board,false);
 assertUnchanged(before,await projected(opponent,gameId));expect(writes).toEqual([]);opponent.off('request',watch);
 await opponent.reload();await expect(opponent.getByTestId('game-shell')).toBeVisible();await switchGamePanel(opponent,'board');
 await expectLiveOverview(opponent,board,true);
 await cell(own.position).click();await expect(label(opponent)).not.toHaveAttribute('data-loading-state','pending');await cell(empty()).click();await expectLiveOverview(opponent,board,false);
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
