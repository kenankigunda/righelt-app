import { test, expect } from "@playwright/test";
import { enterUsername } from "./helpers.mjs";
const dialog = page => page.getByTestId("account-dialog");
test.beforeEach(async () => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).status).toBe(200);
});

test("correctable creation errors preserve the username and allow correction without leaving the form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  const username = `Form_${Date.now().toString(36)}`;
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill("password");
  const width = (await dialog(page).boundingBox()).width;
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).not.toHaveText("");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(username);
  expect((await dialog(page).boundingBox()).width).toBe(width);
  await expect(dialog(page).getByLabel("Display name (optional)", { exact: true })).toHaveCount(0);
  await expect(dialog(page).getByRole("checkbox")).toHaveCount(0);
  await dialog(page).getByLabel("Password", { exact: true }).fill("An accessible account password 428");
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
});

test("account controls remain reachable when enlarged and when the available mobile height shrinks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  // CSS enlargement proves layout; physical browser zoom and the iPhone
  // software keyboard remain separately recorded manual acceptance.
  await page.addStyleTag({ content: ".account-dialog { zoom: 2; }" });
  await expect(dialog(page)).toHaveCSS("zoom", "2");
  await enterUsername(page, `Visible_${Date.now().toString(36)}`);
  await dialog(page).getByLabel("Password", { exact: true }).fill("Visible password 426");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
  let box = await dialog(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1441);
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.addStyleTag({ content: ".account-dialog { zoom: 1; }" });
  await page.setViewportSize({ width: 390, height: 420 });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Password", { exact: true }).focus();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toBeFocused();
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
  box = await dialog(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(box.height).toBeLessThanOrEqual(421);
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
});
