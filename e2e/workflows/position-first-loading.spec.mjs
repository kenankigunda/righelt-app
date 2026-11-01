import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { applyAction, resolveToStability } from '../../apps/web/generated/packages/game-engine/src/index.js';
import { importScenarioGame, switchGamePanel } from '../support/app.mjs';

const initialState = JSON.parse(readFileSync(new URL('../../packages/game-engine/test/fixtures/game-loading-rush.json', import.meta.url)));
const scenario = { formatVersion: 2, id: '85241980-65fc-4b88-b978-c42726181040', title: 'Saved board search regression',
  description: 'Exact saved rules position', incorrect: false, initialState, moves: [], resultingState: initialState,
  expectedFinalStateHash: '', expectedOutcome: 'ongoing' };

for (const width of [390, 1440]) test(`saved board remains visible while play loads and recovers at ${width}px`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  // Desktop also exercises native compressed history rather than claiming an
  // empty metadata move list is the complete history.
  const action = JSON.parse(readFileSync(new URL('../../packages/game-engine/test/fixtures/game-loading-actions.json', import.meta.url))).find(action => action.type === 'move');
  const expectedState = width === 1440 ? resolveToStability(applyAction(initialState, action).state) : initialState;
  const input = width === 1440 ? { ...scenario, moves: [{ turnIndex: initialState.turnIndex, turnMoveIndex: 0, actorSide: initialState.sideToMove, action, notation: 'Saved move' }], resultingState: expectedState } : scenario;
  const { gameId, gameHash } = await importScenarioGame(page, input, baseURL, { open: false });
  let phase = 'hold', primaryFailure; const releases = new Set(); const mutations = [], routeReadErrors = [];
  await page.routeWebSocket(new RegExp(`/api/shell/games/${gameId}/ws`), socket => socket.close());
  await page.route(`**/api/shell/games/${gameId}**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && !/\/(reconcile|decision-history|decision-snapshot)$/.test(path)) mutations.push(path);
    if (phase === 'ready' || ![ `/api/shell/games/${gameId}`, `/api/shell/games/${gameId}/reconcile` ].includes(path)) return route.continue();
    if (phase === 'hold') await new Promise(resolve => releases.add(resolve));
    if (phase === 'failing') {
      let activated = false;
      try { activated = await request.frame().evaluate(() => globalThis.__positionRetryActivated === true); }
      catch (error) { routeReadErrors.push({ name: error.name }); } // Fail closed; retain the primary error.
      if (activated) phase = 'ready';
    }
    if (phase === 'ready') return route.continue();
    return route.fulfill({ status: 503, json: { ok: false, error: 'rules_budget_exceeded' } });
  });
  try {
    // A changed document URL retires Home's already-open sockets and cached authority.
    await page.addInitScript(() => { globalThis.__positionRetryActivated = false; });
    await page.goto(`/?position-first=${width}${gameHash}`);
    await switchGamePanel(page, 'board');
    const board = page.getByTestId('game-board'), wrap = page.getByTestId('game-board-wrap');
    await expect(board.locator('[data-piece-id]')).toHaveCount(expectedState.pieces.length);
    // Initial frames must contain their real side panels before route hydration.
    await expect(page.locator('[data-game-panel="summary"]')).toContainText('Role:');
    await expect(page.locator('[data-game-panel="join"] h2')).toHaveText('Players');
    await expect(page.locator('[data-game-panel="history"] h2')).toHaveText('History');
    if (width === 1440) await expect(page.locator('[data-game-panel="history"]')).toContainText('Loading game history');
    await expect(wrap).toHaveAttribute('aria-busy', 'true');
    await expect(wrap).toHaveAttribute('data-loading-phase', /visible|slow/);
    await expect(page.locator('.loading-edge-frame').first()).toBeVisible();
    await expect(page.locator('[data-board-message-action="pass"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`position-loading-${width}.png`) });
    // Keep the outage active for background retries until the manual retry
    // stage. One failed response followed by a healthy read can recover the UI.
    phase = 'failing'; for (const release of releases) release(); releases.clear();
    const recovery = page.getByTestId('position-load-error');
    await expect(recovery).toBeVisible();
    await expect(board.locator('[data-piece-id]')).toHaveCount(expectedState.pieces.length);
    await expect(wrap).toHaveAttribute('aria-busy', 'false');
    if (width === 1440) await expect(page.locator('[data-game-panel="history"]')).toContainText('Game history could not finish loading');
    // Lift the fixture outage only after a real activation of this control.
    // Background retries cannot make it disappear before the native click.
    await recovery.getByRole('button', { name: 'Try again', exact: true }).evaluate(button => {
      button.addEventListener('click', event => {
        if (event.isTrusted) globalThis.__positionRetryActivated = true;
      }, { capture: true, once: true, passive: true });
    });
    await recovery.getByRole('button', { name: 'Try again', exact: true }).click();
    expect(await page.evaluate(() => globalThis.__positionRetryActivated)).toBe(true);
    await expect(recovery).toHaveCount(0);
    await expect(page.locator('#shell-board-preview-label')).not.toContainText('Loading play');
    await expect(board.locator('[data-piece-id]')).toHaveCount(expectedState.pieces.length);
    await expect(wrap).toHaveAttribute('aria-busy', 'false');
    if (width === 1440) await expect(page.getByTestId('history-move-item')).toHaveCount(1);
    expect(mutations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`position-ready-${width}.png`) });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    phase = 'ready';
    for (const release of releases) release();
    let cleanupFailure;
    try { await page.unrouteAll({ behavior: 'wait' }); }
    catch (error) { cleanupFailure = error; }
    if (cleanupFailure || routeReadErrors.length) {
      const path = info.outputPath('route-cleanup-error.json');
      try {
        await writeFile(path, JSON.stringify({ name: cleanupFailure?.name, routeReadErrors, primaryFailurePreserved: Boolean(primaryFailure) }, null, 2));
        await info.attach('route-cleanup-error', { contentType: 'application/json', path });
      } catch (error) {
        if (!primaryFailure) throw error;
        console.error('Route cleanup evidence could not be written:', error.name);
      }
    }
    if (cleanupFailure && !primaryFailure) throw cleanupFailure;
  }
});
