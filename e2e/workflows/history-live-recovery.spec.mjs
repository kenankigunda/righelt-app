import { test, expect } from "@playwright/test";

import {
  createGameFromHome,
  getHistoryMoveCount,
  makeAnyLegalMove,
  openHistoryMode,
  returnToLive,
} from "../support/app.mjs";

test("returning Live cancels obsolete History hydration without surrendering current authority", async ({ page }) => {
  const { gameId } = await createGameFromHome(page);
  await page.locator('[data-action="play-as-both-players"]').click();
  await expect(page.getByTestId("game-role")).toContainText("both players");
  await makeAnyLegalMove(page, "p1");
  await makeAnyLegalMove(page, "p2");
  await openHistoryMode(page, 0);

  let releaseDelivery;
  const deliveryGate = new Promise(resolve => { releaseDelivery = resolve; });
  let heldRequest = null;
  let snapshotReads = 0;
  let archiveReads = 0;
  let retiredRouteReads = 0;
  let heldResponseReady = false;
  let heldRequestCancelled = false;
  const onRequestFailed = request => {
    if (request === heldRequest) heldRequestCancelled = true;
  };
  page.on("requestfailed", onRequestFailed);

  await page.route(`**/api/shell/games/${gameId}/**`, async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.split("/").at(-1);
    if (endpoint === "history" || endpoint === "live") {
      retiredRouteReads += 1;
      await route.abort();
      return;
    }
    if (endpoint === "decision-history") archiveReads += 1;
    if (endpoint !== "decision-snapshot") {
      await route.continue();
      return;
    }
    snapshotReads += 1;
    if (heldRequest) {
      await route.continue();
      return;
    }
    heldRequest = request;
    const response = await route.fetch();
    heldResponseReady = true;
    await deliveryGate;
    try {
      await route.fulfill({ response });
    } catch (error) {
      if (!heldRequestCancelled) throw error;
    }
  });

  try {
    const beforeSelection = await getHistoryMoveCount(page);
    await openHistoryMode(page, 1);
    await expect.poll(() => snapshotReads, {
      message: "Expected History selection to reach the current decision-snapshot boundary",
    }).toBe(1);
    await expect.poll(() => heldResponseReady, {
      message: "Expected the real snapshot response to be held before client delivery",
    }).toBe(true);
    expect(archiveReads).toBe(0);
    expect(retiredRouteReads, "Retired /history and /live routes must never own this proof").toBe(0);

    await returnToLive(page);
    await expect.poll(() => heldRequestCancelled, {
      message: "Expected Return to Live to abort the obsolete optional snapshot consumer",
    }).toBe(true);
    await expect(page).toHaveURL(new RegExp(`#\\/game\\/${gameId}(?:\\?|$)`));
    await expect(page.getByTestId("game-shell")).toHaveAttribute("data-game-id", gameId);
    await expect(page.getByTestId("history-return-live")).toHaveCount(0);
    await expect(page.getByTestId("game-role")).toContainText("both players");

    await makeAnyLegalMove(page, "p2");
    await expect.poll(() => getHistoryMoveCount(page), {
      message: "Expected current live authority to admit the next self-play action",
    }).toBeGreaterThan(beforeSelection);
    expect(snapshotReads).toBe(1);
    expect(retiredRouteReads).toBe(0);
  } finally {
    releaseDelivery?.();
    page.off("requestfailed", onRequestFailed);
    await page.unrouteAll({ behavior: "wait" });
  }
});
