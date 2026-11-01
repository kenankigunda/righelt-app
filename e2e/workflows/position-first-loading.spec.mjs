import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importScenarioGame, switchGamePanel } from '../support/app.mjs';

const initialState = JSON.parse(readFileSync(new URL('../../packages/game-engine/test/fixtures/game-loading-rush.json', import.meta.url)));
const scenario = { formatVersion: 2, id: '85241980-65fc-4b88-b978-c42726181040', title: 'Saved board search regression',
  description: 'Exact saved rules position', incorrect: false, initialState, moves: [], resultingState: initialState,
  expectedFinalStateHash: '', expectedOutcome: 'ongoing' };

for (const width of [390, 1440]) test(`saved board remains visible while play loads and recovers at ${width}px`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const { gameId, gameHash } = await importScenarioGame(page, scenario, baseURL, { open: false });
  let blocked = true; const releases = new Set(); const mutations = [];
  await page.routeWebSocket(new RegExp(`/api/shell/games/${gameId}/ws`), socket => socket.close());
  await page.route(`**/api/shell/games/${gameId}**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && !/\/(reconcile|decision-history|decision-snapshot)$/.test(path)) mutations.push(path);
    if (!blocked || ![ `/api/shell/games/${gameId}`, `/api/shell/games/${gameId}/reconcile` ].includes(path)) return route.continue();
    await new Promise(resolve => releases.add(resolve));
    return route.fulfill({ status: 503, json: { ok: false, error: 'rules_budget_exceeded' } });
  });
  try {
    await page.goto(`/${gameHash}`);
    await switchGamePanel(page, 'board');
    const board = page.getByTestId('game-board'), wrap = page.getByTestId('game-board-wrap');
    await expect(board.locator('[data-piece-id]')).toHaveCount(initialState.pieces.length);
    await expect(wrap).toHaveAttribute('aria-busy', 'true');
    await expect(wrap).toHaveAttribute('data-loading-phase', /visible|slow/);
    await expect(page.locator('.loading-edge-frame').first()).toBeVisible();
    await expect(page.locator('[data-board-message-action="pass"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`position-loading-${width}.png`) });
    blocked = false; for (const release of releases) release(); releases.clear();
    const recovery = page.getByTestId('position-load-error');
    await expect(recovery).toBeVisible();
    await expect(board.locator('[data-piece-id]')).toHaveCount(initialState.pieces.length);
    await expect(wrap).toHaveAttribute('aria-busy', 'false');
    await recovery.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(recovery).toHaveCount(0);
    await expect(page.locator('#shell-board-preview-label')).not.toContainText('Loading play');
    await expect(board.locator('[data-piece-id]')).toHaveCount(initialState.pieces.length);
    await expect(wrap).toHaveAttribute('aria-busy', 'false');
    expect(mutations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`position-ready-${width}.png`) });
  } finally {
    for (const release of releases) release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
