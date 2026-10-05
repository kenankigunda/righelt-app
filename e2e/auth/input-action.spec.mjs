import { test, expect } from "@playwright/test";
import { enterUsername, openPlaySignIn } from "./helpers.mjs";

const dialog = page => page.getByTestId("account-dialog");
const password = "A varied password 42! ".repeat(4);
const uniqueName = () => `Inline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
test.beforeEach(async () => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).ok).toBe(true);
});

async function proveInputAction(page, label, initialType) {
  const field = dialog(page).getByLabel(label, { exact: true });
  const wrapper = field.locator("..");
  const toggle = wrapper.getByRole("button");
  await field.fill(password);
  await expect(field).toHaveAttribute("type", initialType);
  await expect(toggle).toHaveAttribute("type", "button");
  await expect(toggle).toHaveAttribute("aria-controls", await field.getAttribute("id"));
  await expect(toggle).toHaveAccessibleName(`${initialType === "password" ? "Show" : "Hide"} ${label.toLowerCase()}`);
  const geometry = await wrapper.evaluate(node => {
    const rect = item => { const r = item.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    const button = node.querySelector("button"), input = node.querySelector("input"), style = getComputedStyle(button);
    return { wrapper: rect(node), input: rect(input), button: rect(button), border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth], background: style.backgroundColor };
  });
  expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.wrapper.left);
  expect(geometry.button.right).toBeLessThanOrEqual(geometry.wrapper.right);
  expect(geometry.button.top).toBeGreaterThanOrEqual(geometry.wrapper.top);
  expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.wrapper.bottom);
  expect(geometry.input.right).toBeLessThanOrEqual(geometry.button.left + 0.5);
  expect(geometry.input.width).toBeGreaterThan(40);
  expect(geometry.border).toEqual(["0px", "0px", "0px", "0px"]);
  expect(geometry.background).toBe("rgba(0, 0, 0, 0)");
  await toggle.click();
  await expect(field).toHaveAttribute("type", initialType === "password" ? "text" : "password");
  await expect(field).toHaveValue(password);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(field).toHaveAttribute("type", initialType);
  await expect(field).toHaveValue(password);
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(field).toHaveAttribute("type", initialType === "password" ? "text" : "password");
  await expect(field).toHaveValue(password);
}

for (const { width, zoom } of [{ width: 320, zoom: 1 }, { width: 390, zoom: 1 }, { width: 768, zoom: 1 }, { width: 1440, zoom: 2 }]) {
  test(`password action stays inside its field across all account forms at ${width}px and zoom ${zoom}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/");
    if (zoom !== 1) await page.addStyleTag({ content: `.account-dialog { zoom: ${zoom}; }` });
    await openPlaySignIn(page);
    await enterUsername(page, uniqueName());
    await proveInputAction(page, "Password", "password");
    await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
    await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
    await proveInputAction(page, "Password", "text");
    await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Change password", exact: true }).click();
    await expect(dialog(page).getByLabel("Current password", { exact: true })).toHaveCount(0);
    await proveInputAction(page, "New password", "password");
    await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
  });
}
