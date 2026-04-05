import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  makeAnyLegalMove,
  openPendingHistoryBranchFromMove,
} from "../support/app.mjs";

test("history branch popup shows a failure banner when branch creation is rejected", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  let releaseBranchFailure = null;
  const allowBranchFailure = new Promise((resolve) => {
    releaseBranchFailure = resolve;
  });
  const branchRequestSeen = new Promise((resolve) => {
    context.route("**/api/shell/history/branch", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      resolve();
      await allowBranchFailure;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "forced_branch_failure" }),
      });
    });
  });

  try {
    const { gameHash } = await createGameFromHome(page);
    await makeAnyLegalMove(page, "p1");

    const { popup, gameId } = await openPendingHistoryBranchFromMove(page, 0);
    await branchRequestSeen;

    await expect(page).toHaveURL(new RegExp(`${gameHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByTestId("sync-failure-banner")).toHaveCount(0);
    await expect(popup.getByTestId("game-shell")).toBeVisible();
    await expect(popup.getByText("Latest: History branch pending sync")).toBeVisible();

    releaseBranchFailure?.();

    const failureBanner = popup.getByTestId("sync-failure-banner");
    await expect(popup).toHaveURL(new RegExp(`#\\/game\\/${gameId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(failureBanner).toContainText("forced_branch_failure");
    await expect(failureBanner.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await failureBanner.getByRole("button", { name: "Dismiss" }).click();
    await expect(popup.getByTestId("sync-failure-banner")).toHaveCount(0);
    await expect(popup.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByTestId("sync-failure-banner")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});
