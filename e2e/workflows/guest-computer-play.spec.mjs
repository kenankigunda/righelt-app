import {assertReplayIntegrity} from '../support/replay-write-contract.mjs';
import {CURRENT_COMPUTER_MODEL} from '../../packages/shared-types/src/computer-play.ts';
import {readFile} from 'node:fs/promises';
import {isOperationRequest,operationValues} from "../support/shared-request.mjs";
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {test,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
import {submitPlayableAction,switchGamePanel,waitForLegacyIdentity} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';
import {waitForPlayableBoard} from '../../scripts/validation/browser-navigation.mjs';
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});

const assertFullBoardGeometry = async (page, info, phase) => {
  await expect(page.locator('#shell-board .cell')).toHaveCount(100);
  const geometry=await page.locator('#shell-board').evaluate(board=>{
    const bounds=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    const cells=[...board.querySelectorAll('.cell')];
    return {viewport:{width:document.documentElement.clientWidth,height:innerHeight},board:bounds(board),
      panel:bounds(board.closest('[data-shell-panel="board"]')),
      cells:cells.map(cell=>({row:cell.dataset.row,col:cell.dataset.col,...bounds(cell)}))};
  });
  const context=JSON.stringify({phase,geometry});
  expect(new Set(geometry.cells.map(cell=>`${cell.row}:${cell.col}`)).size,context).toBe(100);
  expect(geometry.board.left,context).toBeGreaterThanOrEqual(-1);
  expect(geometry.board.right,context).toBeLessThanOrEqual(geometry.viewport.width+1);
  expect(geometry.board.top,context).toBeGreaterThanOrEqual(-1);
  expect(geometry.board.bottom,context).toBeLessThanOrEqual(geometry.viewport.height+1);
  for(const cell of geometry.cells) {
    expect(cell.width,context).toBeGreaterThan(0);expect(cell.height,context).toBeGreaterThan(0);
    expect(cell.left,context).toBeGreaterThanOrEqual(Math.max(0,geometry.board.left,geometry.panel.left)-1);
    expect(cell.right,context).toBeLessThanOrEqual(Math.min(geometry.viewport.width,geometry.board.right,geometry.panel.right)+1);
    expect(cell.top,context).toBeGreaterThanOrEqual(Math.max(0,geometry.board.top,geometry.panel.top)-1);
    expect(cell.bottom,context).toBeLessThanOrEqual(Math.min(geometry.viewport.height,geometry.board.bottom,geometry.panel.bottom)+1);
  }
  await info.attach(`board-geometry-${phase}`,{contentType:'application/json',body:JSON.stringify(geometry)});
};

test('guest computer finishes a catalog position and prepares a fresh rematch',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  await waitForLegacyIdentity(page);
  const catalog=JSON.parse(await readFile(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
  const scenario=catalog.scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');
  expect(scenario).toBeTruthy();
  const request=(route,body)=>page.evaluate(async({route,body,header})=>{
    const bootstrap=await fetch('/api/shell/bootstrap');
    if(!bootstrap.ok)throw Error(`Bootstrap failed: ${bootstrap.status}`);
    const generation=bootstrap.headers.get(header);
    const identityId=localStorage.getItem('righelt.identity.id.v1');
    const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
    if(!response.ok)throw Error(`Guest fixture failed: ${response.status}`);
    return response.json();
  },{route,body,header:STORAGE_GENERATION_HEADER});
  const source=(await request('/api/shell/scenarios/import',{scenario})).game;
  const final=source.moves.at(-1);
  const game=(await request('/api/shell/history/branch',{sourceGameId:source.id,sourceDecisionId:final.moveId,creatorSide:'p2',computer:{p1:'babs',p2:null},computerModelId:CURRENT_COMPUTER_MODEL.id})).game;
  expect(game.board.state).toEqual(final.selectionSnapshot);
  expect(game.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  await page.goto(`/#/game/${game.id}`);
  await waitForComputerDecision(page,game.id,'babs',{guest:true,modelId:game.computer.modelId});
  await expect.poll(async()=>(await projected(page,game.id)).board.state.outcome.status).toBe('p1_win');
  const result=page.getByTestId('game-result');await expect(result).toBeVisible();
  await page.screenshot({path:info.outputPath('guest-computer-finished.png')});
  await result.getByRole('button',{name:'Play again',exact:true}).click();
  const chooser=page.getByRole('dialog',{name:'Play again',exact:true});
  await expect(chooser.getByRole('group',{name:'Opponent',exact:true}).getByRole('radio',{name:'Babs',exact:true})).toBeChecked();
  const creation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');
  await chooser.getByRole('button',{name:'Start game',exact:true}).click();
  const response=await creation;expect(response.status()).toBe(200);
  const fresh=(await response.json()).game;expect(fresh.id).not.toBe(game.id);
  expect(response.request().postDataJSON().computerModelId).toBe(CURRENT_COMPUTER_MODEL.id);expect(fresh.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  expect(fresh.computer.seats).toEqual({p1:null,p2:'babs'});
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',fresh.id);
});
for (const width of [320, 390, 430, 1440]) test.describe(`retained guest computer game at ${width}px`, () => {
  // Three distinct journeys share the actual browser, identity and accepted game.
  // Each keeps the configured 60-second budget. Failures skip dependent journeys.
  test.describe.configure({mode:'serial'});
  let owned, context, page, played, retained;
  test.beforeAll(async ({browser}, info) => {
    owned=ownedContexts(browser);
    const use=info.project.use;
    context=await owned.create({...use.contextOptions,baseURL:use.baseURL,
      viewport:{width,height:900},deviceScaleFactor:use.deviceScaleFactor,
      isMobile:use.isMobile,hasTouch:use.hasTouch,userAgent:use.userAgent});
    page=await context.newPage();
  });
  // Playwright records all live contexts per test, including this retained one.
  // The ownership helper closes even partially completed context creation.
  test.afterAll(async () => {await owned?.close();});
  test(`guest computer prepares and replays a real turn at ${width}px`, async ({}, info) => {
  await page.setViewportSize({width,height:900});
  await page.goto('/');
  expect((await (await page.request.get('/api/shell/bootstrap')).json()).accountsRequired).toBe(false);
  let creations=0; page.on('request',request=>{if(request.method()==='POST' && new URL(request.url()).pathname==='/api/shell/games')creations++;});
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  await waitForOpponentReady(page);
  await page.keyboard.press('Escape');
  expect(creations).toBe(0);
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Play Babs', exact: true }).click();
  const response = await creation;
  expect(response.ok()).toBe(true);
  const initial = (await response.json()).game;
  const identityId=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
  expect(identityId).toBeTruthy();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', initial.id);
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase', 'idle');
  await waitForPlayableBoard(page);
  await assertFullBoardGeometry(page,info,'initial');
  await page.evaluate(() => {
    window.boardStatusGeometry={running:true,samples:[]};
    const sample=()=>{const record=window.boardStatusGeometry;if(!record.running)return;const board=document.querySelector('#shell-board');if(board){const rect=board.getBoundingClientRect();record.samples.push({y:rect.top+scrollY,height:rect.height,message:document.querySelector('#shell-board-preview-label')?.textContent});}requestAnimationFrame(sample);};sample();
  });
  await waitForPlayableBoard(page);
  await submitPlayableAction(page, initial.legalActions.find(action => action.from && action.to));
  await expect.poll(async () => (await projected(page, initial.id)).moves.length).toBeGreaterThan(0);
  if ((await projected(page, initial.id)).canEndTurn) await page.locator('[data-board-preview-action="end-turn"]').click();
  await waitForComputerDecision(page, initial.id, 'babs', {guest:true,modelId:initial.computer.modelId});
  await expect(page.getByRole('button',{name:'Show me again',exact:true})).toBeVisible({timeout:30000});
  const geometry=await page.evaluate(()=>{window.boardStatusGeometry.running=false;return window.boardStatusGeometry.samples;});
  expect(geometry.length).toBeGreaterThan(2);
  const topValues=geometry.map(sample=>sample.y);
  expect(Math.max(...topValues)-Math.min(...topValues),JSON.stringify(geometry.filter((sample,index)=>index===0||sample.y!==geometry[index-1].y))).toBeLessThanOrEqual(1);
  const beforeReplay=await projected(page,initial.id);
  const writes=[];
  const observeReplay=request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.startsWith('/api/')){let body;try{body=request.postDataJSON();}catch{}writes.push({method:request.method(),path:new URL(request.url()).pathname,body});}};
  page.on('request',observeReplay);
  try {
    await page.getByRole('button',{name:'Show me again',exact:true}).click();
    await expect(page.locator('.computer-replay')).toBeVisible();
    await expect(page.getByRole('button',{name:'Stop replay',exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('computer-turn-replay.png')});
    // A short animated turn may finish during screenshot capture. Verify its
    // natural completion; the manual replay below exercises explicit Stop.
    await expect(page.locator('.computer-replay')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Show me again',exact:true})).toBeVisible();
    await assertReplayIntegrity({writes,before:beforeReplay,after:await projected(page,initial.id)});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:'Show me again',exact:true}).click();
    await expect(page.getByRole('button',{name:'Next',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Stop replay',exact:true}).click();
    await assertReplayIntegrity({writes,before:beforeReplay,after:await projected(page,initial.id)});
    await page.emulateMedia({reducedMotion:'no-preference'});
  } finally {page.off('request',observeReplay);}
  const saved = (await projected(page, initial.id)).moves.find(move=>move.computerProof);
  expect(initial.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  expect(saved.computerProof.modelId).toBe(initial.computer.modelId);
  // Serialized seed fields cannot be mutated by either later journey.
  played=Object.freeze({initialJSON:JSON.stringify(initial),savedJSON:JSON.stringify(saved),identityId});
  });

  test(`the same guest computer game survives reload and undo at ${width}px`, async ({}, info) => {
  expect(played).toBeTruthy();
  const initial=JSON.parse(played.initialJSON),saved=JSON.parse(played.savedJSON),{identityId}=played;
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',initial.id);
  expect(await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'))).toBe(identityId);
  await page.reload();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',initial.id);
  await expect.poll(async()=> (await projected(page,initial.id)).moves.some(move=>move.moveId===saved.moveId)).toBe(true);
  await expect(page.getByTestId('account-dialog')).not.toBeVisible();
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const continueHere=page.getByRole('button',{name:'Continue play',exact:true});
  if(await continueHere.isVisible()) {
    const switched=page.waitForRequest(r=>isOperationRequest(r,'computer-control') && operationValues(r)?.action==='switch');
    await continueHere.click();const request=await switched;
    await expect.poll(async()=> (await projected(page,initial.id)).computer.lease?.deviceId).toBe(operationValues(request).deviceId);
  }
  const controls = [];
  const observe = request => {
    if (isOperationRequest(request,'computer-control')) controls.push({action:operationValues(request).action,envelope:request.postDataJSON()});
  };
  page.on('request', observe);
  try {
    await switchGamePanel(page, "history");
    const firstMove=(await projected(page,initial.id)).moves.find(move=>!move.undone);
    expect(firstMove?.moveId).toBeTruthy();
    const row=page.locator(`[data-testid="history-move-item"][data-move-id="${firstMove.moveId}"]`);
    await row.locator('.history-item-info').click();
    await row.getByRole('button',{name:'Undo before this move',exact:true}).click();
    await expect.poll(async () => {
      const game = await projected(page, initial.id);
      return { activeMoves: game.moves.filter(move => !move.undone).length, paused: game.computer.paused, state: game.board.state };
    }).toEqual({ activeMoves: 0, paused: false, state: initial.board.state });
    await switchGamePanel(page, "board");
    await expect(page.locator('[data-computer-status]')).toBeHidden();
    await expect(page.locator('#shell-board-preview-label')).toContainText('Select a piece');
    await expect(page.locator('#shell-board .move-ghost')).toHaveCount(0);
    await assertFullBoardGeometry(page,info,'after-undo');
    const resumes=controls.filter(control=>control.action==='resume');
    expect(new Set(resumes.map(control=>control.envelope.clientCommandId)).size).toBe(1);
    const envelope=resumes[0].envelope;
    expect(envelope.kind).toBe('shared');
    const receipt=await (await page.request.post(`/api/shell/games/${initial.id}/reconcile`,{data:{protocolVersion:2,identityId:envelope.identityId,knownSnapshotEventSeq:0,commands:[envelope]}})).json();
    expect(receipt.commandOutcomes[0]).toMatchObject({outcome:'accepted',clientCommandId:envelope.clientCommandId,fingerprint:envelope.fingerprint});
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: info.outputPath('computer-undo-resumed.png') });
    expect(saved.computerProof.attemptId).toBeTruthy();
    retained=Object.freeze({gameId:initial.id,identityId,modelId:saved.computerProof.modelId,
      moveId:saved.moveId,attemptId:saved.computerProof.attemptId,
      action:Object.freeze(structuredClone(saved.action)),proof:Object.freeze(structuredClone(saved.computerProof))});
    await info.attach('undo-controls', { contentType: 'application/json', body: JSON.stringify(controls) });
  } finally { page.off('request', observe); }
  });

  test(`export preserves the same undone computer game and accepted attempt at ${width}px`, async () => {
    expect(retained).toBeTruthy();
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',retained.gameId);
    expect(await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'))).toBe(retained.identityId);
    const game=await projected(page,retained.gameId);
    expect(game.id).toBe(retained.gameId);expect(game.computer.modelId).toBe(retained.modelId);
    expect(game.moves.filter(move=>!move.undone)).toHaveLength(0);
    const original=game.moves.find(move=>move.moveId===retained.moveId);
    expect(original?.undone).toBe(true);expect(original?.computerProof).toEqual(retained.proof);
    const navigation=page.getByRole('button',{name:'Open navigation menu',exact:true});
    if(await navigation.isVisible())await navigation.click();
    await page.getByRole('button',{name:'Debug',exact:true}).click();
    const raw=page.locator('[data-debug-section="raw"]');
    await raw.locator('summary').click();
    const downloaded=page.waitForEvent('download');
    await raw.getByRole('button',{name:'Export game evidence and my notes'}).click();
    const exported=JSON.parse(await readFile(await (await downloaded).path(),'utf8'));
    expect(exported.gameId).toBe(retained.gameId);
    expect(exported.notes).toEqual([]);expect(exported.analyses).toEqual([]);expect(exported.attempts.length).toBeGreaterThan(0);
    const entry=exported.entries.find(item=>item.kind==='decision'&&item.id===retained.moveId);
    expect(entry?.move.computerProof).toEqual(retained.proof);expect(entry?.move.action).toEqual(retained.action);
    const attempt=exported.attempts.find(item=>item.attemptId===retained.attemptId);
    expect(attempt?.attempt.proof).toEqual(retained.proof);
    expect(attempt?.attempt.result).toMatchObject({status:'ready',action:retained.action});
  });
});
