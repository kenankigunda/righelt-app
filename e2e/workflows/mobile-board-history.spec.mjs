import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createGameFromHome,makeAnyLegalMove,openDirectGameLink,requestPlayerJoin,acceptPendingRequest} from '../support/app.mjs';
import {isOperationRequest} from '../support/shared-request.mjs';
import {panelGeometrySettledAcrossFrame} from '../support/panel-settlement.mjs';


const expectAcceptedShared = async(page,gameId,request)=>{
  const envelope=request.postDataJSON();expect(envelope.kind).toBe('shared');
  const headers=Object.fromEntries(Object.entries(request.headers()).filter(([name])=>name.startsWith('x-righelt-')));
  await expect.poll(()=>page.evaluate(async({gameId,envelope,headers})=>{
    const response=await fetch(`/api/shell/games/${gameId}/reconcile`,{method:'POST',headers:{...headers,'content-type':'application/json'},
      body:JSON.stringify({protocolVersion:2,identityId:envelope.identityId,knownSnapshotEventSeq:0,commands:[envelope]})});
    if(!response.ok)throw Error(`Receipt lookup failed HTTP ${response.status}`);
    return (await response.json()).commandOutcomes?.find(outcome=>outcome.clientCommandId===envelope.clientCommandId);
  },{gameId,envelope,headers})).toMatchObject({outcome:'accepted',clientCommandId:envelope.clientCommandId,fingerprint:envelope.fingerprint});
};

const board = page => page.getByTestId('game-board');
const tab = (page,key) => page.locator(`[data-action="switch-game-panel"][data-panel="${key}"]`);
const panel = (page,key) => page.locator(`[data-mobile-panel="${key}"]`);
const switchPanel = async(page,key)=>{
  const currentPanel=page.locator('[data-mobile-panel][data-active="true"]');
  await expect.poll(()=>currentPanel.evaluate(panelGeometrySettledAcrossFrame),{message:'Current panel scroll and layout must settle before deciding whether navigation needs revealing'}).toBe(true);
  const controls=page.locator('[data-mobile-nav-controls]');
  if(await controls.getAttribute('inert')!==null)await page.getByRole('button',{name:'Show game navigation',exact:true}).click();
  await tab(page,key).click();
  await expect(tab(page,key)).toHaveAttribute('aria-pressed','true');
  await expect(panel(page,key)).not.toHaveAttribute('inert','');
  await expect.poll(()=>panel(page,key).evaluate(el=>el.closest('.game-shell-track').getAnimations().some(animation=>animation.playState==='running'||animation.pending)),{message:'Panel transition must be finished'}).toBe(false);
  await expect.poll(()=>panel(page,key).evaluate(el=>Math.abs(el.getBoundingClientRect().left-el.closest('.game-shell-track-wrap').getBoundingClientRect().left)),{message:'Panel must finish its horizontal transition before interacting or measuring'}).toBeLessThanOrEqual(1);
  await expect.poll(()=>panel(page,key).evaluate(panelGeometrySettledAcrossFrame),{message:'Panel endpoint and geometry must be committed across a rendered frame'}).toBe(true);
};
const readGame = async(page,id)=>page.evaluate(async id=>{
  const identityId=localStorage.getItem('righelt.identity.id.v1');
  const response=await fetch(`/api/shell/games/${encodeURIComponent(id)}?identityId=${encodeURIComponent(identityId)}`);
  const body=await response.json();if(!response.ok||!body.game)throw Error(`Read game failed HTTP ${response.status}`);return body.game;
},id);
const expectedPieces = snapshot => snapshot.pieces.map(piece=>({row:piece.position.row,col:piece.position.col,owner:piece.owner,kind:piece.kind})).sort((a,b)=>a.row-b.row||a.col-b.col||a.owner.localeCompare(b.owner)||a.kind.localeCompare(b.kind));
const renderedPieces = locator => locator.locator('.cell').evaluateAll(cells=>cells.flatMap(cell=>[...cell.querySelectorAll('.piece-token:not(.move-ghost):not(.removal-piece):not(.history-destruction-piece)')].map(piece=>({row:Number(cell.dataset.row),col:Number(cell.dataset.col),owner:piece.classList.contains('p1')?'P1':'P2',kind:piece.classList.contains('commander')?'commander':'unit'}))).sort((a,b)=>a.row-b.row||a.col-b.col||a.owner.localeCompare(b.owner)||a.kind.localeCompare(b.kind)));
const documentGeometry = locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
// Passive observations only: these reads do not alter layout, fonts or gates.
const coldBoardLayoutReceipt=page=>page.evaluate(()=>{
 const inspect=node=>{
  if(!node)return null;const style=getComputedStyle(node),r=node.getBoundingClientRect();
  return {tag:node.tagName,className:node.className,id:node.id,rect:r.toJSON(),documentRect:{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height},clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,
   style:Object.fromEntries(['display','position','boxSizing','width','minWidth','maxWidth','height','paddingLeft','paddingRight','marginLeft','marginRight','overflow','overflowX','overflowY','gridTemplateColumns','gridTemplateRows','gap','alignItems','justifyItems','transform','fontFamily','fontSize','fontWeight','lineHeight'].map(key=>[key,style[key]])),
   variables:Object.fromEntries(['--desktop-board-side','--shell-game-panel-index','--shell-mobile-panel-transition','--board-cell-size','--board-gap','--stone-outline'].map(key=>[key,style.getPropertyValue(key)])),
  };
 };
 const one=selector=>inspect(document.querySelector(selector));
 const panel=document.querySelector('[data-shell-panel="board"]'),board=panel?.querySelector('.board');
 return {at:performance.now(),route:location.hash,layoutMode:document.querySelector('#app')?.dataset.shellLayoutMode,
  viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,visual:visualViewport?{width:visualViewport.width,height:visualViewport.height,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop,scale:visualViewport.scale}:null},
  document:inspect(document.documentElement),body:inspect(document.body),app:one('#app'),track:one('.game-shell-track'),trackWrap:one('.game-shell-track-wrap'),mobilePanel:inspect(panel?.closest('[data-mobile-panel]')),
  panel:inspect(panel),board:inspect(board),wrap:inspect(board?.closest('.board-wrap')),headingSlot:one('[data-shell-panel="board"] .board-heading-slot'),heading:one('[data-shell-panel="board"] .board-heading:not([aria-hidden])'),messageSlot:one('[data-shell-panel="board"] .board-message-slot'),message:one('#shell-board-preview-label'),legend:one('[data-shell-panel="board"] .overlay-key'),
  axes:[...panel?.querySelectorAll('.axis-label')??[]].slice(0,24).map(inspect),legendItems:[...panel?.querySelectorAll('.overlay-key > *')??[]].slice(0,8).map(inspect),cells:board?[inspect(board.querySelector('.cell')),inspect(board.querySelector('.cell:last-child'))]:[],
  fonts:{status:document.fonts.status,faces:[...document.fonts].map(font=>({family:font.family,status:font.status,weight:font.weight,style:font.style}))},
 };
});
const expectNoHorizontalOverflow=page=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
const selfPlay=async(page)=>{
  const game=await createGameFromHome(page);
  if(await page.locator('#app').getAttribute('data-shell-layout-mode')==='narrow')await switchPanel(page,'players');
  await page.getByRole('button',{name:'Play both sides',exact:true}).click();
  await expect(page.getByTestId('game-role')).toContainText('both players');
  if(await page.locator('#app').getAttribute('data-shell-layout-mode')==='narrow')await switchPanel(page,'board');
  return game;
};

// Actual touch capability matters for focus-visible, tap confirmation, and idle hiding.
test.describe('narrow board and history',()=>{
  test.use({viewport:{width:390,height:640},hasTouch:true});

  test('compact header and lightweight navigation leave one document scroller',async({page},info)=>{
    await createGameFromHome(page);
    const header=page.locator('.shell-header');
    expect((await header.boundingBox()).height).toBeLessThanOrEqual(72);
    expect(await header.locator('[data-action="account-open"]').evaluate(el=>Boolean(el.closest('[data-header-menu-panel]')))).toBe(true);
    await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
    await expect(header.getByRole('button',{name:'Account',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close navigation menu',exact:true}).click();
    await expect(panel(page,'board')).toHaveAttribute('data-active','true');
    for(const key of ['players','history'])await expect(panel(page,key)).toHaveAttribute('inert','');
    const scrollable=await page.evaluate(()=>[...document.querySelectorAll('[data-mobile-panel],.game-shell-track-wrap,.game-shell-frame')].filter(el=>['scroll','auto'].includes(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1).map(el=>el.className));
    expect(scrollable).toEqual([]);
    await expectNoHorizontalOverflow(page);
    const bar=page.locator('.shell-mobile-tabbar');
    await expect(bar).toHaveAttribute('data-visible','false',{timeout:5000});
    await expect(page.locator('[data-mobile-nav-controls]')).toHaveAttribute('inert','');
    await page.getByRole('button',{name:'Show game navigation',exact:true}).tap();
    await expect(bar).toHaveAttribute('data-visible','true');
    // Mobile WebKit has no wheel automation. Move the real document scroller
    // and observe its native scroll events rather than calling navigation code.
    await page.evaluate(()=>window.scrollBy(0,100));
    await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(24);
    await expect(bar).toHaveAttribute('data-visible','false');
    await page.evaluate(()=>window.scrollBy(0,-60));
    await expect(bar).toHaveAttribute('data-visible','true');
    await page.screenshot({path:info.outputPath('mobile-board-chrome.png')});
  });

  test('Pass, inline after-state history, and returning to Board preserve live truth',async({page},info)=>{
    const {gameId}=await selfPlay(page);
    const before=await documentGeometry(board(page));
    const passRequest=page.waitForRequest(request=>isOperationRequest(request,'apply'));
    await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).tap();
    const pass=await passRequest;expect(pass.postDataJSON().payload.action.type).toBe('pass');
    await expect(page.getByTestId('history-move-item')).toHaveCount(1);
    const firstGame=await readGame(page,gameId),firstMove=firstGame.moves[0];
    expect(firstMove.action.type).toBe('pass');
    expect(await documentGeometry(board(page))).toEqual(before);
    await switchPanel(page,'history');
    const selected=page.locator(`[data-testid="history-move-item"][data-move-id="${firstMove.moveId}"]`);
    await selected.click();
    const preview=selected.getByTestId('history-inline-preview');
    await expect(preview.locator('.cell')).toHaveCount(100);
    await expect.poll(()=>renderedPieces(preview)).toEqual(expectedPieces(firstMove.snapshot));
    const positions=await selected.evaluate(el=>{
      const date=el.querySelector('.history-move-at').getBoundingClientRect(),preview=el.querySelector('.history-inline-preview').getBoundingClientRect(),actions=el.querySelector('.history-item-actions').getBoundingClientRect();
      return{dateBottom:date.bottom,previewTop:preview.top,previewBottom:preview.bottom,actionsTop:actions.top};
    });
    expect(positions.previewTop).toBeGreaterThanOrEqual(positions.dateBottom-1);expect(positions.actionsTop).toBeGreaterThanOrEqual(positions.previewBottom-1);
    await expect(page.locator('[data-game-panel="history"] [data-action="revert-to-move"]')).toHaveCount(1);
    await expect(page.locator('[data-game-panel="history"] [data-action="launch-history-branch"]')).toHaveCount(1);
    const other=await page.context().newPage();
    try{
      await other.goto(page.url().replace(/([?&])panel=history/,'$1panel=board'));
      await expect(other.getByTestId('game-shell')).toBeVisible();
      await makeAnyLegalMove(other,'p2');
      await expect.poll(async()=>(await readGame(other,gameId)).moves.length,{message:'The second move must be acknowledged before capturing live truth'}).toBe(2);
      const live=await readGame(other,gameId);
      await expect(page.getByTestId('history-move-item')).toHaveCount(2);
      await expect.poll(()=>renderedPieces(board(page))).toEqual(expectedPieces(live.board.state));
      await expect.poll(()=>renderedPieces(preview)).toEqual(expectedPieces(firstMove.snapshot));
      expect(expectedPieces(live.board.state)).not.toEqual(expectedPieces(firstMove.snapshot));
      await page.screenshot({path:info.outputPath('mobile-inline-history.png')});
      await page.getByTestId('history-return-live').tap();
      await expect(tab(page,'board')).toHaveAttribute('aria-pressed','true');
      await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);
      await expect.poll(()=>renderedPieces(board(page))).toEqual(expectedPieces(live.board.state));
      await switchPanel(page,'history');
      const changedMove=live.moves.at(-1),changedRow=page.locator(`[data-testid="history-move-item"][data-move-id="${changedMove.moveId}"]`);
      await changedRow.click();
      const changedPreview=changedRow.getByTestId('history-inline-preview');
      await expect.poll(()=>renderedPieces(changedPreview)).toEqual(expectedPieces(changedMove.snapshot));
      expect(expectedPieces(changedMove.snapshot)).not.toEqual(expectedPieces(changedMove.selectionSnapshot));
      await expect(changedRow).not.toHaveAttribute('data-action');
      expect(await changedRow.evaluate(el=>getComputedStyle(el).cursor)).toBe('default');
      await expect(changedRow.getByRole('button',{name:'Undo before this move',exact:true})).toBeEnabled();
      if(changedMove.action.from && changedMove.action.to){
        await expect(changedPreview.locator('.cell.source')).toHaveCount(1);
        await expect(changedPreview.locator('.cell.target')).toHaveCount(1);
        expect(await changedPreview.locator('.cell.source').evaluate(el=>getComputedStyle(el).borderColor)).toBe('rgb(118, 80, 166)');
        expect(await changedPreview.locator('.cell.target').evaluate(el=>getComputedStyle(el).borderColor)).toBe('rgb(31, 122, 90)');
      }
      await expect.poll(()=>changedRow.evaluate(el=>el.getBoundingClientRect().top>=0 && el.querySelector('.history-inline-preview').getBoundingClientRect().bottom<=innerHeight)).toBe(true);
      await page.screenshot({path:info.outputPath('mobile-selected-move-history.png')});
      const turnHeading=changedRow.locator('xpath=ancestor::li[contains(@class,"history-turn")]/div[contains(@class,"history-turn-heading")]');
      await turnHeading.locator('..').locator(':scope > .history-turn-hit').click();
      await expect(turnHeading).toHaveAttribute('aria-current','true');
      await expect(turnHeading).not.toHaveAttribute('data-action');
      const aggregate=turnHeading.locator('..').getByTestId('history-inline-preview');
      await expect(aggregate.locator('.cell')).toHaveCount(100);
      await expect(aggregate.locator('.cell.source,.cell.target,.axis-strong,.axis-medium')).toHaveCount(0);
      await page.screenshot({path:info.outputPath('mobile-whole-turn-history.png')});
      await expect(page.locator('[data-game-panel="history"] [data-action="revert-to-move"]')).toHaveCount(0);
      await changedRow.click();
      await expect(changedRow).toHaveAttribute('aria-current','true');

      await switchPanel(page,'players');await switchPanel(page,'history');await expect(changedPreview).toBeVisible();
      await switchPanel(page,'board');await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    }finally{await other.close();}
  });

  test('an accepted self-play undo returns its unchanged requester to live Board',async({page})=>{
    const {gameId}=await selfPlay(page);await makeAnyLegalMove(page);
    const game=await readGame(page,gameId),first=game.moves[0];
    await switchPanel(page,'history');await page.locator(`[data-move-id="${first.moveId}"][data-testid="history-move-item"]`).click();
    await expect(page.getByTestId('history-inline-preview')).toBeVisible();
    const request=page.waitForRequest(r=>isOperationRequest(r,'revert-request'));
    await page.getByRole('button',{name:'Undo before this move',exact:true}).tap();
    await expectAcceptedShared(page,gameId,await request);
    await expect(tab(page,'board')).toHaveAttribute('aria-pressed','true');
    await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);
    const live=await readGame(page,gameId);await expect.poll(()=>renderedPieces(board(page))).toEqual(expectedPieces(live.board.state));
  });

  test('friend undo preserves a deliberately selected surviving move while approval is pending',async({page,browser,baseURL})=>{
    const {gameId,gameHash}=await createGameFromHome(page);
    const guestContext=await browser.newContext({baseURL,viewport:{width:390,height:640},hasTouch:true});
    const guest=await guestContext.newPage();
    let release;const held=new Promise(resolve=>{release=resolve;});
    let approvalSeen=false;
    try{
      await openDirectGameLink(guest,baseURL,gameHash);await requestPlayerJoin(guest);await acceptPendingRequest(page);
      await expect(guest.getByTestId('game-role')).toContainText('Player 2');
      await makeAnyLegalMove(page);await makeAnyLegalMove(guest,'p2');await makeAnyLegalMove(page);
      const game=await readGame(page,gameId),first=game.moves[0],second=game.moves[1],third=game.moves[2];
      expect(third).toBeTruthy();
      await switchPanel(page,'history');
      const firstRow=page.locator(`[data-testid="history-move-item"][data-move-id="${first.moveId}"]`);
      const secondRow=page.locator(`[data-testid="history-move-item"][data-move-id="${second.moveId}"]`);
      const thirdRow=page.locator(`[data-testid="history-move-item"][data-move-id="${third.moveId}"]`);
      await thirdRow.click();await expect(thirdRow.getByTestId('history-inline-preview')).toBeVisible();
      await page.getByRole('button',{name:'Undo before this move',exact:true}).tap();
      await expect(page.getByTestId('undo-waiting-notice')).toBeVisible();
      await expect(guest.getByTestId('undo-approval-notice')).toBeVisible();
      await firstRow.click();await secondRow.click();await firstRow.click();await expect(firstRow).toHaveClass(/is-selected/);
      await guestContext.route(/\/(shared|revert-approve)$/,async route=>{
        if(!isOperationRequest(route.request(),'revert-approve'))return route.continue();
        approvalSeen=true;await held;await route.continue();
      });
      const approval=guest.waitForRequest(request=>isOperationRequest(request,'revert-approve'));
      await guest.getByTestId('undo-approval-notice').getByRole('button',{name:'Accept',exact:true}).click();
      await expect.poll(()=>approvalSeen).toBe(true);
      await expect(firstRow).toHaveClass(/is-selected/);
      expect((await readGame(page,gameId)).pendingRevertRequest).toBeTruthy();
      release();await expectAcceptedShared(guest,gameId,await approval);
      await expect(page.getByTestId('undo-waiting-notice')).toHaveCount(0);
      await expect(tab(page,'history')).toHaveAttribute('aria-pressed','true');
      await expect(firstRow).toHaveClass(/is-selected/);
      await expect(firstRow.getByTestId('history-inline-preview')).toBeVisible();
      await expect.poll(()=>renderedPieces(firstRow.getByTestId('history-inline-preview'))).toEqual(expectedPieces(first.snapshot));
      await page.getByTestId('history-return-live').tap();
      await expect(tab(page,'board')).toHaveAttribute('aria-pressed','true');
      const live=await readGame(page,gameId);await expect.poll(()=>renderedPieces(board(page))).toEqual(expectedPieces(live.board.state));
    }finally{release?.();await guestContext.unrouteAll({behavior:'wait'});await guestContext.close();}
  });

  test('responsive boundaries and large text keep one scroller without horizontal overflow',async({page})=>{
    await selfPlay(page);
    for(const viewport of [{width:320,height:740},{width:430,height:740},{width:844,height:390},{width:930,height:740},{width:932,height:740}]){
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      await expect(board(page)).toBeVisible();
      expect(await page.evaluate(()=>[...document.querySelectorAll('[data-mobile-panel],.game-shell-track-wrap,.game-shell-frame')].filter(el=>['scroll','auto'].includes(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+1).length)).toBe(0);
    }
    await page.setViewportSize({width:390,height:740});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    await expectNoHorizontalOverflow(page);
    await expect(board(page)).toBeVisible();
    expect(await page.locator('.shell-header').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  });

  for(const {width,textScale} of [{width:390,textScale:100},{width:1440,textScale:100},{width:320,textScale:200},{width:390,textScale:200}])test(`cold game loading reserves the settled board geometry at ${width}px and ${textScale}% text`,async({page,context},info)=>{
    await page.setViewportSize({width,height:740});
    const {gameId}=await selfPlay(page);
    await page.addInitScript(scale=>document.addEventListener('DOMContentLoaded',()=>{
      document.documentElement.style.fontSize=`${scale}%`;
      window.coldBoardFrames=[];window.recordColdBoard=true;
      const sample=()=>{if(!window.recordColdBoard)return;const panel=document.querySelector('[data-shell-panel="board"]');if(panel&&panel.getBoundingClientRect().width>0)window.coldBoardFrames.push({canonical:Boolean(panel.closest('[data-game-shell-root]'))});requestAnimationFrame(sample);};sample();
    },{once:true}),textScale);
    let release;const held=new Promise(resolve=>{release=resolve;});
    // Either snapshot GET or durable reconciliation can win hydration. Hold
    // both real responses so every browser observes the same cold boundary.
    await context.route(new RegExp(`/api/shell/games/${gameId}(?:\\?|$|/reconcile(?:\\?|$))`),async route=>{
      const request=route.request();
      if(request.method()==='GET'||new URL(request.url()).pathname.endsWith('/reconcile'))await held;
      await route.continue();
    });
    let snapshots=0;let closing=false;
    await page.routeWebSocket(new RegExp(`/api/shell/games/${gameId}/ws`),socket=>{const server=socket.connectToServer();server.onMessage(async message=>{snapshots++;await held;if(!closing)socket.send(message);});});
    try{
      await page.reload({waitUntil:'domcontentloaded'});
      await expect(page.getByTestId('game-loading-shell')).toBeVisible();
      const silhouette=page.locator('.loading-board-silhouette');await expect(silhouette).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      const loading=await documentGeometry(silhouette);
      const loadingHeading=await documentGeometry(page.locator('[data-shell-panel="board"] .board-heading:not([aria-hidden])'));
      const loadingReceipt=await coldBoardLayoutReceipt(page);
      const loadingReceiptPath=info.outputPath('cold-board-loading-layout.json');
      await writeFile(loadingReceiptPath,JSON.stringify({width,textScale,loading,loadingHeading,layout:loadingReceipt},null,2));
      await info.attach('cold-board-loading-layout',{path:loadingReceiptPath,contentType:'application/json'});
      await page.screenshot({path:info.outputPath('mobile-board-loading.png')});
      release();
      await expect(board(page).locator('.cell')).toHaveCount(100);
      await expect(page.locator('[data-shell-panel="board"]')).toHaveAttribute('data-turn-side','red');
      await expect(page.locator('[data-shell-panel="board"]').getByRole('heading')).toHaveCount(1);
      await expect(page.getByTestId('game-shell')).toBeVisible();
      await expect(page.locator('[data-shell-panel="board"] .board-heading:not([aria-hidden])')).toBeVisible();
      const {loaded,loadedHeading,frames}=await page.getByTestId('game-shell').evaluate(shell=>{
        const geometry=element=>{const b=element.getBoundingClientRect();return{x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height};};
        window.recordColdBoard=false;
        return{loaded:geometry(shell.querySelector('[data-testid="game-board"]')),loadedHeading:geometry(shell.querySelector('.board-heading:not([aria-hidden])')),frames:window.coldBoardFrames};
      });
      const loadedReceipt=await coldBoardLayoutReceipt(page);
      const loadedReceiptPath=info.outputPath('cold-board-loaded-layout.json');
      await writeFile(loadedReceiptPath,JSON.stringify({width,textScale,loading,loaded,loadingHeading,loadedHeading,frames,loadingLayout:loadingReceipt,loadedLayout:loadedReceipt},null,2));
      await info.attach('cold-board-loaded-layout',{path:loadedReceiptPath,contentType:'application/json'});
      expect(frames.length).toBeGreaterThan(1);
      expect(frames.every(frame=>frame.canonical),'Every painted loading/live board uses the canonical shell').toBe(true);
      console.log('[cold-board-geometry]',JSON.stringify({width,textScale,loading,loaded,loadingHeading,loadedHeading}));
      for(const key of ['x','y','width','height']){
        expect(Math.abs(loaded[key]-loading[key]),`board ${key} should match its loading frame`).toBeLessThanOrEqual(1);
        expect(Math.abs(loadedHeading[key]-loadingHeading[key]),`heading ${key} should match its loading frame`).toBeLessThanOrEqual(1);
      }
      await expectNoHorizontalOverflow(page);
    }finally{closing=true;release();await context.unrouteAll({behavior:'wait'});}
  });
});

test('wide history retains its main-board snapshot without duplicate top actions',async({page})=>{
  await page.setViewportSize({width:1440,height:1100});const {gameId}=await selfPlay(page);
  await makeAnyLegalMove(page);const game=await readGame(page,gameId),first=game.moves[0];
  await page.locator(`[data-testid="history-move-item"][data-move-id="${first.moveId}"]`).click();
  await expect(page.getByTestId('history-inline-preview')).toHaveCount(0);
  await expect.poll(()=>renderedPieces(board(page))).toEqual(expectedPieces(first.snapshot));
  await expect(page.locator('[data-game-panel="history"] [data-action="revert-to-move"]')).toHaveCount(1);
  await expect(page.locator('[data-game-panel="history"] [data-action="launch-history-branch"]')).toHaveCount(1);
  await page.getByTestId('history-return-live').click();await expect.poll(()=>renderedPieces(board(page))).toEqual(expectedPieces((await readGame(page,gameId)).board.state));
});

test.describe('short landscape history',()=>{
 test.use({viewport:{width:640,height:320},hasTouch:true});
 test('selected move and turn fit their heading and full mini-board above navigation',async({page},info)=>{
  await selfPlay(page);await makeAnyLegalMove(page);await switchPanel(page,'history');
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  const move=page.getByTestId('history-move-item').first();await move.click();
  await expect(move).toHaveAttribute('aria-current','true');
  await expect(move.getByTestId('history-inline-preview').locator('.cell')).toHaveCount(100);
  await expect.poll(()=>move.locator('.history-move-at').evaluate(el=>el.clientHeight>=el.scrollHeight-1)).toBe(true);
  const fits=locator=>locator.evaluate(el=>{
   const preview=el.matches('.history-turn-heading')?el.nextElementSibling:el.querySelector('.history-inline-preview');
   if(!preview)return false;
   const p=preview.getBoundingClientRect(),heading=el.getBoundingClientRect(),nav=document.querySelector('.shell-mobile-tabbar').getBoundingClientRect();
   return heading.top>=0 && p.bottom<=Math.min(innerHeight,nav.top)+1;
  });
  await expect.poll(()=>fits(move)).toBe(true);
  expect(await move.locator('.history-inline-preview').evaluate(el=>Number(el.style.zoom))).toBeLessThan(1);
  await page.screenshot({path:info.outputPath('short-landscape-selected-move.png')});
  const heading=move.locator('xpath=ancestor::li[contains(@class,"history-turn")]/div[contains(@class,"history-turn-heading")]');
  await heading.locator('..').locator(':scope > .history-turn-hit').click();await expect(heading).toHaveAttribute('aria-current','true');
  await expect.poll(()=>fits(heading)).toBe(true);
  await page.screenshot({path:info.outputPath('short-landscape-selected-turn.png')});
 });
});
