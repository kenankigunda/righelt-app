import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  joinAsViewer,
  makeAnyLegalMove,
  openDirectGameLink,
  switchGamePanel,
} from "../support/app.mjs";

test("@smoke create-game, viewer-join, and live browser update", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: viewerContext, page: viewerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(viewerPage, baseURL, gameHash);
    await joinAsViewer(viewerPage);

    await switchGamePanel(creatorPage,'players');
    const viewers=creatorPage.getByTestId('viewers-section');
    await expect(viewers.getByRole('heading',{name:'Viewers',exact:true})).toBeVisible();
    await expect(viewers.locator('summary')).toHaveCount(0);
    await expect(creatorPage.getByTestId("participant-viewer")).toHaveCount(1);
    await expect(creatorPage.getByTestId("participant-viewer")).toBeVisible();
    await expect(creatorPage.getByTestId("participant-viewer").locator('[data-action="guest-profile"]')).toBeVisible();
    const viewerIdentity=await viewerPage.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
    expect(viewerIdentity).toBeTruthy();
    await expect(creatorPage.getByTestId("participant-viewer").locator('[data-action="guest-profile"]')).toHaveAttribute('data-identity-id',viewerIdentity);
    const viewerHistoryCount = await getHistoryMoveCount(viewerPage);
    await switchGamePanel(creatorPage,'board');

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
