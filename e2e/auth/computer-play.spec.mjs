import { test, expect } from '@playwright/test';
import { submitPlayableAction } from '../support/app.mjs';
import { AUTH_CONTROL_ORIGIN } from './fixture.mjs';

const projected = (page, id) => page.evaluate(async id => {
  const session = await (await fetch('/api/auth/session')).json();
  const response = await fetch(`/api/shell/games/${id}`, { headers: { 'X-Righelt-Auth-Version': '2', 'X-Righelt-Session': session.contextId } });
  if (!response.ok) throw Error(`Projection failed: ${response.status}`);
  return (await response.json()).game;
}, id);

async function registerComputerTester(page) {
  expect((await fetch(`${AUTH_CONTROL_ORIGIN}/reset-limits`, { method: 'POST' })).ok).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play both sides', exact: true }).click();
  const account = page.getByTestId('account-dialog');
  await account.getByRole('button', { name: 'Create account', exact: true }).click();
  await account.getByLabel('Username', { exact: true }).fill(`Computer_${Date.now().toString(36)}`);
  await account.getByLabel('Password', { exact: true }).fill('A computer play password 482');
  await account.getByRole('button', { name: 'Create account & continue', exact: true }).click();
  await expect(page.getByTestId('game-shell')).toBeVisible();
  await page.goto('/#/');
}

test('ordinary computer play records real worker evidence, preserves private notes, and branches from the displayed decision', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error('computer-play browser error:', error.message); });
  await registerComputerTester(page);
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const create = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Play Babs', exact: true }).click();
  const created = (await (await create).json()).game;
  expect(created.computer.seats).toEqual({ p1: null, p2: 'babs' });
  expect(created.computer.modelId).toBe('initial-1554');
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', created.id);
  await expect(page.getByTestId('game-role')).toContainText('Player 1');
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase', 'idle');
  const humanAction = created.legalActions.find(action => action.from && action.to);
  await submitPlayableAction(page, humanAction);
  await expect.poll(async () => (await projected(page, created.id)).moves.length).toBeGreaterThan(0);
  const afterHuman = await projected(page, created.id);
  if (afterHuman.canEndTurn) await page.locator('[data-action="end-turn"]').click();
  try { await expect.poll(async () => {
    const game = await projected(page, created.id);
    return game.moves.some(move => move.computerProof?.modelId === 'initial-1554');
  }, { timeout: 100000, message: 'The production worker must submit a real trained-computer decision' }).toBe(true);
  } catch (error) {
    const game = await projected(page, created.id);
    await testInfo.attach('computer-failure-state', { contentType: 'application/json', body: JSON.stringify({ computer: game.computer, revision: game.gameplayRevision, state: game.board.state, currentTurn: game.currentTurn, moves: game.moves, status: await page.locator('[data-computer-status]').innerText(), errors }) });
    throw error;
  }
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
  await page.reload();
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
  await page.screenshot({ path: testInfo.outputPath('computer-analysis-cancelled.png') });
  const beforeBranch = await projected(page, created.id), chosen = beforeBranch.moves.at(-1);
  const branchResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/history/branch');
  await decision.getByRole('button', { name: 'Create a new game before this decision' }).click();
  const chooser = page.getByRole('dialog', { name: 'Create a new game here' });
  await chooser.getByLabel('Opponent').selectOption('friend');
  await chooser.getByRole('radio', { name: 'Player 2 · Blue' }).check();
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
  expect(errors).toEqual([]);
});


for (const profile of ['tau', 'horus']) test(`${profile} prepares and plays both computer seats with the production model`, async ({ page }, info) => {
  await registerComputerTester(page);
  await page.locator(`[data-action="opponent-story"][data-opponent="${profile}"]`).click();
  const story = page.getByRole('dialog');
  await expect(story.locator('[data-story-readiness]')).toContainText('Ready to play');
  const create = page.waitForResponse(response => new URL(response.url()).pathname === '/api/shell/games' && response.request().method() === 'POST');
  await story.locator('[data-story-play]').click();
  const created = (await (await create).json()).game;
  expect(created.computer.seats).toEqual({ p1: null, p2: profile });
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id', created.id);
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase', 'idle');
  await submitPlayableAction(page, created.legalActions.find(action => action.from && action.to));
  await expect.poll(async () => (await projected(page, created.id)).moves.length).toBeGreaterThan(0);
  if ((await projected(page, created.id)).canEndTurn) await page.locator('[data-action="end-turn"]').click();
  await expect.poll(async () => (await projected(page, created.id)).moves.some(move => move.computerProof?.modelId === 'initial-1554')).toBe(true);
  const played = await projected(page, created.id), human = played.moves.find(move => !move.computerProof);
  const historyRow = page.locator(`[data-testid="history-move-item"][data-move-id="${human.moveId}"]`);
  await historyRow.click();
  await historyRow.locator('[data-action="launch-history-branch"]').click();
  const chooser = page.getByRole('dialog', { name: 'Create a new game here', exact: true });
  await chooser.getByRole('combobox', { name: 'Opponent', exact: true }).selectOption(profile);
  await chooser.getByRole('radio', { name: 'Player 2 · Blue', exact: true }).check();
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
    await expect.poll(async () => (await projected(popup, branched.id)).moves.some(move => move.computerProof?.modelId === 'initial-1554')).toBe(true);
    await info.attach('accepted-profile-decisions', { contentType: 'application/json', body: JSON.stringify({ profile, humanFirst: played.moves, computerFirst: (await projected(popup, branched.id)).moves }) });
  } catch (error) {
    await info.attach('branch-computer-failure', { contentType: 'application/json', body: JSON.stringify({ profile, url: popup.url(), status: await popup.locator('[data-computer-status]').allTextContents(), visibility: await popup.evaluate(() => document.visibilityState) }) });
    await popup.screenshot({ path: info.outputPath('branch-computer-failure.png') });
    throw error;
  } finally { await popup.close(); }
});
