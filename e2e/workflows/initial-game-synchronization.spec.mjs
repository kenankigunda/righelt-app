import { test, expect } from '@playwright/test';
import { createGameFromHome, makeAnyLegalMove, getHistoryMoveCount } from '../support/app.mjs';

test('creation helper waits for initial synchronization before the first board activation', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let received = false, finished = false, closing = false, creation;
  await page.routeWebSocket(/\/api\/shell\/games\/[^/]+\/ws/, socket => {
    const server = socket.connectToServer();
    server.onMessage(async message => { received = true; await held; if (!closing) socket.send(message); });
  });
  // Reconciliation HTTP responses can also unblock the local recovery gate.
  await page.route(/\/api\/shell\/games\/[^/]+(?:\/reconcile)?(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    creation = createGameFromHome(page).then(value => { finished = true; return value; });
    // Observe early rejection while polling the transport fault, but preserve the
    // original promise so awaiting creation still reports its exact failure.
    void creation.catch(() => {});
    await expect.poll(() => received).toBe(true);
    await expect(page.getByTestId('sync-recovery-banner')).toContainText('Reconnecting.');
    await expect(page.locator('[data-action="play-as-both-players"]')).toBeDisabled();
    // Negative observation window while the real initial synchronization is held.
    // This is fault duration, not an increased helper timeout or repeated click.
    await page.waitForTimeout(300);
    expect(finished, 'creation must not return a board that rejects its first activation').toBe(false);
    release();
    await creation;
    await makeAnyLegalMove(page);
    expect(await getHistoryMoveCount(page)).toBe(1);
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
