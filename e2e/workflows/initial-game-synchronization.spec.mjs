import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove, getHistoryMoveCount } from '../support/app.mjs';

test('authoritative HTTP creation permits the first move while initial socket synchronization is unavailable', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let received = false, finished = false, closing = false, creation;
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.__receivedSocketSeq = 0;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const frame = JSON.parse(event.data);
          // Track delivered frames. The test then waits for rendering and checks move identity.
          queueMicrotask(() => { window.__receivedSocketSeq = Math.max(window.__receivedSocketSeq, frame.eventSeq || 0); });
        });
      }
    };
  });
  await page.routeWebSocket(/\/api\/shell\/games\/[^/]+\/ws/, socket => {
    const server = socket.connectToServer();
    server.onMessage(async message => { received = true; await held; if (!closing) socket.send(message); });
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
    expect(await page.evaluate(() => window.__receivedSocketSeq)).toBe(0);
    release();
    await expect.poll(() => page.evaluate(() => window.__receivedSocketSeq)).toBeGreaterThanOrEqual(recorded.eventSeq);
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
