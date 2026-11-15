import {test, expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {settledMessage,measureSemanticGeometry,assertSemanticGeometry} from './support/message-semantic-geometry.mjs';
import {createRushBlockerScenario} from '../e2e/support/rush-blocker-scenario.mjs';

for (const width of [320, 390]) test(`selection guidance owns one accessible Board message at ${width}px with enlarged text`, async ({page}, info) => {
  await page.setViewportSize({width, height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(async () => {
    await window.boardFixture.setup('rush', false);
    document.documentElement.style.fontSize = '200%';
    await document.fonts.ready;
  });
  await settledMessage(page);
  const before = await measureSemanticGeometry(page);
  const accountMessageGrowth=async()=>{await settledMessage(page);assertSemanticGeometry(before,await measureSemanticGeometry(page));};
  const configure = async (kind, interactive = true) => page.evaluate(async ({kind, interactive}) => {
    const piece = {id:'A',owner:'P1',kind:'unit',position:{row:4,col:2},supplied:true,commanded:true};
    const state = {boardSize:10,sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'},pieces:[piece],continuation:null};
    if (kind === 'inactive') piece.commanded = false;
    if (kind.startsWith('frozen')) {
      piece.displayCommanded = false;
      state.continuation = {type:'rush',owner:state.sideToMove,rushChainPieceIds:[],rushedPieceIds:[],frozenPieceStatesById:{A:{supplied:true,commanded:false}}};
    }
    if(kind==='frozen-blocker'){state.continuation.frozenPieceStatesById.A.supplied=false;state.pieces.push({id:'B',owner:'P1',kind:'unit',position:{row:9,col:9},supplied:false,commanded:true},...[[8,9],[9,8]].map(([row,col],index)=>({id:`wall-${index}`,owner:'P2',kind:'unit',position:{row,col},supplied:true,commanded:true})));Object.assign(state.continuation,{owner:'P1',rushChainPieceIds:['B'],rushedPieceIds:['B']});}
    const {canCloseContinuationNow}=await import('/apps/web/generated/packages/game-engine/src/continuation.js');
    if(kind==='frozen'&&!canCloseContinuationNow(state))throw Error('Optional frozen fixture must be a real closable continuation before injecting End turn');
    if(kind==='frozen-blocker'&&canCloseContinuationNow(state))throw Error('Required supply fixture must not admit End turn');
    await window.boardFixture.configure(state, kind === 'frozen' ? [{type:'end_turn'}] : [], {
      interactive, selectionState:{selectedPieceId:'A',source:{row:4,col:2},target:null},
    });
  }, {kind, interactive});
  await configure('inactive');
  await expect(page.locator('#preview')).toContainText('No command connection for piece at 4, 2');
  await expect(page.locator('#fixture-context')).toBeEmpty();
  await accountMessageGrowth();
  expect(await page.locator('.cell.selected-piece').evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  await page.screenshot({path:info.outputPath(`inactive-${width}-200.png`)});
  await configure('frozen');
  await expect(page.locator('#preview')).toContainText("This piece can't move during this rush.");
  await expect(page.locator('#fixture-context')).toBeEmpty();
  const why=page.locator('[data-board-message-action="toggle-board-explanation"]');
  await expect(why).toHaveAttribute('aria-expanded','false');
  expect(await why.evaluate(node=>parseFloat(getComputedStyle(node,'::before').height))).toBeGreaterThanOrEqual(44);
  await why.click();
  await expect(why).toHaveAttribute('aria-expanded','true');
  await expect(page.locator('#board-guidance-detail')).toContainText('It had no command connection when this rush began.');
  await expect(page.locator('#board-guidance-detail')).toContainText('not this turn');
  await expect(why).toHaveText('Less');
  await why.click();
  await expect(page.locator('#board-guidance-detail')).toBeHidden();
  await accountMessageGrowth();
  await configure('frozen-blocker');
  await expect(page.locator('#preview')).toContainText("This piece can't move during this rush.");
  await expect(page.locator('#fixture-context')).toBeEmpty();
  await page.locator('.cell[data-row="0"][data-col="0"]').click();
  await expect(page.locator('#preview')).toContainText('Select a rush to restore supply for piece at 9, 9');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await accountMessageGrowth();
  await configure('frozen', false);
  await expect(page.locator('#fixture-context')).toContainText("This piece can't move during this rush.");
  await expect(page.locator('#preview button')).toHaveCount(0);
  await page.evaluate(() => window.boardFixture.inspect({kind:'command',pieceId:'A'}));
  await expect(page.locator('#fixture-context')).toContainText("This piece can't move during this rush.");
  await expect(page.locator('.board-event-label')).toHaveCount(0);
  await accountMessageGrowth();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`frozen-inspection-${width}-200.png`)});
  await page.evaluate(async () => {
    const piece = (id, owner, kind, row, col) => ({id,owner,kind,position:{row,col},supplied:true,commanded:true});
    const state = {boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[
      piece('C1','P1','commander',4,4), piece('C2','P2','commander',6,3),
      piece('wall-top','P2','unit',0,4), piece('wall-bottom','P2','unit',9,4),
      piece('block-north','P2','unit',3,5), piece('block-south','P2','unit',5,5), piece('block-east','P2','unit',4,6),
    ]};
    await window.boardFixture.configure(state, [
      {type:'pass'}, ...[{row:3,col:4},{row:5,col:4},{row:4,col:3}].map(to => ({type:'move',actorId:'C1',from:{row:4,col:4},to})),
    ], {selectionState:{selectedPieceId:'C1',source:{row:4,col:4},target:{row:4,col:5}}});
  });
  await expect(page.locator('#preview')).toContainText('Destination would have no supply for piece at 4, 4');
  await expect(page.locator('#preview .board-preview-coordinate-chip')).toHaveText('4, 4');
  await expect(page.locator('#fixture-context')).toBeEmpty();
  await expect(page.locator('#preview button')).toHaveCount(0);
  expect(await page.locator('.cell.target').evaluate(node => getComputedStyle(node,'::after').content)).toBe('none');
  await accountMessageGrowth();
  await page.screenshot({path:info.outputPath(`blocked-target-${width}-200.png`)});

  // This final chapter uses a genuinely legal rush continuation. The engine,
  // runtime and adapter produce eligibility and source paint without test classes
  // or a hand-written legal-action list. Keep the same width/text/geometry case.
  const {state:rushState}=createRushBlockerScenario();
  const legality=await page.evaluate(async snapshot=>{
    const {listLegalActions,validateAction,canCloseContinuationNow,getRushContinuationBlockingPiece}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    const legalActions=listLegalActions(snapshot);
    const expected={type:'rush',actorId:'B',from:{row:5,col:5},to:{row:5,col:4}};
    const blocked=getRushContinuationBlockingPiece(snapshot)?.position;
    if(canCloseContinuationNow(snapshot)||blocked?.row!==4||blocked?.col!==3
      ||!validateAction(snapshot,expected).ok||!legalActions.some(action=>action.type==='rush'&&action.actorId==='B'&&action.from?.row===5&&action.from?.col===5&&action.to?.row===5&&action.to?.col===4)
      ||legalActions.some(action=>action.type==='end_turn'))throw Error('Known rush-source fixture must have complete genuine required legality');
    await window.boardFixture.setup('rush',false);
    await window.boardFixture.configure(snapshot,legalActions,{selectionState:{selectedPieceId:null,source:null,target:null}});
    return{legalCount:legalActions.length,expectedActionLegal:true,blocker:blocked,canEndTurn:false};
  },rushState);
  expect(legality).toMatchObject({expectedActionLegal:true,blocker:{row:4,col:3},canEndTurn:false});
  expect(legality.legalCount).toBeGreaterThan(0);
  await expect(page.locator('.rush-guidance-source')).toHaveCount(2);
  const source=page.locator('#board .cell[data-row="5"][data-col="5"]');
  const token=source.locator('.piece-token[data-piece-id="B"]');
  await expect(source).toHaveAttribute('aria-label','Supply-restoring rush available for piece at (5, 5)');
  await expect(token).toHaveAttribute('aria-label','Red unit');
  await expect(token).toHaveClass(/p1/);await expect(token).toBeVisible();
  const paint=await source.evaluate(cell=>{
    const token=cell.querySelector('.piece-token[data-piece-id="B"]'),symbol=token?.querySelector('.piece-body');
    const rect=cell.getBoundingClientRect(),tokenRect=token?.getBoundingClientRect();
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    const style=getComputedStyle(cell),pieceStyle=token?getComputedStyle(token):null;
    window.__rushSourceCell=cell;window.__rushSourcePointer=[];
    cell.addEventListener('pointerdown',event=>window.__rushSourcePointer.push({trusted:event.isTrusted,sameCell:event.target.closest('.cell')===cell}),{once:true,passive:true});
    return{row:cell.dataset.row,col:cell.dataset.col,pieceId:token?.dataset.pieceId,
      borderStyle:style.borderTopStyle,borderWidth:parseFloat(style.borderTopWidth),
      pieceOpacity:pieceStyle?.opacity,pieceVisibility:pieceStyle?.visibility,fill:symbol?getComputedStyle(symbol).fill:null,
      tokenWidth:tokenRect?.width,tokenHeight:tokenRect?.height,nativeCenterHit:hit?.closest('.cell')===cell};
  });
  expect(paint).toMatchObject({row:'5',col:'5',pieceId:'B',borderStyle:'dashed',pieceVisibility:'visible',nativeCenterHit:true});
  expect(paint.borderWidth).toBeGreaterThan(0);expect(paint.tokenWidth).toBeGreaterThan(0);expect(paint.tokenHeight).toBeGreaterThan(0);
  expect(Number(paint.pieceOpacity)).toBeGreaterThan(0);expect(Number(paint.pieceOpacity)).toBeLessThanOrEqual(1);
  expect(paint.fill).not.toBe('none');expect(paint.fill).not.toBe('rgba(0, 0, 0, 0)');
  await accountMessageGrowth();
  await source.click();
  await expect(source).toHaveClass(/selected-piece/);
  await expect(token).toHaveAttribute('data-piece-id','B');
  expect(await page.evaluate(()=>({selection:window.boardFixture.selection(),applied:window.boardFixture.applied(),
    sameCell:window.__rushSourceCell===document.querySelector('#board .cell[data-row="5"][data-col="5"]'),pointer:window.__rushSourcePointer})))
    .toMatchObject({selection:{selectedPieceId:'B',source:{row:5,col:5}},applied:[],sameCell:true,pointer:[{trusted:true,sameCell:true}]});
  await accountMessageGrowth();
  const sourceEvidencePath=info.outputPath(`rush-source-${width}-200.json`);
  await writeFile(sourceEvidencePath,JSON.stringify({legality,paint,scope:'Real engine/runtime/adapter at existing width and200%text. Native hit/selection and computed paint, not physical display measurement.'}),{mode:0o600});
  await info.attach('Actual rush-source identity, legality and paint',{path:sourceEvidencePath,contentType:'application/json'});
  await page.screenshot({path:info.outputPath(`rush-source-${width}-200.png`)});
});

test('Joined guidance keeps one focus-safe responsive height owner across native modes',async({page,browserName},info)=>{
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  await page.setViewportSize({width:390,height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{
    await window.boardFixture.setup('rush',false);
    const piece={id:'A',owner:'P1',kind:'unit',position:{row:4,col:2},supplied:true,commanded:true,displayCommanded:false};
    const state={boardSize:10,sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'},pieces:[piece],continuation:{type:'rush',owner:'P1',rushChainPieceIds:[],rushedPieceIds:[],frozenPieceStatesById:{A:{supplied:true,commanded:false}}}};
    await window.boardFixture.configure(state,[{type:'end_turn'}],{selectionState:{selectedPieceId:'A',source:{row:4,col:2},target:null}});
    await document.fonts.ready;
  });
  await settledMessage(page);
  const slot=page.locator('.board-message-slot'),toggle=page.locator('[data-board-message-action="toggle-board-explanation"]'),detail=page.locator('#board-guidance-detail');
  const collapsed=await measureSemanticGeometry(page);
  const inline=await toggle.evaluate(button=>{
    const rect=button.getBoundingClientRect(),pseudo=getComputedStyle(button,'::before');
    const text=button.previousSibling,range=document.createRange();range.setStart(text,Math.max(0,text.length-5));range.setEnd(text,text.length);
    const words=range.getBoundingClientRect(),hit={x:rect.left+rect.width/2,y:rect.top+rect.height/2-parseFloat(pseudo.height)/2+1};
    return {display:getComputedStyle(button).display,parent:button.parentElement.id,baselineDelta:Math.abs(words.bottom-rect.bottom),pseudoHeight:parseFloat(pseudo.height),hit,hitOwns:document.elementFromPoint(hit.x,hit.y)?.closest('[data-board-message-action="toggle-board-explanation"]')===button};
  });
  expect(inline).toMatchObject({display:'inline',parent:'preview',hitOwns:true});
  expect(inline.baselineDelta).toBeLessThanOrEqual(4);expect(inline.pseudoHeight).toBeGreaterThanOrEqual(44);
  await slot.evaluate(node=>{const animate=node.animate;window.__guidanceAnimations=[];node.animate=function(frames,options){window.__guidanceAnimations.push({frames,options});return Reflect.apply(animate,this,[frames,options]);};});
  await page.mouse.click(inline.hit.x,inline.hit.y);
  await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(detail).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__guidanceAnimations.length)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>window.__guidanceAnimations.at(-1).options)).toMatchObject({duration:260,easing:'cubic-bezier(.22,.72,.2,1)'});
  await settledMessage(page);const expanded=await measureSemanticGeometry(page);expect(expanded.slot.height).toBeGreaterThan(collapsed.slot.height);
  const adjacency=await page.evaluate(()=>{const button=document.querySelector('[data-board-message-action="toggle-board-explanation"]'),detail=document.querySelector('#board-guidance-detail'),preview=document.querySelector('#preview'),style=getComputedStyle(detail);const b=button.getBoundingClientRect(),d=detail.getBoundingClientRect(),p=preview.getBoundingClientRect();return{gap:d.top-b.bottom,margin:parseFloat(style.marginBlockStart),inside:d.left>=p.left&&d.right<=p.right,overflow:document.documentElement.scrollWidth>innerWidth};});
  expect(adjacency.inside).toBe(true);expect(adjacency.overflow).toBe(false);expect(adjacency.gap).toBeGreaterThanOrEqual(adjacency.margin-.5);expect(adjacency.gap).toBeLessThan(40);

  await toggle.focus();await expect(toggle).toBeFocused();
  await toggle.evaluate(button=>{button.click();button.click();button.click();});
  await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();
  await settledMessage(page);
  await toggle.evaluate(button=>{button.click();button.click();button.click();});
  await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(toggle).toBeFocused();await settledMessage(page);

  await page.setViewportSize({width:1200,height:1000});
  await page.evaluate(async()=>{document.documentElement.dir='rtl';document.documentElement.style.fontFamily='serif';await document.fonts.ready;});
  await settledMessage(page);await expect(detail).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const desktop=await measureSemanticGeometry(page);expect(desktop.slot.height).toBeGreaterThan(0);
  await page.emulateMedia({forcedColors:'active'});await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex');});await page.keyboard.press(browserName==='webkit'?'Alt+Tab':'Tab');await expect(toggle).toBeFocused();
  const forced=await page.evaluate(()=>{const button=document.activeElement,detail=document.querySelector('#board-guidance-detail'),slot=button.closest('.board-message-slot'),b=button.getBoundingClientRect(),s=slot.getBoundingClientRect(),style=getComputedStyle(button),ring=parseFloat(style.outlineWidth)+Math.max(0,parseFloat(style.outlineOffset));return{focused:button.matches('[data-board-message-action="toggle-board-explanation"]'),outline:style.outlineStyle,border:getComputedStyle(detail).borderTopStyle,fit:b.top-ring>=s.top&&b.bottom+ring<=s.bottom};});
  expect(forced).toMatchObject({focused:true,fit:true});expect(forced.outline).not.toBe('none');expect(forced.border).not.toBe('none');

  await page.emulateMedia({reducedMotion:'reduce',forcedColors:'none'});
  const animationCount=await page.evaluate(()=>window.__guidanceAnimations.length);
  await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');
  expect(await slot.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
  await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
  expect(await slot.evaluate(node=>node.getAnimations().filter(animation=>animation.playState==='running').length)).toBe(0);
  expect(await page.evaluate(()=>window.__guidanceAnimations.length)).toBe(animationCount);
  await settledMessage(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('joined-guidance-desktop-rtl-forced-reduced.png')});
});

test('named computer phases keep one colored cue and stable board position without a timer', async ({page}) => {
  await page.setViewportSize({width:390,height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(async () => {
    await window.boardFixture.setup('pass', false);
    const {computerBoardMessage} = await import('/apps/web/shell/computer-narration.js');
    window.phaseGame = {id:'phase-game',computer:{},computerTurn:'horus',board:{state:{sideToMove:'P2'}}};
    window.showPhase = status => {
      window.boardFixture.message(computerBoardMessage(window.phaseGame, status));
      window.updateComputerBoardLoading(document.querySelector('.board-message-activity'), window.phaseGame, status, {scope:'phase-owner'});
    };
    window.showPhase({phase:'checking',phaseElapsedMs:499});
  });
  await expect(page.locator('#preview')).toHaveText('Horus is thinking');
  await expect(page.locator('.board-message-activity')).toHaveAttribute('data-loading-phase', /visible|slow/);
  const before = await page.locator('#board').boundingBox();
  await page.evaluate(() => {
    window.savedCue = document.querySelector('.board-message-activity .loading-pieces');
    window.savedAnimation = window.savedCue.querySelector('i').getAnimations()[0];
    window.savedAnimation.pause();window.savedAnimation.currentTime=700;
    window.showPhase({phase:'checking',phaseElapsedMs:500});
  });
  await expect(page.locator('#preview')).toHaveText('Horus is thinking');
  await page.evaluate(() => window.showPhase({phase:'saving',phaseElapsedMs:500}));
  await expect(page.locator('#preview')).toHaveText('Horus is saving their move');
  expect(await page.evaluate(() => ({same:window.savedCue===document.querySelector('.board-message-activity .loading-pieces'),time:window.savedAnimation.currentTime,side:document.querySelector('.board-message-activity').dataset.activitySide}))).toEqual({same:true,time:700,side:'P2'});
  expect(await page.locator('#board').boundingBox()).toEqual(before);
  await page.evaluate(() => window.showPhase({phase:'preparing',detailed:true,elapsedMs:45000,phaseElapsedMs:45000}));
  await expect(page.locator('#preview')).toHaveText('Waiting for Horus');
  await expect(page.locator('#preview progress,#preview button')).toHaveCount(0);
});
