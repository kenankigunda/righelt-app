import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  expectHistoryMoveCountToEqualOrExceed,
  getHistoryMoveCount,
  makeAnyLegalMove,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

test("approved player reloads onto the latest live state without returning to guest or pending flow", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: playerContext, page: playerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(playerPage, baseURL, gameHash);
    await requestPlayerJoin(playerPage);
    await acceptPendingRequest(creatorPage);

    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");
    const beforeMoves = await getHistoryMoveCount(playerPage);

    await makeAnyLegalMove(creatorPage, "p1");
    await expectHistoryMoveCountToEqualOrExceed(playerPage, beforeMoves + 1);
    const syncedHistoryCount = await getHistoryMoveCount(playerPage);

    await playerPage.reload();
    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");
    await expectHistoryMoveCountToEqualOrExceed(playerPage, syncedHistoryCount);
    await expect(playerPage.getByTestId("pending-player-request-notice")).toHaveCount(0);
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(playerContext);
  }
});
