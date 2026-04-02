import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  joinAsViewer,
  makeAnyLegalMove,
  openDirectGameLink,
} from "../support/app.mjs";

test("@smoke create-game, viewer-join, and live browser update", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: viewerContext, page: viewerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(viewerPage, baseURL, gameHash);
    await joinAsViewer(viewerPage);

    await expect(creatorPage.getByTestId("participant-viewer")).toBeVisible();
    const viewerHistoryCount = await getHistoryMoveCount(viewerPage);

    await makeAnyLegalMove(creatorPage, "p1");
    await expect
      .poll(async () => getHistoryMoveCount(viewerPage), {
        message: "Expected the viewer browser to observe the creator's move",
      })
      .toBeGreaterThan(viewerHistoryCount);
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(viewerContext);
  }
});
