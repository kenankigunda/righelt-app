import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createGamesViaApi,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

test("home cards render, open the full game, and refresh after live progress", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { gameId } = await createGameFromHome(page);

    await page.getByRole("link", { name: "Righelt" }).click();
    const homeCard = page.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`).first();
    await expect(homeCard).toBeVisible();
    await expect(homeCard.locator("[data-mini-board-preview]")).toBeVisible();
    await expect(homeCard).toContainText("Move 1");
    const preview = homeCard.locator('[data-mini-board-preview]');
    await expect(preview.locator('.cell').first()).toBeVisible();
    // Exercise the parent patch against a real mounted renderer, including its
    // unchanged-key fast path. Declarative markup contains no renderer children.
    await homeCard.evaluate(async card => {
      const { patchSectionContent } = await import('/shell/dom-patch.js');
      const root = card.querySelector('[data-mini-board-preview]');
      window.retainedPreviewCell = root.querySelector('.cell');
      const next = card.cloneNode(true);
      next.querySelector('[data-mini-board-preview]').replaceChildren();
      patchSectionContent(card,next);
    });
    expect(await preview.evaluate(root => root.contains(window.retainedPreviewCell))).toBe(true);
    await expect(preview).toHaveClass(/mini-board-preview-root/);

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
    const updatedCard = page.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`).first();
    await expect(updatedCard).toBeVisible();
    await expect(updatedCard).toContainText("Move 2");
    await expect(updatedCard.locator(".mini-board-preview-status")).toContainText("Player 2 to play");
  } finally {
    await closeContextQuietly(context);
  }
});

test("live updates only refresh the moved game's home preview and leave neighboring cards isolated", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const createdGameIds = await createGamesViaApi(page, 2);
    const stationaryGameId = createdGameIds[0];
    const movedGameId = createdGameIds[1];

    await page.goto("/");

    const stationaryCard = page.locator(`[data-game-id="${stationaryGameId}"]`).first();
    await expect(stationaryCard).toBeVisible();
    await expect(stationaryCard).toContainText("Move 1");
    await expect(stationaryCard.locator(".mini-board-preview-status")).toContainText("Player 1 to play");

    await page.locator(`[data-game-id="${movedGameId}"]`).first().click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await makeAnyLegalMove(page, "p1");

    await page.getByRole("link", { name: "Righelt" }).click();
    const movedCard = page.locator(`[data-game-id="${movedGameId}"]`).first();
    await expect(movedCard).toContainText("Move 2");
    await expect(movedCard.locator(".mini-board-preview-status")).toContainText("Player 2 to play");

    await expect(stationaryCard).toContainText("Move 1");
    await expect(stationaryCard.locator(".mini-board-preview-status")).toContainText("Player 1 to play");
  } finally {
    await closeContextQuietly(context);
  }
});
