import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
  openDirectGameLink,
  openHistoryAndReturnLive,
  requestPlayerJoin,
} from "../support/app.mjs";

test("direct-link join request can be approved and stays correct through history and reload", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: requesterContext, page: requesterPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(creatorPage);
    await openDirectGameLink(requesterPage, baseURL, gameHash);
    await requestPlayerJoin(requesterPage);
    await acceptPendingRequest(creatorPage);

    await expect(requesterPage.getByTestId("game-role")).toContainText("Player 2");
    await expect(creatorPage.getByTestId("participant-player-2").getByRole("img",{name:"Connected",exact:true})).toBeVisible();

    const requesterHistoryCount = await getHistoryMoveCount(requesterPage);
    await makeAnyLegalMove(creatorPage, "p1");
    await expect
      .poll(async () => getHistoryMoveCount(requesterPage), {
        message: "Expected the approved participant to receive the live move",
      })
      .toBeGreaterThan(requesterHistoryCount);

    await openHistoryAndReturnLive(creatorPage);

    await requesterPage.reload();
    await expect(requesterPage.getByTestId("game-role")).toContainText("Player 2");
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(requesterContext);
  }
});
