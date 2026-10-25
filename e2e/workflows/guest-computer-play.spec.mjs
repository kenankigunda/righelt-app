import {assertReplayIntegrity} from '../support/replay-write-contract.mjs';
import {readFile} from 'node:fs/promises';
import {isOperationRequest,operationValues} from "../support/shared-request.mjs";
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {test,expect} from '@playwright/test';
import {submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';
import {waitForPlayableBoard} from '../../scripts/validation/browser-navigation.mjs';
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});

test('guest computer finishes a catalog position and prepares a fresh rematch',async({page},info)=>{
  await page.goto('/');
  await expect(page.getByTestId('home-create-game')).toBeVisible();
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
  const game=(await request('/api/shell/history/branch',{sourceGameId:source.id,sourceDecisionId:final.moveId,creatorSide:'p2',computer:{p1:'babs',p2:null}})).game;
  expect(game.board.state).toEqual(final.selectionSnapshot);
  await page.goto(`/#/game/${game.id}`);
  await waitForComputerDecision(page,game.id,'babs',{guest:true});
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
  expect(fresh.computer.seats).toEqual({p1:null,p2:'babs'});
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',fresh.id);
});
for (const width of [320, 390, 430, 1440]) test(`guest computer play survives reload and undo at ${width}px`, async ({ page }, info) => {
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
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', initial.id);
  await waitForPlayableBoard(page);
  await page.evaluate(() => {
    window.boardStatusGeometry={running:true,samples:[]};
    const sample=()=>{const record=window.boardStatusGeometry;if(!record.running)return;const board=document.querySelector('#shell-board');if(board){const rect=board.getBoundingClientRect();record.samples.push({y:rect.top+scrollY,height:rect.height,message:document.querySelector('#shell-board-preview-label')?.textContent});}requestAnimationFrame(sample);};sample();
  });
  await submitPlayableAction(page, initial.legalActions.find(action => action.from && action.to));
  await expect.poll(async () => (await projected(page, initial.id)).moves.length).toBeGreaterThan(0);
  if ((await projected(page, initial.id)).canEndTurn) await page.locator('[data-board-preview-action="end-turn"]').click();
  await waitForComputerDecision(page, initial.id, 'babs', {guest:true});
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
  expect(saved.computerProof.modelId).toBe('initial-1554');
  await page.reload();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',initial.id);
  await expect.poll(async()=> (await projected(page,initial.id)).moves.some(move=>move.moveId===saved.moveId)).toBe(true);
  await expect(page.getByTestId('account-dialog')).not.toBeVisible();
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const continueHere=page.getByRole('button',{name:'Continue on this device',exact:true});
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
    await page.locator('[data-action="undo-last-move"]').click();
    await expect.poll(async () => {
      const game = await projected(page, initial.id);
      return { activeMoves: game.moves.filter(move => !move.undone).length, paused: game.computer.paused, state: game.board.state };
    }).toEqual({ activeMoves: 0, paused: false, state: initial.board.state });
    await switchGamePanel(page, "board");
    await expect(page.locator('[data-computer-status]')).toBeHidden();
    await expect(page.locator('#shell-board-preview-label')).toContainText('Select a piece');
    await expect(page.locator('#shell-board .move-ghost')).toHaveCount(0);
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
    const navigation=page.getByRole('button',{name:'Open navigation menu',exact:true});
    if(await navigation.isVisible())await navigation.click();
    await page.getByRole('button',{name:'Debug',exact:true}).click();
    const raw=page.locator('[data-debug-section="raw"]');
    await raw.locator('summary').click();
    const downloaded=page.waitForEvent('download');
    await raw.getByRole('button',{name:'Export game evidence and my notes'}).click();
    const exported=JSON.parse(await readFile(await (await downloaded).path(),'utf8'));
    expect(exported.notes).toEqual([]);expect(exported.analyses).toEqual([]);expect(exported.attempts.length).toBeGreaterThan(0);
    await info.attach('undo-controls', { contentType: 'application/json', body: JSON.stringify(controls) });
  } finally { page.off('request', observe); }
});
