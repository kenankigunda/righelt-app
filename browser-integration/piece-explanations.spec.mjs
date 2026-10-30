import {test, expect} from '@playwright/test';

for (const width of [320, 390]) test(`selection explanations stay in the message at ${width}px with enlarged text`, async ({page}, info) => {
  await page.setViewportSize({width, height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(async () => {
    await window.boardFixture.setup('rush', false);
    document.documentElement.style.fontSize = '200%';
    await document.fonts.ready;
  });
  const top = () => page.locator('#board').evaluate(node => node.getBoundingClientRect().top);
  const before = await top();
  const configure = async (kind, interactive = true) => page.evaluate(async ({kind, interactive}) => {
    const piece = {id:'A',owner:'P1',kind:'unit',position:{row:4,col:2},supplied:true,commanded:true};
    const state = {boardSize:10,sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'},pieces:[piece],continuation:null};
    if (kind === 'inactive') piece.commanded = false;
    if (kind.startsWith('frozen')) {
      piece.displayCommanded = false;
      state.continuation = {type:'rush',rushedPieceIds:[],frozenPieceStatesById:{A:{supplied:true,commanded:false}}};
    }
    if(kind==='frozen-blocker'){state.continuation.frozenPieceStatesById.A.supplied=false;state.pieces.push({id:'B',owner:'P1',kind:'unit',position:{row:9,col:9},supplied:false,commanded:true},...[[8,9],[9,8]].map(([row,col],index)=>({id:`wall-${index}`,owner:'P2',kind:'unit',position:{row,col},supplied:true,commanded:true})));Object.assign(state.continuation,{owner:'P1',rushChainPieceIds:['B'],rushedPieceIds:['B']});}
    await window.boardFixture.configure(state, kind === 'frozen' ? [{type:'end_turn'}] : [], {
      interactive, selectionState:{selectedPieceId:'A',source:{row:4,col:2},target:null},
    });
  }, {kind, interactive});
  await configure('inactive');
  await expect(page.locator('#preview')).toContainText('Inactive: no command connection');
  expect(await top()).toBeCloseTo(before, 1);
  expect(await page.locator('.cell.selected-piece').evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  await page.screenshot({path:info.outputPath(`inactive-${width}-200.png`)});
  await configure('frozen');
  await expect(page.locator('#preview')).toContainText('Cannot move: no command at start of rush');
  await expect(page.locator('#preview button')).toHaveText('End turn');
  expect(await top()).toBeCloseTo(before, 1);
  await configure('frozen-blocker');
  await expect(page.locator('#preview')).toContainText('Cannot move: no command or supply at start of rush');
  await expect(page.locator('#preview')).toContainText('Reconnect piece at 9, 9');
  await expect(page.locator('#preview button')).toHaveCount(0);
  expect(await top()).toBeCloseTo(before,1);
  await configure('frozen', false);
  await expect(page.locator('#preview')).toContainText('Cannot move');
  await expect(page.locator('#preview button')).toHaveCount(0);
  await page.evaluate(() => window.boardFixture.inspect({kind:'command',pieceId:'A'}));
  await expect(page.locator('#preview')).toContainText('Cannot move: no command at start of rush');
  await expect(page.locator('.board-event-label')).toHaveCount(0);
  expect(await top()).toBeCloseTo(before, 1);
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
  await expect(page.locator('#preview')).toContainText('Destination would have no supply');
  await expect(page.locator('#preview button')).toHaveCount(0);
  expect(await page.locator('.cell.target').evaluate(node => getComputedStyle(node,'::after').content)).toBe('none');
  expect(await top()).toBeCloseTo(before, 1);
  await page.screenshot({path:info.outputPath(`blocked-target-${width}-200.png`)});
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
