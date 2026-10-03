import { expectMobileDockClear } from "../support/mobile-dock.mjs";
import { test, expect } from "@playwright/test";
import { createGameFromHome, getHistoryMoveCount, makeAnyLegalMove, openHistoryMode } from "../support/app.mjs";

const firstAction = (page) => page.evaluate(async () => {
  const id = location.hash.match(/game\/([^?]+)/)[1];
  const response = await fetch(`/api/shell/games/${id}?identityId=${localStorage.getItem("righelt.identity.id.v1")}`);
  return (await response.json()).game.legalActions.find((action) => action.from && action.to && action.type === "move");
});
const cell = (page, coord) => page.locator(`#shell-board [data-row="${coord.row}"][data-col="${coord.col}"]`);

test("phone previews the actual move before a second tap, with stable board and nonmodal help", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createGameFromHome(page);
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  const action = await firstAction(page);
  const before = await getHistoryMoveCount(page);
  const board = page.getByTestId("game-board");
  const bounds = await board.boundingBox();
  await cell(page, action.from).click();
  await cell(page, action.to).click();
  await expect(page.locator("#shell-board-preview-label")).toContainText("Preview.");
  expect(await getHistoryMoveCount(page)).toBe(before);
  await expect(cell(page, action.to)).toHaveClass(/preview-change/);
  expect((await board.boundingBox()).width).toBeCloseTo(bounds.width, 0);
  expect((await board.boundingBox()).height).toBeCloseTo(bounds.height, 0);
  await page.getByRole("button", { name: "Explain", exact: true }).click();
  await expect(page.locator('[data-zone="game-help"]')).not.toHaveAttribute("role", "dialog");
  await expect(page.getByRole("button", { name: "Explain", exact: true })).toHaveAttribute("aria-pressed", "true");
  await cell(page, action.to).click();
  await expect.poll(() => getHistoryMoveCount(page)).toBeGreaterThan(before);
  await expect(page.getByRole("button", { name: "Explain", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".game-help-copy")).not.toContainText("Activate this destination again");
  await testInfo.attach("phone-play-shell", { body: await page.screenshot({ path: testInfo.outputPath("phone.png") }), contentType: "image/png" });
});

test("keyboard cell activation previews then confirms and keeps a single board tab stop", async ({ page }) => {
  await createGameFromHome(page);
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  const action = await firstAction(page);
  const before = await getHistoryMoveCount(page);
  await cell(page, action.from).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, { row: action.from.row, col: Math.min(9, action.from.col + 1) })).toBeFocused();
  await cell(page, action.to).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#shell-board-preview-label")).toContainText("Preview.");
  await expect(cell(page, action.to)).toBeFocused();
  expect(await getHistoryMoveCount(page)).toBe(before);
  await page.keyboard.press("Space");
  await expect.poll(() => getHistoryMoveCount(page)).toBeGreaterThan(before);
  expect(await page.locator('#shell-board .cell[tabindex="0"]').count()).toBe(1);
});

test("browser back reverses the sweep and restores the originating home card", async ({ page }) => {
  const { gameId } = await createGameFromHome(page);
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  await page.getByRole("link", { name: "Righelt", exact: true }).click();
  const card = page.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  await page.goBack();
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-direction", "back");
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  await expect(card).toBeFocused();
});

test("failed game hydration offers retry and home rather than a stranded cover", async ({ page }) => {
  await page.goto("/#/game/does-not-exist");
  await expect(page.getByRole("heading", { name: "Game unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Game unavailable" })).toBeVisible();
  await page.getByRole("link", { name: "Back to home", exact: true }).click();
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
});

for (const viewport of [{ width: 320, height: 740 }, { width: 812, height: 375 }, { width: 1100, height: 900 }, { width: 1600, height: 1000 }]) {
  test(`play shell fits ${viewport.width}×${viewport.height} with reachable board targets`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await createGameFromHome(page);
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
    const board = page.getByTestId("game-board");
    const bounds = await board.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    const firstCell = await page.locator("#shell-board .cell").first().boundingBox();
    expect(firstCell.width).toBeGreaterThanOrEqual(24);
    expect(firstCell.height).toBeGreaterThanOrEqual(24);
    const lastCell = await page.locator("#shell-board .cell").last().boundingBox();
    expect(lastCell.x + lastCell.width).toBeLessThanOrEqual(viewport.width);
    const action = await firstAction(page);
    await cell(page, action.from).click();
    await page.getByRole("button", { name: "Explain", exact: true }).click();
    await cell(page, action.to).click();
    await expect(page.locator("#shell-board-preview-label")).toContainText("Preview.");
    await testInfo.attach("responsive-play-shell", { body: await page.screenshot({ path: testInfo.outputPath(`play-${viewport.width}.png`) }), contentType: "image/png" });
  });
}

test("opening a flyout while home is loading does not cancel its hydration", async ({ page }) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/shell/games?**", async (route) => { await gate; await route.continue(); });
  await page.goto("/");
  await expect(page.getByTestId("home-section-skeleton").first()).toBeVisible();
  await page.evaluate(() => { location.hash = "#/?scenarios=1"; });
  release();
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await expect(page.getByTestId("home-section-skeleton")).toHaveCount(0);
});

test("returning to an unchanged game restores the selected history snapshot", async ({ page }) => {
  const { gameId } = await createGameFromHome(page);
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  await makeAnyLegalMove(page);
  await openHistoryMode(page, 0);
  await page.getByRole("link", { name: "Righelt", exact: true }).click();
  await page.locator(`.mini-board-card-link-surface[data-game-id="${gameId}"]`).click();
  await expect(page.getByTestId("history-return-live")).toBeVisible();
});

test("a late game response cannot replace the newer home destination", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  await page.route("**/api/shell/games/delayed-missing?**", async (route) => { started(); await gate; await route.continue(); });
  await page.evaluate(() => { location.hash = "#/game/delayed-missing"; });
  await requested;
  await page.evaluate(() => { location.hash = "#/"; });
  release();
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
  await expect(page.getByRole("heading", { name: "Game unavailable" })).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 540 }]) {
  test(`mobile help leaves navigation reachable after document scroll ${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await createGameFromHome(page);
    await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
    const help = page.locator(".game-help");
    for (const expanded of [true, false]) {
      const control = help.getByRole("button", { name: expanded ? "Expand" : "Collapse", exact: true });
      if (await control.isVisible()) await control.click();
      await expect(help).toHaveAttribute("data-expanded", String(expanded));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
      await expectMobileDockClear(page);
      for (const panel of ["players", "history", "board"]) {
        await page.locator(`.shell-mobile-tabbar [data-panel="${panel}"]`).click();
        await expect(page.locator("#app")).toHaveAttribute("data-shell-game-panel", panel);
        await expectMobileDockClear(page);
      }
    }
    await info.attach("scrolled-mobile-docks", { body: await page.screenshot(), contentType: "image/png" });
  });
}
