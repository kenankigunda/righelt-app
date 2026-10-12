import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove, getHistoryMoveCount } from '../support/app.mjs';

test('creation helper waits for guest startup recovery before choosing Friend', async ({ page }) => {
  let requests = 0, release, retryStarted;
  const held = new Promise(resolve => { release = resolve; });
  const retry = new Promise(resolve => { retryStarted = resolve; });
  await page.addInitScript(() => {
    window.friendClicks = 0;
    document.addEventListener('click', event => {
      if (event.target.closest?.('[data-testid="home-create-game"]')) window.friendClicks++;
    }, true);
  });
  await page.route('**/api/shell/bootstrap', async route => {
    if (++requests === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'local_api_unavailable' }) });
      return;
    }
    retryStarted();
    await held;
    await route.continue();
  });
  const creation = createGameFromHome(page).then(value => ({ value }), error => ({ error }));
  try {
    await retry;
    expect(await page.evaluate(() => window.friendClicks)).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Friend', exact: true })).not.toBeVisible();
    release();
    const outcome = await creation;
    if (outcome.error) throw outcome.error;
    expect(await page.evaluate(() => window.friendClicks)).toBe(1);
    await expect(page.getByTestId('game-role')).toContainText('Player 1');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('authoritative HTTP creation permits the first move while initial socket synchronization is unavailable', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let received = false, deliveredSeq = 0, finished = false, closing = false, creation;
  await page.routeWebSocket(/\/api\/shell\/games\/[^/]+\/ws/, socket => {
    const server = socket.connectToServer();
    server.onMessage(async message => {
      received = true;
      await held;
      if (!closing) {
        socket.send(message);
        deliveredSeq = Math.max(deliveredSeq, JSON.parse(String(message)).eventSeq || 0);
      }
    });
  });
  try {
    creation = createGameFromHome(page).then(value => { finished = true; return value; });
    void creation.catch(() => {});
    const {gameId} = await creation;
    await expect.poll(() => received).toBe(true);
    expect(finished, 'authoritative HTTP must permit play without socket readiness').toBe(true);
    await expect(page.locator('[data-action="play-as-both-players"]')).toBeEnabled();
    await makeAnyLegalMove(page);
    expect(await getHistoryMoveCount(page)).toBe(1);
    const recorded = await page.evaluate(async id => {
      const identityId = localStorage.getItem('righelt.identity.id.v1');
      return (await (await fetch(`/api/shell/games/${id}?identityId=${identityId}`)).json());
    }, gameId);
    const originalMoveId = recorded.game.moves[0].moveId;
    expect(originalMoveId).toBeTruthy();
    expect(deliveredSeq, 'the socket fault must remain active through the recorded move').toBe(0);
    release();
    await expect.poll(() => deliveredSeq).toBeGreaterThanOrEqual(recorded.eventSeq);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.board-wrap[data-reconnecting="true"]')).toHaveCount(0);
    expect(await getHistoryMoveCount(page)).toBe(1);
    await expect(page.getByTestId('history-move-item')).toHaveAttribute('data-move-id', originalMoveId);
  } finally {
    closing = true;
    release();
    await creation?.catch(() => {});
    await page.unrouteAll({ behavior: 'wait' });
    // WebSocket routes have no unroute API; closing this owned fixture page
    // releases its sockets after pending HTTP handlers have drained.
    await page.close();
  }
});
