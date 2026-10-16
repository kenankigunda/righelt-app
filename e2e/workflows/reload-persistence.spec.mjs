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
  openHistoryMode,
  requestPlayerJoin,
  returnToLive,
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

    await playerPage.getByRole("button", { name: "Debug", exact: true }).click();
    await expect(playerPage.getByRole("heading", { name: "Debug mode", exact: true })).toBeVisible();
    // Debug is a saved preference. The bare game URL must restore it without
    // relying on a flyout query parameter to seed the initial render order.
    await playerPage.goto(`${baseURL}${gameHash.split("?")[0]}`);
    await playerPage.reload();
    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");
    await expectHistoryMoveCountToEqualOrExceed(playerPage, syncedHistoryCount);
    await expect(playerPage.getByRole("heading", { name: "Debug mode", exact: true })).toBeVisible();
    await expect(playerPage.getByTestId("pending-player-request-notice")).toHaveCount(0);
    const panelsScreenshot = test.info().outputPath("restored-panels.png");
    await playerPage.screenshot({ path: panelsScreenshot, fullPage: true });
    await test.info().attach("restored-panels", { path: panelsScreenshot, contentType: "image/png" });
    await playerPage.getByRole("button", { name: "Close Debug mode", exact: true }).click();
    await openHistoryMode(playerPage, 0);
    await expect(playerPage.getByTestId("history-return-live")).toBeVisible();
    await returnToLive(playerPage);
    await makeAnyLegalMove(playerPage, "p2");
    await expectHistoryMoveCountToEqualOrExceed(creatorPage, syncedHistoryCount + 1);
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(playerContext);
  }
});
