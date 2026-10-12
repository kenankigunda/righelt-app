import { test, expect } from "@playwright/test";

const cell = (page, row, col) => page.locator(`.cell[data-row="${row}"][data-col="${col}"]`);
for (const type of ["rush", "retreat", "follow"]) {
  test(`${type} preview remains clickable after refresh under a stationary pointer`, async ({ page }) => {
    await page.goto("/browser-integration/support/board.html");
    await page.waitForFunction(() => window.fixtureReady);
    await page.evaluate(type => window.boardFixture.setup(type), type);
    if (type === "rush") await cell(page, 4, 2).click();
    await cell(page, 4, 3).hover();
    await expect.poll(() => page.evaluate(() => window.boardFixture.selection().target)).toEqual({ row: 4, col: 3 });
    await page.evaluate(() => window.boardFixture.refresh());
    await expect.poll(() => page.evaluate(() => window.boardFixture.selection().target)).toBeNull();
    // No locator click or mouse movement: neither may repair the missing hover event.
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.boardFixture.applied())).toEqual([
      { type, actorId: "A", from: { row: 4, col: 2 }, to: { row: 4, col: 3 } },
    ]);
  });
}

test("repeated preview clicks submit once while the host response is pending", async ({ page }) => {
  await page.goto("/browser-integration/support/board.html");
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(() => window.boardFixture.setup());
  await cell(page, 4, 2).click();
  await cell(page, 4, 3).hover();
  await page.evaluate(() => window.boardFixture.hold());
  await page.mouse.down(); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up();
  expect(await page.evaluate(() => window.boardFixture.applied().length)).toBe(1);
  await page.evaluate(() => window.boardFixture.release());
});

test("snapshot refresh between pointer down and up keeps the pressed cell mounted", async ({ page }) => {
  await page.goto("/browser-integration/support/board.html");
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(() => window.boardFixture.setup());
  await cell(page, 4, 2).click();
  await cell(page, 4, 3).hover();
  await page.evaluate(() => { window.pressedCell = document.querySelector('.cell[data-row="4"][data-col="3"]'); });
  await page.mouse.down();
  await page.evaluate(() => window.boardFixture.refresh());
  expect(await page.evaluate(() => window.pressedCell.isConnected)).toBe(true);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.boardFixture.applied().length)).toBe(1);
});
