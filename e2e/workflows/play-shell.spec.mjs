import { test, expect } from "@playwright/test";
import { createGameFromHome, getHistoryMoveCount } from "../support/app.mjs";

const firstAction = (page) => page.evaluate(async () => {
  const id = location.hash.match(/game\/([^?]+)/)[1];
  const response = await fetch(`/api/shell/games/${id}?identityId=${localStorage.getItem("righelt.identity.id.v1")}`);
  return (await response.json()).game.legalActions.find((action) => action.from && action.to && action.type === "move");
});
const cell = (page, coord) => page.locator(`#shell-board [data-row="${coord.row}"][data-col="${coord.col}"]`);

test("phone previews the actual move before a second tap, with stable board and nonmodal help", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createGameFromHome(page);
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
  await testInfo.attach("phone-play-shell", { body: await page.screenshot({ path: testInfo.outputPath("phone.png") }), contentType: "image/png" });
});

test("keyboard cell activation previews then confirms and keeps a single board tab stop", async ({ page }) => {
  await createGameFromHome(page);
  const action = await firstAction(page);
  const before = await getHistoryMoveCount(page);
  await cell(page, action.from).focus();
  await page.keyboard.press("Enter");
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
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await expect(page.locator(".shell-route-transition-layer")).toHaveAttribute("data-active", "false");
});
