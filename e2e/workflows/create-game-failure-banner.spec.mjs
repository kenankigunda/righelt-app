import { test, expect } from "@playwright/test";

import { closeContextQuietly, createIsolatedPage } from "../support/app.mjs";

test("create-game shows an alert banner when the server rejects the create response", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.route("**/api/shell/games", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "forced_create_failure" }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();

    const failureBanner = page.locator(".shell-game-alert");
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(failureBanner).toContainText(
      "Game creation failed. The server could not create this game. Return home and try again.",
    );
    await expect(page.getByText("Latest: Game creation failed")).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(failureBanner).toContainText(
      "Game creation failed. The server could not create this game. Return home and try again.",
    );
  } finally {
    await closeContextQuietly(context);
  }
});
