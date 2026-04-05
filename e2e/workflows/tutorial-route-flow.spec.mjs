import { test, expect } from "@playwright/test";

import { buildAppUrl, closeContextQuietly, createGameFromHome, createIsolatedPage } from "../support/app.mjs";

test("tutorial route advances, completes back into the game, and resets for a later revisit", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { gameId } = await createGameFromHome(page);
    await page.goto(buildAppUrl(baseURL, `#/tutorial/${encodeURIComponent(gameId)}`));

    await expect(page.getByText("Step 1 of 5")).toBeVisible();
    await page.locator('[data-action="tutorial-next"]').click();
    await expect(page.getByText("Step 2 of 5")).toBeVisible();

    await page.locator('[data-action="tutorial-skip"]').click();
    await expect(page.getByText("Step 3 of 5")).toBeVisible();

    await page.locator('[data-action="tutorial-complete"]').click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#\\/game\\/${encodeURIComponent(gameId)}$`));
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("righelt.tutorial.done.v1")))
      .toBe("1");

    await page.goto(buildAppUrl(baseURL, `#/tutorial/${encodeURIComponent(gameId)}`));
    await expect(page.getByText("Step 1 of 5")).toBeVisible();
  } finally {
    await closeContextQuietly(context);
  }
});
