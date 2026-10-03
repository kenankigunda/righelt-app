import { test, expect } from "@playwright/test";
const dialog = page => page.getByTestId("account-dialog");
test.beforeEach(async () => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).status).toBe(200);
});

test("correctable errors preserve inputs and failed recovery-code exports keep a manual fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new DOMException("Clipboard unavailable", "NotAllowedError"); },
    } });
    URL.createObjectURL = () => { throw new Error("Download unavailable"); };
  });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill("Invalid name");
  await dialog(page).getByLabel("Display name (optional)", { exact: true }).fill("Preserved name");
  await dialog(page).getByLabel("Password", { exact: true }).fill("An accessible account password 428");
  const width = (await dialog(page).boundingBox()).width;
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).toContainText("Check the fields");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue("Invalid name");
  await expect(dialog(page).getByLabel("Display name (optional)", { exact: true })).toHaveValue("Preserved name");
  expect((await dialog(page).boundingBox()).width).toBe(width);
  await dialog(page).getByLabel("Username", { exact: true }).fill(`Form_${Date.now().toString(36)}`);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  const code = page.getByTestId("recovery-code");
  await expect(code).toBeVisible();
  const originalCode = await code.textContent();
  await dialog(page).getByRole("button", { name: "Copy recovery code", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).toContainText("Copy failed");
  await expect(code).toHaveText(originalCode);
  await dialog(page).getByRole("button", { name: "Download recovery code", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).toContainText("Download failed");
  await expect(code).toHaveText(originalCode);
  await expect(dialog(page).getByLabel("I saved my recovery code")).not.toBeChecked();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain("game/");
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
});

test("account controls remain reachable when enlarged and when the available mobile height shrinks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // CSS enlargement is automated layout proof; physical browser zoom and the
  // iPhone software keyboard remain separately recorded manual acceptance.
  await page.addStyleTag({ content: ".account-dialog { zoom: 2; }" });
  await expect(dialog(page)).toHaveCSS("zoom", "2");
  await dialog(page).getByLabel("Username", { exact: true }).fill("Visible_user");
  await dialog(page).getByLabel("Password", { exact: true }).fill("Visible password 426");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
  let box = await dialog(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1441);
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.addStyleTag({ content: ".account-dialog { zoom: 1; }" });
  await page.setViewportSize({ width: 390, height: 420 });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
