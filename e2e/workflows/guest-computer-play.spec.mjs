import {readFile} from 'node:fs/promises';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {test,expect} from '@playwright/test';
import {submitPlayableAction} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';
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
  await expect(chooser.getByRole('combobox',{name:'Opponent',exact:true})).toHaveValue('babs');
  const creation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');
  await chooser.getByRole('button',{name:'Start game',exact:true}).click();
  const response=await creation;expect(response.status()).toBe(200);
  const fresh=(await response.json()).game;expect(fresh.id).not.toBe(game.id);
  expect(fresh.computer.seats).toEqual({p1:null,p2:'babs'});
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',fresh.id);
});
for (const width of [390, 1440]) test(`guest computer play survives reload and undo at ${width}px`, async ({ page }, info) => {
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
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase', 'idle');
  await submitPlayableAction(page, initial.legalActions.find(action => action.from && action.to));
  await expect.poll(async () => (await projected(page, initial.id)).moves.length).toBeGreaterThan(0);
  if ((await projected(page, initial.id)).canEndTurn) await page.locator('[data-action="end-turn"]').click();
  await waitForComputerDecision(page, initial.id, 'babs', {guest:true});
  const saved = (await projected(page, initial.id)).moves.find(move=>move.computerProof);
  expect(saved.computerProof.modelId).toBe('initial-1554');
  await page.reload();
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',initial.id);
  await expect.poll(async()=> (await projected(page,initial.id)).moves.some(move=>move.moveId===saved.moveId)).toBe(true);
  await expect(page.getByTestId('account-dialog')).not.toBeVisible();
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const continueHere=page.getByRole('button',{name:'Continue on this device',exact:true});
  if(await continueHere.isVisible()) {
    const switched=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/computer-control') && r.request().postDataJSON()?.action==='switch');
    await continueHere.click();expect((await switched).status()).toBe(200);
  }
  const controls = [];
  const observe = response => {
    if (new URL(response.url()).pathname === `/api/shell/games/${initial.id}/computer-control`)
      controls.push({ action: response.request().postDataJSON().action, status: response.status() });
  };
  page.on('response', observe);
  try {
    const history = page.locator('[data-action="switch-game-panel"][data-panel="history"]');
    if (await history.isVisible()) await history.click();
    await page.locator('[data-action="undo-last-move"]').click();
    await expect.poll(async () => {
      const game = await projected(page, initial.id);
      return { activeMoves: game.moves.filter(move => !move.undone).length, paused: game.computer.paused, state: game.board.state };
    }).toEqual({ activeMoves: 0, paused: false, state: initial.board.state });
    const board = page.locator('[data-action="switch-game-panel"][data-panel="board"]');
    if (await board.isVisible()) await board.click();
    await expect(page.locator('[data-computer-status]')).toBeHidden();
    expect(controls.filter(control => control.action === 'resume')).toEqual([{ action: 'resume', status: 200 }]);
    expect(controls.every(control => control.status === 200)).toBe(true);
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
  } finally { page.off('response', observe); }
});
