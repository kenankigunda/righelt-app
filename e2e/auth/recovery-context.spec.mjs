import { test, expect } from "@playwright/test";
const password = "A two tab recovery test password 492";
const dialog = page => page.getByTestId("account-dialog");
const endpoint = path => response => new URL(response.url()).pathname === path && response.request().method() === "POST";
async function acknowledge(page) {
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
}
async function prepare(page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Replace recovery code", exact: true }).click();
  await dialog(page).getByLabel("Current password", { exact: true }).fill(password);
  const pending = page.waitForResponse(endpoint("/api/auth/recovery-code/prepare"));
  await dialog(page).getByRole("button", { name: "Prepare replacement code", exact: true }).click();
  expect((await pending).status()).toBe(200);
  await expect(page.getByTestId("recovery-code")).toBeVisible();
  return page.getByTestId("recovery-code").textContent();
}
test("two tabs can acknowledge only the recovery code prepared by that exact form", async ({ page }) => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).status).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(`Flow_${Date.now().toString(36)}`);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByTestId("recovery-code")).toBeVisible();
  await acknowledge(page);
  await expect(dialog(page)).not.toBeVisible();
  const sibling = await page.context().newPage();
  try {
    await sibling.goto("/");
    const first = await prepare(page);
    const second = await prepare(sibling);
    expect(first).not.toBe(second);
    const stale = page.waitForResponse(endpoint("/api/auth/recovery-code/finish"));
    await acknowledge(page);
    expect((await stale).status()).toBe(409);
    await expect(dialog(page).getByText("This recovery step has expired or been replaced. Please start again.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("recovery-code")).toHaveText(first);
    await expect(sibling.getByTestId("recovery-code")).toHaveText(second);
    const completed = sibling.waitForResponse(endpoint("/api/auth/recovery-code/finish"));
    await acknowledge(sibling);
    expect((await completed).status()).toBe(200);
    await expect(dialog(sibling)).not.toBeVisible();
    await expect(sibling.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  } finally { await sibling.close(); }
});
