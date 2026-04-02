import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  ignorePendingRequest,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

test("ignored direct-link join requests remain pending in the workflow UI", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: requesterContext, page: requesterPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(requesterPage, baseURL, gameHash);
    await requestPlayerJoin(requesterPage);
    await ignorePendingRequest(creatorPage);

    await expect(creatorPage.getByTestId("pending-join-request")).toBeVisible();
    await expect(requesterPage.getByTestId("game-role")).toContainText("Viewer");
    await expect(requesterPage.getByTestId("pending-player-request-notice")).toBeVisible();
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(requesterContext);
  }
});
