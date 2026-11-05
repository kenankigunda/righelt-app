import {readFileSync} from 'node:fs';
import {installOwnedFocusObservation} from '../support/owned-replay-focus-observer.mjs';
const ownedFocusRecipes=JSON.parse(readFileSync(new URL('../support/owned-replay-focus-recipes.json',import.meta.url),'utf8'));
import {test as base,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
import {installNativeFocusTrail,nativeFocusCheckpoint,finishNativeFocusTrail} from '../support/native-focus-trail.mjs';
import {boardActionTraversalKey,readBoardTraversalStart} from '../support/native-board-keyboard.mjs';
import {assertMobileBoardCellAccess} from '../support/mobile-board-cell-access.mjs';
import {edgeDelta} from '../../browser-integration/support/message-semantic-geometry.mjs';
// Teardown has Playwright's separate bounded fixture phase. Setup and every
// behavior assertion retain the existing 60-second test budget.
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
  const hitReadiness=await close.evaluate(async button=>{
   const notice=button.closest('[data-board-context]'),card=button.closest('[data-alert-stack-card]');
   const finite=()=>card.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime));
   const sample=()=>{const r=button.getBoundingClientRect(),s=getComputedStyle(button);return {width:r.width,height:r.height,icon:button.querySelector('svg').getBoundingClientRect().width,background:s.backgroundColor,
    offsetWidth:button.offsetWidth,offsetHeight:button.offsetHeight,cssWidth:s.width,cssHeight:s.height,zoom:s.zoom,devicePixelRatio,
    buttonTransform:s.transform,noticeTransform:getComputedStyle(notice).transform,cardTransform:getComputedStyle(card).transform,
    connected:button.isConnected,current:document.querySelector('#app [data-board-context]:has(.board-context-replay)')===notice,active:card.classList.contains('is-active'),
    finiteAnimations:finite().map(animation=>({kind:animation.constructor.name,name:animation.animationName??animation.transitionProperty??null,playState:animation.playState,pending:animation.pending,currentTime:animation.currentTime}))};};
   const before=sample(),animations=finite();
   const outcomes=await Promise.allSettled(animations.map(animation=>animation.finished));
   return {before,waited:animations.length,outcomes:outcomes.map(result=>result.status),after:sample()};
  });
  await info.attach('Native dismiss geometry before and after finite notification animations',{body:JSON.stringify(hitReadiness),contentType:'application/json'});
  expect(hitReadiness.after).toMatchObject({connected:true,current:true,active:true,width:44,height:44,icon:16,background:'rgba(0, 0, 0, 0)'});
  expect(hitReadiness.after.finiteAnimations.filter(animation=>animation.pending||animation.playState==='running')).toHaveLength(0);
  await opponent.screenshot({path:info.outputPath(`native-gray-${width}.png`)});
  if(width===390){
   const tall=await opponent.getByTestId('game-board').evaluate(node=>{const style=getComputedStyle(node);return {rect:node.getBoundingClientRect().toJSON(),css:{width:style.width,height:style.height},offset:{width:node.offsetWidth,height:node.offsetHeight}};});
   const tallBoard=tall.rect;
   await opponent.setViewportSize({width,height:740});await opponent.evaluate(()=>document.fonts.ready);
   const normal=await opponent.evaluate(()=>{
    const rect=selector=>{const node=document.querySelector(selector);return node?.getBoundingClientRect().toJSON()??null;};
    const metrics=selector=>{const node=document.querySelector(selector);if(!node)return null;const s=getComputedStyle(node);return {padding:s.padding,margin:s.margin,gap:s.gap,fontSize:s.fontSize,lineHeight:s.lineHeight,minHeight:s.minHeight};};
    const cells=[...document.querySelectorAll('#shell-board > .cell')].map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height};});
    const pass=document.querySelector('#shell-board-preview-label [data-board-message-action="pass"]');
    return {viewport:{width:innerWidth,height:innerHeight},scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,fonts:document.fonts.status,
     header:rect('.shell-header'),context:rect('[data-alert-stack-card].is-active'),contextBody:rect('.is-active .board-context-body'),contextReplay:rect('.is-active .board-context-replay'),contextDismiss:rect('.is-active .board-context-dismiss'),
     panel:rect('[data-shell-panel="board"]'),heading:rect('.board-heading-slot'),slot:rect('.board-message-slot'),board:rect('#shell-board'),boardCss:{width:getComputedStyle(document.querySelector('#shell-board')).width,height:getComputedStyle(document.querySelector('#shell-board')).height},boardOffset:{width:document.querySelector('#shell-board').offsetWidth,height:document.querySelector('#shell-board').offsetHeight},wrap:rect('[data-testid="game-board-wrap"]'),legend:rect('[data-shell-panel="board"] .overlay-key'),nav:rect('.shell-mobile-tabbar'),navVisible:document.querySelector('.shell-mobile-tabbar')?.dataset.visible,
     frameReserve:document.querySelector('[data-game-shell-root]')?.style.getPropertyValue('--board-context-reserve'),cellCount:cells.length,minCellWidth:Math.min(...cells.map(r=>r.width)),minCellHeight:Math.min(...cells.map(r=>r.height)),
     pass:pass?.getBoundingClientRect().toJSON()??null,passHitHeight:pass?getComputedStyle(pass,'::before').height:null,
     metrics:Object.fromEntries(['[data-shell-panel="board"]','.board-heading-slot','.board-heading','.board-message-slot','.board-message-live','.board-wrap','.overlay-key','.board-context-body','.board-context-actions'].map(selector=>[selector,metrics(selector)]))};
   });
   await info.attach('Normal390x740 Board and chrome geometry',{body:JSON.stringify({...normal,tallBoard,tall}),contentType:'application/json'});
   await opponent.screenshot({path:info.outputPath('native-gray-mobile-normal740.png')});
   expect(normal.cellCount).toBe(100);expect(normal.board.bottom).toBeLessThanOrEqual(normal.viewport.height+1);
   expect(normal.boardCss).toEqual(tall.css);expect(normal.boardOffset).toEqual(tall.offset);
   for(const rect of [normal.board,tallBoard]){expect(rect.right).toBe(rect.left+rect.width);expect(rect.bottom).toBe(rect.top+rect.height);}
   for(const dimension of ['width','height'])edgeDelta(normal.board[dimension],tallBoard[dimension],0,0,[normal.board[dimension],tallBoard[dimension]],`unchanged Board ${dimension} across viewport heights`);
   await assertMobileBoardCellAccess(opponent,info,{before:await projected(opponent,gameId),readState:()=>projected(opponent,gameId),assertUnchanged});
   // Preserve the existing 900px manual Next/Stop replay viewport.
   await opponent.setViewportSize({width,height:900});
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
   // Other engine profiles retain their existing native key choice.
   // Existing Stop replay owns a return to the current Show me again control,
   // before Pass in document order. Native traversal must not rely on wrapping
   // past navigation or crossing the 100 cell buttons in reverse. Keep all cells
   // and the original gesture bound and focus/clearance oracles.
   const traversalKey=boardActionTraversalKey({platform:process.platform,browserName});
   let traversalStart,startFailure;
   try{
    // Wait only for the existing owned Stop return. Never establish focus here.
    if(browserName==='firefox')await expect(replayButton(opponent)).toBeFocused();
   }catch(error){startFailure=error;throw error;}
   finally{
    try{
     traversalStart=browserName==='firefox'?await primary.evaluate(readBoardTraversalStart):null;
     await info.attach('Native keyboard traversal profile',{body:JSON.stringify({platform:process.platform,browserName,traversalKey,traversalStart}),contentType:'application/json'});
    }catch(error){if(!startFailure)throw error;console.error('native-start-evidence-incomplete');}
   }
   if(browserName==='firefox')expect(traversalStart,'Existing owned replay return is the current eligible control before Pass').toMatchObject({ready:true});
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
    const notice=document.querySelector('[data-alert-stack-card].is-active'),nav=document.querySelector('.shell-mobile-tabbar'),rect=button.getBoundingClientRect();
    return {top:rect.top,bottom:rect.bottom,noticeBottom:notice?.getBoundingClientRect().bottom??0,navTop:nav?.getBoundingClientRect().top??innerHeight,scrollY,unmapped:document.querySelectorAll('[data-prompt-unmapped="true"]').length,overflow:document.querySelectorAll('[data-prompt-overflow="true"]').length};
   });
   await info.attach('Selected top short200 initial and native focus clearance',{body:JSON.stringify({initial,clearance}),contentType:'application/json'});
   expect(clearance.unmapped).toBe(0);expect(clearance.overflow).toBe(0);expect(clearance.top).toBeGreaterThanOrEqual(clearance.noticeBottom+8);expect(clearance.bottom).toBeLessThanOrEqual(clearance.navTop-8);
   await opponent.screenshot({path:info.outputPath('native-gray-mobile-short200-keyboard.png')});
   await opponent.evaluate(()=>document.documentElement.style.fontSize='');await opponent.setViewportSize({width,height:900});
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
  const boardBox=await viewer.getByTestId('game-board').boundingBox();
  await context(viewer).getByRole('button',{name:'Dismiss Board context',exact:true}).click();
  await expect(context(viewer)).toHaveCount(0);
  const afterDismiss=await viewer.getByTestId('game-board').boundingBox();
  expect(afterDismiss).toEqual(boardBox);
  await switchGamePanel(viewer,'history');
  const fallback=viewer.locator('.history-live-replay').getByRole('button',{name:'Show me again',exact:true});
  await expect(fallback).toBeVisible();await expect(fallback).toHaveCount(1);
  // Observe the real native activation before the app's delegated handler.
  // Keep only bounded booleans/counts, with no game, identity or URL data.
  await viewer.evaluate(()=>{
   const state={seen:0,first:null};
   const capture=event=>{
    const target=event.target.closest?.('.history-live-replay [data-action="replay-board-context"]');if(!target)return;
    state.seen=Math.min(2,state.seen+1);
    state.first??={trusted:event.isTrusted,targetFocused:document.activeElement===target,documentFocused:document.hasFocus(),hidden:document.hidden};
   };
   document.addEventListener('click',capture,{capture:true,passive:true});
   globalThis.__historyReplayActivation={state,dispose:()=>document.removeEventListener('click',capture,true)};
  });
  let activationError=null,activation={incomplete:true};
  try{await fallback.click();}catch(error){activationError=error;}
  try{activation=await viewer.evaluate(()=>{const owned=globalThis.__historyReplayActivation;try{return owned?.state??{incomplete:true};}finally{owned?.dispose();delete globalThis.__historyReplayActivation;}});}catch(error){activationError??=error;}
  try{await info.attach('Native History replay activation before app handler',{body:JSON.stringify(activation),contentType:'application/json'});}catch(error){activationError??=error;}
  if(activationError)throw activationError;
  await expect(viewer.locator('.computer-replay')).toBeVisible();
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
