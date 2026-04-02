import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
  openDirectGameLink,
  requestPlayerJoin,
  setOfflineState,
} from "../support/app.mjs";

test("approved player reconnects after offline interruption and catches up without losing role", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: playerContext, page: playerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(playerPage, baseURL, gameHash);
    await requestPlayerJoin(playerPage);
    await acceptPendingRequest(creatorPage);

    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");
    const playerHistoryCount = await getHistoryMoveCount(playerPage);

    await setOfflineState(playerPage, true);
    await makeAnyLegalMove(creatorPage, "p1");
    await expect(await getHistoryMoveCount(playerPage)).toBe(playerHistoryCount);

    await setOfflineState(playerPage, false);
    await expect
      .poll(async () => getHistoryMoveCount(playerPage), {
        message: "Expected the reconnected participant to catch up to the live move history",
      })
      .toBeGreaterThan(playerHistoryCount);

    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");
    await expect(playerPage.getByTestId("pending-player-request-notice")).toHaveCount(0);
    await expect(creatorPage.getByTestId("participant-player-2")).toContainText("Connected");
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(playerContext);
  }
});
