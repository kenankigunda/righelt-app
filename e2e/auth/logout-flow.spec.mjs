import { test, expect } from "@playwright/test";
const dialog = page => page.getByTestId("account-dialog");

test("a sign-in opened during pending logout survives its completion", async ({ page }) => {
  const fixturePort = Number(process.env.RIGHELT_AUTH_E2E_WEB_PORT || 9988) + 100;
  expect((await fetch(`http://127.0.0.1:${fixturePort}/reset-limits`, { method: "POST" })).ok).toBe(true);
  const username = `Overlap_${Date.now().toString(36)}`;
  const password = "Logout overlap proof password 472";
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  let release, reached;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { reached = resolve; });
  await page.route("**/api/auth/logout", async route => {
    reached(); await held; await route.continue();
  });
  try {
    await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
    await requested;
    await expect(dialog(page)).not.toBeVisible();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await dialog(page).getByLabel("Username", { exact: true }).fill(username);
    await dialog(page).getByLabel("Password", { exact: true }).fill(password);
    // Observe the public local logout marker, not a timer or internal app hook.
    expect(await page.evaluate(() => Boolean(localStorage.getItem("righelt.account.logout-pending.v1")))).toBe(true);
    release();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("righelt.account.logout-pending.v1"))).toBeNull();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(username);
    await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
    await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
