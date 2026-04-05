import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

test("scenario flyout can save the current board and load that scenario into a new empty game", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const scenarioTitle = `Tester scenario ${Date.now()}`;
    const scenarioDescription = "Saved from the browser flow and then loaded back into a fresh game.";
    let savedScenario = null;

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: savedScenario ? [savedScenario] : [],
        }),
      });
    });

    await page.route("**/scenarios/save", async (route) => {
      const requestBody = route.request().postDataJSON();
      savedScenario = requestBody?.scenario ?? null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          catalog: {
            id: "S",
            title: "Saved Scenarios",
            scenarios: savedScenario ? [savedScenario] : [],
          },
        }),
      });
    });

    await createGameFromHome(page);
    await makeAnyLegalMove(page, "p1");

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();

    await page.locator('[data-scenario-save-field="title"]').fill(scenarioTitle);
    await page.locator('[data-scenario-save-field="description"]').fill(scenarioDescription);
    await page.locator('[data-action="save-scenario"]').click();

    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(scenarioTitle);
    await expect(page.locator("#scenario-select")).toContainText(scenarioTitle);

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    const initialHistoryCount = await getHistoryMoveCount(page);
    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(scenarioTitle);
    await expect(page.locator('[data-action="load-scenario"]')).toHaveText("Load into This Game");

    await page.locator('[data-action="load-scenario"]').click();

    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected loading the saved scenario to replace the empty game with the saved scenario history",
      })
      .toBeGreaterThan(initialHistoryCount);
    await expect(page.locator('[data-testid="scenario-load-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-scenario-editable="title"]')).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});
