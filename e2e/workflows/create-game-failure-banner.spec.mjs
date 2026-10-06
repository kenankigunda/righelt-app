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
    await page.getByTestId("home-create-game").click();await page.getByRole('button',{name:'Start a friend game',exact:true}).click();
    await page.getByRole("button", { name: "Close invite", exact: true }).click();

    const failureBanner = page.getByTestId("sync-failure-banner");
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(failureBanner).toContainText(
      "Game creation failed. The server could not create this game. Return home and try again.",
    );
    await expect(failureBanner.getByRole("button", { name: "Dismiss" })).toBeVisible();
    const surface = await failureBanner.evaluate(el=>({radius:getComputedStyle(el).borderRadius,clip:getComputedStyle(el).clipPath,background:getComputedStyle(el).backgroundColor}));
    expect(surface.radius).toBe("0px");
    expect(surface.clip).toContain("polygon");
    await page.screenshot({path:test.info().outputPath('failure-notice.png')});
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
