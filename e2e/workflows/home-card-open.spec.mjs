import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

test("home cards render, open the full game, and refresh after live progress", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { gameId } = await createGameFromHome(page);

    await page.getByRole("link", { name: "Righelt" }).click();
    const homeCard = page.locator(`[data-game-id="${gameId}"]`).first();
    await expect(homeCard).toBeVisible();
    await expect(homeCard.locator("[data-mini-board-preview]")).toBeVisible();
    await expect(homeCard).toContainText("Move 1");

    await homeCard.click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByTestId("game-role")).toContainText("Player 1");

    const historyCount = await getHistoryMoveCount(page);
    await makeAnyLegalMove(page, "p1");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected the game shell to record a move after opening from the home card",
      })
      .toBeGreaterThan(historyCount);

    await page.getByRole("link", { name: "Righelt" }).click();
    const updatedCard = page.locator(`[data-game-id="${gameId}"]`).first();
    await expect(updatedCard).toBeVisible();
    await expect(updatedCard).toContainText("Move 2");
    await expect(updatedCard.locator(".mini-board-preview-status")).toContainText("Player 2 to play");
  } finally {
    await closeContextQuietly(context);
  }
});
