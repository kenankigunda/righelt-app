import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  expectViewerFallbackJoinSurface,
  joinAsViewer,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

test("third browser falls back to viewer-only join when both player seats are already occupied", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: playerContext, page: playerPage } = await createIsolatedPage(browser);
  const { context: viewerContext, page: viewerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(playerPage, baseURL, gameHash);
    await requestPlayerJoin(playerPage);
    await acceptPendingRequest(creatorPage);
    await expect(playerPage.getByTestId("game-role")).toContainText("Player 2");

    await openDirectGameLink(viewerPage, baseURL, gameHash);
    await expectViewerFallbackJoinSurface(viewerPage);
    await joinAsViewer(viewerPage);

    await expect(viewerPage.getByTestId("game-role")).toContainText("Viewer");
    await expect(creatorPage.getByTestId("participant-viewer")).toBeVisible();
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(playerContext);
    await closeContextQuietly(viewerContext);
  }
});
