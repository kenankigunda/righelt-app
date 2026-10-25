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
  switchGamePanel,
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
    await switchGamePanel(creatorPage,'players');
    const viewers=creatorPage.locator('[data-action="toggle-viewers"]');
    await expect(viewers).toHaveAccessibleName(/^Viewers: /);
    await expect(viewers).toHaveAttribute('aria-expanded','false');
    await viewers.click();await expect(viewers).toHaveAttribute('aria-expanded','true');
    await expect(creatorPage.getByTestId("participant-viewer")).toHaveCount(1);
    await expect(creatorPage.getByTestId("participant-viewer")).toBeVisible();
    await expect(creatorPage.getByTestId("participant-viewer").locator('[data-action="guest-profile"]')).toBeVisible();
    const viewerIdentity=await viewerPage.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
    expect(viewerIdentity).toBeTruthy();
    await expect(creatorPage.getByTestId("participant-viewer").locator('[data-action="guest-profile"]')).toHaveAttribute('data-identity-id',viewerIdentity);
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(playerContext);
    await closeContextQuietly(viewerContext);
  }
});
