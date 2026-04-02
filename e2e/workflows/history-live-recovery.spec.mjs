import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
  openDirectGameLink,
  openHistoryMode,
  requestPlayerJoin,
  returnToLive,
} from "../support/app.mjs";

test("history mode stays latched while live updates append and return-to-live restores the latest state", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: playerContext, page: playerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(playerPage, baseURL, gameHash);
    await requestPlayerJoin(playerPage);
    await acceptPendingRequest(creatorPage);
    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");

    await makeAnyLegalMove(creatorPage, "p1");
    const historyCountBeforeSelection = await getHistoryMoveCount(creatorPage);
    await openHistoryMode(creatorPage, 0);

    await makeAnyLegalMove(playerPage, "p2");
    await expect
      .poll(async () => getHistoryMoveCount(creatorPage), {
        message: "Expected live updates to append while the creator remains in history mode",
      })
      .toBeGreaterThan(historyCountBeforeSelection);

    await expect(creatorPage.getByTestId("history-return-live")).toBeVisible();
    await returnToLive(creatorPage);
    await expect(creatorPage.getByTestId("history-return-live")).toHaveCount(0);
    await expect(creatorPage.getByTestId("game-role")).toContainText("Player 1");
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(playerContext);
  }
});
