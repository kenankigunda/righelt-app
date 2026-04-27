import { test, expect } from "@playwright/test";

import { closeContextQuietly, createIsolatedPage, openStartGamePicker } from "../support/app.mjs";

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

    await openStartGamePicker(page);
    await page.getByTestId("start-mode-friend").getByRole("button", { name: "Play with a friend" }).click();

    const failureBanner = page.getByTestId("sync-failure-banner");
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(failureBanner).toContainText(
      "Game creation failed. The server could not create this game. Return home and try again.",
    );
    await expect(failureBanner.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(page.getByText("Latest: Game creation failed")).toBeVisible();
    await page.waitForTimeout(4_000);
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(failureBanner).toContainText(
      "Game creation failed. The server could not create this game. Return home and try again.",
    );
    await failureBanner.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("sync-failure-banner")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});
