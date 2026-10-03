import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGamesViaApi,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

test("resume pagination keeps waiting games after games awaiting your turn", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const createdGameIds = await createGamesViaApi(page, 5);
    const oldestGameId = createdGameIds[0];
    await page.goto("/");

    const mySection = page.locator('[data-zone="home-resume"]');
    await expect(mySection).toBeVisible();
    await expect(mySection).toContainText("Page 1 of 2");

    await mySection.locator('[data-action="resume-page"][data-page="1"]').click();
    await expect(mySection).toContainText("Page 2 of 2");
    const pageTwoCard = page.locator(`[data-game-id="${oldestGameId}"]`).first();
    await expect(pageTwoCard).toBeVisible();

    await pageTwoCard.click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    const initialHistoryCount = await getHistoryMoveCount(page);
    await makeAnyLegalMove(page, "p1");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected the reordered game to record a move before returning home",
      })
      .toBeGreaterThan(initialHistoryCount);

    await page.getByRole("link", { name: "Righelt" }).click();
    await expect(mySection).toContainText("Page 2 of 2");
    await expect(page.locator(`[data-game-id="${oldestGameId}"]`).first()).toContainText("Move 2");

    await mySection.locator('[data-action="resume-page"][data-page="0"]').click();
    await expect(mySection).toContainText("Page 1 of 2");
    await expect(page.locator(`[data-game-id="${oldestGameId}"]`)).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});

test("resume pagination remains visible at a narrow multi-column viewport", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.setViewportSize({ width: 850, height: 1100 });
    await createGamesViaApi(page, 5);
    await page.goto("/");

    const mySection = page.locator('[data-zone="home-resume"]');
    await expect(mySection).toBeVisible();

    const headerPaging = mySection.locator(".resume-pagination");
    await expect(headerPaging).toBeVisible();
    await expect(headerPaging).toContainText("Page 1 of 2");
    await expect(mySection.locator(".home-games-section-controls-footer")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});
