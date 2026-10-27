import { test, expect } from "@playwright/test";
import { ensureActionActorSelected } from "../e2e/support/app.mjs";

const cell = (page, row, col) => page.locator(`.cell[data-row="${row}"][data-col="${col}"]`);

test('a pending control preserves a prepared destination until a fresh native confirmation', async ({ page }) => {
  await page.goto('/browser-integration/support/board.html');
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(() => window.boardFixture.setup('move'));
  await cell(page, 4, 2).click(); await cell(page, 4, 3).hover();
  const prepared = await page.evaluate(() => window.boardFixture.selection());
  expect(prepared).toEqual({selectedPieceId:'A',source:{row:4,col:2},target:{row:4,col:3}});
  await page.evaluate(() => window.boardFixture.gateInteraction(true));
  await expect(cell(page, 4, 3)).toHaveClass(/unselectable/);
  await cell(page, 4, 3).click();
  expect(await page.evaluate(() => window.boardFixture.selection())).toEqual(prepared);
  expect(await page.evaluate(() => window.boardFixture.applied())).toEqual([]);
  await page.evaluate(() => window.boardFixture.gateInteraction(false));
  expect(await page.evaluate(() => window.boardFixture.selection())).toEqual(prepared);
  expect(await page.evaluate(() => window.boardFixture.applied())).toEqual([]);
  await cell(page, 4, 3).click();
  await expect.poll(() => page.evaluate(() => window.boardFixture.applied())).toEqual([
    {type:'move',actorId:'A',from:{row:4,col:2},to:{row:4,col:3}},
  ]);
});

test('status-only control settlement restores actionable destination styling without pointer movement', async ({ page }) => {
  await page.goto('/browser-integration/support/board.html');
  await page.waitForFunction(() => window.fixtureReady);
  await page.evaluate(() => window.boardFixture.setup('move'));
  await cell(page, 4, 2).click(); await cell(page, 4, 3).hover();
  const prepared = await page.evaluate(() => window.boardFixture.selection());
  await page.evaluate(() => window.boardFixture.gateInteraction(true));
  await expect(cell(page, 4, 3)).toHaveClass(/unselectable/);
  await page.evaluate(() => window.boardFixture.gateInteraction(false));
  await expect(cell(page, 4, 3)).not.toHaveClass(/unselectable/);
  await expect(cell(page, 4, 3)).toHaveClass(/(?:^|\s)target(?:\s|$)/);
  expect(await page.evaluate(() => window.boardFixture.selection())).toEqual(prepared);
  expect(await page.evaluate(() => window.boardFixture.applied())).toEqual([]);
});


for (const lateSnapshot of [false, true]) {
  test(`mandatory actor preparation preserves native previews with ${lateSnapshot ? "a late restored selection" : "a cleared selection"}`, async ({ page }) => {
    await page.goto("/browser-integration/support/board.html");
    await page.waitForFunction(() => window.fixtureReady);
    await page.evaluate(() => window.boardFixture.setup("retreat"));
    const source = cell(page, 4, 2), target = cell(page, 4, 3);
    await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);
    // Real invalid native input clears the actor. Do not alter classes or
    // assign runtime selection to create either side of the race.
    await cell(page, 2, 2).click();
    await expect(source).not.toHaveClass(/(?:^|\s)source(?:\s|$)/);
    expect(await page.evaluate(() => window.boardFixture.applied())).toEqual([]);
    if (lateSnapshot) {
      await page.evaluate(() => window.boardFixture.rehydrateCurrent());
      await expect(source).toHaveClass(/(?:^|\s)source(?:\s|$)/);
    }
    await page.evaluate(() => {
      window.actorPresses = 0;
      document.querySelector("#board").addEventListener("mousedown", event => {
        if (event.target.closest('.cell[data-row="4"][data-col="2"]')) window.actorPresses++;
      });
    });
    await ensureActionActorSelected(source);
    await target.hover();
    await expect(target, "Preparation must retain the real runtime's legal action preview").toHaveClass(/(?:^|\s)target(?:\s|$)/);
    expect(await page.evaluate(() => window.actorPresses)).toBe(lateSnapshot ? 0 : 1);
    expect(await page.evaluate(() => window.boardFixture.applied())).toEqual([]);
    // Intentional user reclicks must still toggle away and back. The repair
    // belongs to the test preparation, not to the product's reclick behavior.
    await source.click();
    await target.hover();
    await expect(target).toHaveClass(/(?:^|\s)unselectable(?:\s|$)/);
    await source.click();
    await target.hover();
    await expect(target).toHaveClass(/(?:^|\s)target(?:\s|$)/);
    await target.click();
    await expect.poll(() => page.evaluate(() => window.boardFixture.applied())).toEqual([
      {type: "retreat", actorId: "A", from: {row: 4, col: 2}, to: {row: 4, col: 3}},
    ]);
    expect(await page.evaluate(() => window.actorPresses)).toBe(lateSnapshot ? 2 : 3);
  });
}

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
