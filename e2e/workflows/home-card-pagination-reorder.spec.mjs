import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGamesViaApi,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

test("home pagination refreshes correctly when a moved game reorders onto an earlier page", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const createdGameIds = await createGamesViaApi(page, 5);
    const oldestGameId = createdGameIds[0];
    await page.goto("/");

    const mySection = page.locator('[data-home-section-root="my"]');
    await expect(mySection).toBeVisible();
    await expect(mySection).toContainText("Page 1 of 2");

    await mySection.locator('[data-action="home-page-next"]').click();
    await expect(mySection).toContainText("Page 2 of 2");
    const pageTwoCard = page.locator(`[data-game-id="${oldestGameId}"]`).first();
    await expect(pageTwoCard).toBeVisible();

    await pageTwoCard.click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await page.getByRole("button", {name:"Play both sides",exact:true}).click();
    const initialHistoryCount = await getHistoryMoveCount(page);
    await makeAnyLegalMove(page, "p1");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected the reordered game to record a move before returning home",
      })
      .toBeGreaterThan(initialHistoryCount);

    await page.getByRole("link", { name: "Righelt" }).click();
    await expect(mySection).toContainText("Page 2 of 2");
    await expect(page.locator(`[data-game-id="${oldestGameId}"]`)).toHaveCount(0);

    await mySection.locator('[data-action="home-page-prev"]').click();
    await expect(mySection).toContainText("Page 1 of 2");
    const reorderedCard = page.locator(`[data-game-id="${oldestGameId}"]`).first();
    await expect(reorderedCard).toBeVisible();
    await expect(reorderedCard).toContainText("Move 2");
    await expect(reorderedCard.locator(".mini-board-preview-status")).toContainText("Blue to play");
  } finally {
    await closeContextQuietly(context);
  }
});

test("home header pagination is visible at narrow viewport with a multi-column grid", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.setViewportSize({ width: 850, height: 1100 });
    await createGamesViaApi(page, 5);
    await page.goto("/");

    const mySection = page.locator('[data-home-section-root="my"]');
    await expect(mySection).toBeVisible();

    const headerPaging = mySection.locator(".home-games-section-controls-header");
    await expect(headerPaging).toBeVisible();
    await expect(headerPaging).toContainText("Page 1 of 2");
    await expect(mySection.locator(".home-games-section-controls-footer")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});

test("home pagination keeps both arrows and its label on one line across layouts", async ({ browser }, testInfo) => {
  const { context, page } = await createIsolatedPage(browser);
  try {
    await createGamesViaApi(page, 5);
    await page.goto("/");
    const section = page.locator('[data-home-section-root="my"]');
    for (const width of [1440, 1100, 901, 900, 850, 600, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      const controls = section.locator('.home-games-section-controls:visible');
      await expect(controls).toHaveCount(1);
      await expect.poll(() => controls.evaluate(element => {
        const parts = [...element.children].map(child => child.getBoundingClientRect());
        const centers = parts.map(rect => rect.top + rect.height / 2);
        return Math.max(...centers) - Math.min(...centers);
      }), { message: `Pagination must share a line at ${width}px` }).toBeLessThan(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      if (width === 1440 || width === 390) {
        await section.screenshot({ path: testInfo.outputPath(`pagination-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const controls = section.locator('.home-games-section-controls:visible');
    await expect.poll(() => controls.evaluate(element => {
      const centers = [...element.children].map(child => { const r = child.getBoundingClientRect(); return r.top + r.height / 2; });
      return Math.max(...centers) - Math.min(...centers);
    })).toBeLessThan(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await controls.locator('[data-action="home-page-next"]').click();
    await expect(section).toContainText('Page 2 of');
  } finally {
    await closeContextQuietly(context);
  }
});
