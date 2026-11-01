import {writeFile} from 'node:fs/promises';
import { CURRENT_COMPUTER_MODEL } from '../../packages/shared-types/src/computer-play.ts';
import { test, expect } from '@playwright/test';
import { submitPlayableAction, switchGamePanel } from '../support/app.mjs';
import { AUTH_CONTROL_ORIGIN } from './fixture.mjs';
import { readProjectedGame, waitForComputerDecision } from '../support/computer-projection.mjs';
import { isOperationRequest, operationValues } from '../support/shared-request.mjs';
import { attachFailureAndRethrow } from '../support/failure-evidence.mjs';
import { waitForPlayableBoard } from '../../scripts/validation/browser-navigation.mjs';
import {installPassiveCommandObservations,attachCommandObservations} from '../support/command-observations.mjs';

const projected = (page, id) => page.evaluate(readProjectedGame, { id });

function captureInitialComputerControl(page) {
  const acquisition = page.waitForRequest(request => isOperationRequest(request, 'computer-control') && operationValues(request)?.action === 'acquire');
  acquisition.catch(() => {});
  return acquisition;
}

async function waitForInitialComputerControl(page, initial, acquisition) {
  const request = await acquisition;
  const command = request.postDataJSON(), values = operationValues(request);
  expect(command.kind).toBe('shared');
  expect(command.gameId).toBe(initial.id);
  expect(command.clientCommandId).toMatch(/^v2:/);
  expect(values.generation).toBe(initial.computer.generation);
  expect(typeof values.deviceId).toBe('string');
  expect(values.deviceId.length).toBeGreaterThan(0);
  const acceptedGeneration = initial.computer.generation + 1;
  await expect.poll(async () => {
    const game = await projected(page, initial.id);
    return { deviceId: game.computer.lease?.deviceId ?? null,
      generation: game.computer.generation, canRecordMove: game.canRecordMove };
  }, { message: 'Initial computer control must be acknowledged before the first human action' }).toEqual({
    deviceId: values.deviceId, generation: acceptedGeneration, canRecordMove: true,
  });
  await waitForPlayableBoard(page);
  await test.info().attach('initial-computer-control-readiness', { contentType: 'application/json',
    body: JSON.stringify({ gameId: initial.id, clientCommandId: command.clientCommandId,
      deviceId: values.deviceId, submittedGeneration: values.generation, acceptedGeneration }) });
}

async function registerComputerTester(page, { home = true } = {}) {
  expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`, { method: 'POST' })).ok).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play both sides', exact: true }).click();
  const account = page.getByTestId('account-dialog');
  await account.getByRole('button', { name: 'Create account', exact: true }).click();
  await account.getByLabel('Username', { exact: true }).fill(`Computer_${Date.now().toString(36)}`);
  await account.getByLabel('Password', { exact: true }).fill('A computer play password 482');
  await account.getByRole('button', { name: 'Create account & continue', exact: true }).click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
  if (home) await page.goto('/#/');
}

test('ordinary computer play records real worker evidence, preserves private notes, and branches from the displayed decision', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = [], errorDetails = []; let journeyPhase = 'play';
  page.on('pageerror', error => {
    errors.push(error.message);
    errorDetails.push({ phase: journeyPhase, name: error.name, timestamp: new Date().toISOString() });
    console.error('computer-play browser error:', error.message);
  });
  await registerComputerTester(page);
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const create = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST' && response.request().postDataJSON()?.computer?.p2 === 'babs');
  const initialControl = captureInitialComputerControl(page);
  await page.getByRole('button', { name: 'Play Babs', exact: true }).click();
  const createResponse = await create;
  expect(createResponse.status(), `Computer game creation failed (request ${createResponse.headers()['x-righelt-request-id'] || 'unavailable'})`).toBe(200);
  const created = (await createResponse.json()).game;
  expect(created.computer.seats).toEqual({ p1: null, p2: 'babs' });
  expect(created.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  expect(createResponse.request().postDataJSON().computerModelId).toBe(CURRENT_COMPUTER_MODEL.id);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', created.id);
  await expect(page.getByTestId('game-role')).toContainText('Player 1');
  await waitForInitialComputerControl(page, created, initialControl);
  const humanAction = created.legalActions.find(action => action.from && action.to);
  await submitPlayableAction(page, humanAction);
  await expect.poll(async () => (await projected(page, created.id)).moves.length).toBeGreaterThan(0);
  const afterHuman = await projected(page, created.id);
  if (afterHuman.canEndTurn) await page.locator('[data-action="end-turn"]').click();
  let lastVerifiedGame=afterHuman;
  try { await expect.poll(async () => {
    const game = await projected(page, created.id);
    lastVerifiedGame=game;
    return game.moves.some(move => move.computerProof?.modelId === created.computer.modelId);
  }, { timeout: 100000, message: 'The production worker must submit a real trained-computer decision' }).toBe(true);
  } catch (error) {
    await attachFailureAndRethrow(error,{page,testInfo,lastVerifiedProjection:lastVerifiedGame,details:{journeyPhase,errors}});
  }
  const navigation = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole('button', { name: 'Debug', exact: true }).click();
  const debug = page.locator('[data-flyout="debug"]');
  await debug.locator('[data-debug-section="position"] > summary').click();
  await expect(debug.getByRole('heading', { name: /All legal actions \([1-9]/ })).toBeVisible();
  await debug.locator('[data-debug-section="notes"] > summary').click();
  const draft = debug.locator('[data-debug-note="text"]');
  await draft.fill('This is my private observation.'); await draft.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue('This is my private observation.');
  const savedNote = page.waitForResponse(response => response.url().endsWith('/decision-notes') && response.request().postDataJSON()?.operation === 'write');
  await debug.getByRole('button', { name: 'Save note', exact: true }).click();
  expect((await savedNote).ok()).toBe(true);
  journeyPhase = 'reload';
  await page.reload();
  journeyPhase = 'restored';
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', created.id);
  try { await expect(debug).toBeVisible(); }
  catch (error) {
    console.error('computer-play reload state:', await page.evaluate(() => ({ error: window.__righeltLastError, hash: location.hash, loading: [...document.querySelectorAll('[data-loading-state=pending]')].map(el => ({ key: el.dataset.loadingKey, text: el.textContent })) })));
    throw error;
  }
  const notes = page.locator('[data-debug-section="notes"]');
  if (!await notes.evaluate(el => el.open)) await notes.locator('summary').click();
  await expect(notes.locator('textarea')).toHaveValue('This is my private observation.');
  const decision = page.locator('[data-debug-section="decision"]');
  await decision.locator('summary').first().click();
  await decision.getByRole('button', { name: 'Load saved search evidence' }).click();
  await expect(decision.getByText('Computer decision · saved search evidence is reported by the client.')).toBeVisible();
  await expect(decision.getByRole('table')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('computer-debug-evidence.png') });
  const analysis = page.locator('[data-debug-section="analysis"]');
  await analysis.locator('summary').first().click();
  const beforeAnalysis = await projected(page, created.id);
  await analysis.getByRole('button', { name: 'Analyze position', exact: true }).click();
  const cancelledEvidence = page.waitForResponse(response => response.url().endsWith('/decision-attempt') && response.request().method() === 'POST' && response.request().postDataJSON()?.kind === 'analysis' && response.request().postDataJSON()?.operation === 'write');
  await analysis.getByRole('button', { name: 'Cancel analysis', exact: true }).click();
  expect((await cancelledEvidence).ok()).toBe(true);
  await expect(analysis.getByText('cancelled', { exact: true })).toBeVisible();
  const afterAnalysis = await projected(page, created.id);
  expect(afterAnalysis.gameplayRevision).toBe(beforeAnalysis.gameplayRevision);
  expect(afterAnalysis.board.state).toEqual(beforeAnalysis.board.state);
  await analysis.getByText('cancelled', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('computer-analysis-cancelled.png') });
  const beforeBranch = await projected(page, created.id), chosen = beforeBranch.moves.at(-1);
  const branchResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/history/branch');
  await decision.getByRole('button', { name: 'Create a new game before this decision' }).click();
  const chooser = page.getByRole('dialog', { name: 'Create a new game here' });
  await expect(chooser.locator('[data-rematch-friend-help]')).toHaveCount(0);
  await chooser.getByRole('group', { name: 'Opponent', exact: true }).getByRole('radio', { name: 'Friend', exact: true }).check();
  await expect(chooser.locator('[data-rematch-friend-help]')).toHaveCount(0);
  await chooser.getByRole('radio', { name: 'Blue', exact: true }).check();
  await chooser.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
  });
  await page.screenshot({ path: testInfo.outputPath('computer-branch-chooser.png') });
  const popupPromise = page.waitForEvent('popup');
  await chooser.getByRole('button', { name: 'Start game' }).click();
  const popup = await popupPromise;
  try {
    const branched = (await (await branchResponse).json()).game;
    expect(branched.board.state).toEqual(chosen.selectionSnapshot);
    expect(branched.player1).toBeNull(); expect(branched.player2.identityId).toBe(beforeBranch.computer.ownerId);
    await expect(popup.getByTestId('game-shell')).toHaveAttribute('data-game-id', branched.id);
    expect((await projected(page, created.id)).gameplayRevision).toBe(beforeBranch.gameplayRevision);
  } finally { await popup.close(); }
  if (errorDetails.length) await testInfo.attach('browser-error-phases', { contentType: 'application/json', body: JSON.stringify(errorDetails) });
  expect(errors).toEqual([]);
});

test('ordinary computer undo restores the human turn and resumes computer control', async ({ page }, info) => {
  await page.addInitScript(installPassiveCommandObservations);
  let primaryError;
  try{
  await registerComputerTester(page);
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST' && response.request().postDataJSON()?.computer?.p2 === 'babs');
  const initialControl = captureInitialComputerControl(page);
  await page.getByRole('button', { name: 'Play Babs', exact: true }).click();
  const response = await creation;
  expect(response.ok()).toBe(true);
  const initial = (await response.json()).game;
  expect(initial.computer.seats).toEqual({ p1: null, p2: 'babs' });
  expect(initial.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', initial.id);
  await waitForInitialComputerControl(page, initial, initialControl);
  await page.evaluate(()=>window.commandObservationCheckpoint('before-first-human-action'));
  await submitPlayableAction(page, initial.legalActions.find(action => action.from && action.to));
  await page.evaluate(()=>window.commandObservationCheckpoint('after-first-human-confirmation'));
  await expect.poll(async () => (await projected(page, initial.id)).moves.length).toBeGreaterThan(0);
  if ((await projected(page, initial.id)).canEndTurn) await page.locator('[data-action="end-turn"]').click();
  await waitForComputerDecision(page, initial.id, 'babs', { modelId: initial.computer.modelId });
  const controls = [];
  const observe = request => {
    if (isOperationRequest(request, 'computer-control')) controls.push({ action: operationValues(request).action,
      envelope: request.postDataJSON(), headers: Object.fromEntries(Object.entries(request.headers()).filter(([name]) => name.startsWith('x-righelt-'))) });
  };
  page.on('request', observe);
  try {
    await switchGamePanel(page,'history');
    const firstMove=(await projected(page,initial.id)).moves.find(move=>!move.undone);
    expect(firstMove?.moveId).toBeTruthy();
    const row=page.locator(`[data-testid="history-move-item"][data-move-id="${firstMove.moveId}"]`);
    await row.locator('.history-item-info').click();
    await row.getByRole('button',{name:'Undo before this move',exact:true}).click();
    await expect.poll(async () => {
      const game = await projected(page, initial.id);
      return { activeMoves: game.moves.filter(move => !move.undone).length, paused: game.computer.paused, state: game.board.state };
    }).toEqual({ activeMoves: 0, paused: false, state: initial.board.state });
    await switchGamePanel(page,'board');
    await expect(page.locator('[data-computer-status]')).toBeHidden();
    await expect.poll(() => controls.filter(control => control.action === 'resume').length).toBeGreaterThan(0);
    const resumes = controls.filter(control => control.action === 'resume');
    expect(new Set(resumes.map(control => control.envelope.clientCommandId)).size).toBe(1);
    const { envelope, headers } = resumes[0]; expect(envelope.kind).toBe('shared');
    // A live receipt may cancel its HTTP response. Check durable acceptance instead.
    const receipt = await page.evaluate(async ({ id, envelope, headers }) => {
      const response = await fetch(`/api/shell/games/${id}/reconcile`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 2, identityId: envelope.identityId, knownSnapshotEventSeq: 0, commands: [envelope] }) });
      if (!response.ok) throw Error(`Receipt lookup failed: ${response.status}`);
      return response.json();
    }, { id: initial.id, envelope, headers });
    expect(receipt.commandOutcomes[0]).toMatchObject({ outcome: 'accepted', clientCommandId: envelope.clientCommandId, fingerprint: envelope.fingerprint });
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: info.outputPath('computer-undo-resumed.png') });
    await info.attach('undo-controls', { contentType: 'application/json', body: JSON.stringify(controls) });
  } finally { page.off('request', observe); }
  }catch(error){primaryError=error;throw error;}
  finally{try{await attachCommandObservations(page,info);}catch(error){if(!primaryError)throw error;info.annotations.push({type:'diagnostic-capture-failed',description:String(error)});}}
});


for (const profile of ['tau', 'horus']) {
test(`${profile} prepares and plays as Player 2 with the production model`, async ({ page }, info) => {
  await registerComputerTester(page);
  await page.locator(`[data-action="opponent-story"][data-opponent="${profile}"]`).click();
  const story = page.getByRole('dialog');
  // Preparation is an operation within the test budget, not a ten-second text transition.
  await story.locator('[data-story-play]').click({ trial: true });
  await expect(story.locator('[data-story-readiness]')).toContainText('Ready to play');
  const create = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST' && response.request().postDataJSON()?.computer?.p2 === profile);
  const initialControl = captureInitialComputerControl(page);
  await story.locator('[data-story-play]').click();
  const createResponse = await create;
  expect(createResponse.status(), `Computer game creation failed (request ${createResponse.headers()['x-righelt-request-id'] || 'unavailable'})`).toBe(200);
  const created = (await createResponse.json()).game;
  expect(created.computer.seats).toEqual({ p1: null, p2: profile });
  expect(created.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  expect(createResponse.request().postDataJSON().computerModelId).toBe(CURRENT_COMPUTER_MODEL.id);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', created.id);
  await waitForInitialComputerControl(page, created, initialControl);
  await submitPlayableAction(page, created.legalActions.find(action => action.from && action.to));
  await expect.poll(async () => (await projected(page, created.id)).moves.length).toBeGreaterThan(0);
  if ((await projected(page, created.id)).canEndTurn) await page.locator('[data-action="end-turn"]').click();
  const played = await waitForComputerDecision(page, created.id, profile, { modelId: created.computer.modelId });
  expect(played.moves.find(move => move.computerProof)?.computerProof.profile).toBe(profile);
  await info.attach('accepted-profile-decisions', { contentType: 'application/json', body: JSON.stringify({ profile, humanFirst: played.moves }) });
});

test(`${profile} branches from a human decision and plays as Player 1 with the production model`, async ({ page }, info) => {
  // Each real-model journey keeps its own unchanged test budget and fresh account.
  await registerComputerTester(page, { home: false });
  const sourceId = await page.getByTestId('game-shell').getAttribute('data-game-id');
  const created = await projected(page, sourceId);
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase', 'idle');
  await submitPlayableAction(page, created.legalActions.find(action => action.from && action.to));
  await expect.poll(async () => (await projected(page, sourceId)).moves.length).toBeGreaterThan(0);
  const played = await projected(page, sourceId), human = played.moves.find(move => !move.computerProof);
  const historyRow = page.locator(`[data-testid="history-move-item"][data-move-id="${human.moveId}"]`);
  await historyRow.click();
  await historyRow.locator('[data-action="launch-history-branch"]').click();
  const chooser = page.getByRole('dialog', { name: 'Create a new game here', exact: true });
  await chooser.getByRole('group', { name: 'Opponent', exact: true }).locator(`input[value="${profile}"]`).check();
  await chooser.getByRole('radio', { name: 'Blue', exact: true }).check();
  // Real model preparation uses the remaining test budget, as story entry does.
  await chooser.getByRole('button', { name: 'Start game', exact: true }).click({ trial: true });
  await expect(chooser.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
  const branchResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/history/branch');
  const popupPromise = page.waitForEvent('popup');
  await chooser.getByRole('button', { name: 'Start game', exact: true }).click();
  const popup = await popupPromise;
  try {
    const branched = (await (await branchResponse).json()).game;
    expect(branched.board.state).toEqual(created.board.state);
    expect(branched.computer.seats).toEqual({ p1: profile, p2: null });
    await expect(popup.getByTestId('game-role')).toContainText('Player 2');
    expect(branched.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
    const computerFirst = await waitForComputerDecision(popup, branched.id, profile, { modelId: branched.computer.modelId });
    expect(computerFirst.moves.find(move => move.computerProof)?.computerProof.profile).toBe(profile);
    const unchangedSource = await projected(page, sourceId);
    expect(unchangedSource.gameplayRevision).toBe(played.gameplayRevision);
    expect(unchangedSource.board.state).toEqual(played.board.state);
    await info.attach('accepted-profile-decisions', { contentType: 'application/json', body: JSON.stringify({ profile, source: played.moves, computerFirst: computerFirst.moves }) });
  } catch (error) {
    await info.attach('branch-computer-failure', { contentType: 'application/json', body: JSON.stringify({ profile, url: popup.url(), status: await popup.locator('[data-computer-status]').allTextContents(), visibility: await popup.evaluate(() => document.visibilityState) }) });
    await popup.screenshot({ path: info.outputPath('branch-computer-failure.png') });
    throw error;
  } finally { await popup.close(); }
});
}


test('authenticated human Pass stays available during a sanitized pending renewal',async({page},info)=>{
  await registerComputerTester(page);
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const create=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST'&&response.request().postDataJSON()?.computer?.p2==='babs');
  const initialControl=captureInitialComputerControl(page);
  await page.getByRole('button',{name:'Play Babs',exact:true}).click();
  const createdResponse=await create;expect(createdResponse.status()).toBe(200);const created=(await createdResponse.json()).game;
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',created.id);await waitForInitialComputerControl(page,created,initialControl);
  const before=await projected(page,created.id);expect(before.computer.lease.authContextId).toBeUndefined();
  const pass=page.locator('#shell-board-preview-label [data-board-message-action="pass"], #shell-board-preview-label [data-board-preview-action="pass"]');
  let renewal,headers,release;const held=new Promise(resolve=>{release=resolve;}),humanRequests=[];
  const observe=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/api/shell/games/${created.id}/apply`){const value=request.postDataJSON();if(!value.payload?.computer)humanRequests.push(value);}};
  page.on('request',observe);
  await page.route(`**/api/shell/games/${created.id}/shared`,async route=>{
    const value=route.request().postDataJSON();
    if(!renewal&&value.payload?.operation==='computer-control'&&value.payload.values?.action==='renew'){
      renewal=value;headers=Object.fromEntries(Object.entries(route.request().headers()).filter(([name])=>name==='content-type'||name.startsWith('x-righelt-')));await held;
    }
    await route.continue();
  });
  try{
    await expect.poll(()=>Boolean(renewal)).toBe(true);expect(renewal.authContextId).toMatch(/^[a-f0-9]{64}$/);await expect(pass).toBeEnabled();
    await page.screenshot({path:info.outputPath('authenticated-fresh-renewal.png')});
    await pass.click();await expect(page.getByTestId('history-pending-move-item').filter({hasText:'PASS'})).toHaveCount(1);
    expect(humanRequests).toHaveLength(0);release();
    await expect.poll(()=>humanRequests.length).toBe(1);const admitted=humanRequests[0];
    expect(admitted.authContextId).toBe(renewal.authContextId);expect(admitted.expectedGameplayRevision).toBe(before.gameplayRevision);
    expect(admitted.predecessor).toEqual({clientCommandId:renewal.clientCommandId,fingerprint:renewal.fingerprint});
    await expect.poll(async()=>(await projected(page,created.id)).moves.filter(move=>move.clientCommandId===admitted.clientCommandId)).toHaveLength(1);
    const response=await page.request.post(`/api/shell/games/${created.id}/reconcile`,{headers,data:{protocolVersion:2,identityId:admitted.identityId,knownSnapshotEventSeq:0,commands:[renewal,admitted]}});
    expect(response.status()).toBe(200);const body=await response.json();
    expect(body.commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:renewal.clientCommandId,fingerprint:renewal.fingerprint,outcome:'accepted',gameplayRevision:before.gameplayRevision}));
    expect(body.commandOutcomes).toContainEqual(expect.objectContaining({clientCommandId:admitted.clientCommandId,fingerprint:admitted.fingerprint,outcome:'accepted',gameplayRevision:before.gameplayRevision+1}));
    expect(humanRequests).toHaveLength(1);await page.screenshot({path:info.outputPath('authenticated-pass-accepted.png')});
    await writeFile(info.outputPath('authenticated-renewal-receipts.json'),JSON.stringify({beforeRevision:before.gameplayRevision,renewalId:renewal.clientCommandId,admittedId:admitted.clientCommandId,predecessor:admitted.predecessor,outcomes:body.commandOutcomes,humanRequestCount:humanRequests.length},null,2));
  }finally{release();page.off('request',observe);await page.unrouteAll({behavior:'wait'});}
});
