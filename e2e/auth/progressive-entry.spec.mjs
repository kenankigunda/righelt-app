import { test, expect } from "@playwright/test";
import { enterUsername } from "./helpers.mjs";
import { AUTH_REQUEST_HEADER, AUTH_PROTOCOL_HEADER, AUTH_PROTOCOL_VERSION } from "../../packages/shared-types/src/auth-policy.js";
const dialog = page => page.getByTestId("account-dialog");
const uniqueName = () => `Entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const password = "Progressive browser password 428";

test.beforeEach(async () => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).status).toBe(200);
});
async function open(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Pick up your games anywhere" })).toBeVisible();
}
async function existingAccount(request, baseURL) {
  const username = uniqueName();
  const response = await request.post("/api/auth/register", {
    headers: { Origin: new URL(baseURL).origin, [AUTH_REQUEST_HEADER]: "1", [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION) },
    data: { username, password },
  });
  expect(response.status()).toBe(200);
  return username;
}

test("explicit creation opens before typing and a taken username never switches it to login", async ({ page, request, baseURL }) => {
  const taken = await existingAccount(request, baseURL);
  await open(page);
  await expect(dialog(page).getByLabel("Password", { exact: true })).not.toBeVisible();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toBeVisible();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await enterUsername(page, taken);
  await expect(dialog(page)).toContainText("That username is taken. Choose another.");
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeDisabled();
  await dialog(page).getByLabel("Password", { exact: true }).fill("Never expose this login secret");
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
});

test("automatic username disclosure keeps the caret and creates immediately with an eight-character password", async ({ page }) => {
  await open(page);
  const username = uniqueName();
  await enterUsername(page, username);
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  expect(await dialog(page).getByLabel("Username", { exact: true }).evaluate(input => input.selectionStart)).toBe(username.length);
  const secret = dialog(page).getByLabel("Password", { exact: true });
  await expect(secret).toHaveAttribute("type", "text");
  await expect(secret).toHaveAttribute("autocomplete", "new-password");
  await secret.fill("Ax7!pQ2z");
  await dialog(page).getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(secret).toHaveAttribute("type", "password");
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
});

test("obsolete lookup results cannot replace a newer creation choice", async ({ page }) => {
  let release, arrived;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  const first = uniqueName(), second = uniqueName();
  await page.route("**/api/auth/username", async route => {
    if (route.request().postDataJSON().username === first) {
      arrived(); await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: true }) }).catch(() => {});
    } else await route.continue();
  });
  try {
    await open(page);
    await dialog(page).getByLabel("Username", { exact: true }).fill(first);
    await started;
    await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
    await enterUsername(page, second);
    await dialog(page).getByLabel("Password", { exact: true }).fill(password);
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
    await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
    await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
    await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("lookup failure preserves the name and needs explicit retry rather than implying availability", async ({ page }) => {
  let fail = true, calls = 0;
  await page.route("**/api/auth/username", async route => {
    calls++;
    if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
    else await route.continue();
  });
  await open(page);
  const username = uniqueName();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "error");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(username);
  await expect(dialog(page).getByLabel("Password", { exact: true })).not.toBeVisible();
  expect(calls).toBe(1);
  fail = false;
  await dialog(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
  expect(calls).toBe(2);
});

test("forgotten-password help points to a signed-in device and offers a fresh account", async ({ page, request, baseURL }) => {
  const username = await existingAccount(request, baseURL);
  await open(page);
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill("An incorrect password 943");
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).not.toHaveText("");
  await dialog(page).locator("summary").filter({ hasText: "Forgot password?" }).click();
  await expect(dialog(page)).toContainText("Change password");
  await expect(dialog(page)).toContainText(/signed.in/);
  await dialog(page).getByRole("button", { name: "Choose another username", exact: true }).click();
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
});

test("a lost registration response inspects the session without creating twice", async ({ page }) => {
  let creates = 0;
  await page.route("**/api/auth/register", async route => {
    creates++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    // The server committed and the cookie reached the browser's shared jar;
    // emulate a transport failure before the application receives the body.
    await route.abort("failed");
  });
  await open(page);
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  expect(creates).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});

test("registration collision stays in creation and never retries as login", async ({ page, request, baseURL }) => {
  const username = await existingAccount(request, baseURL);
  let registrations = 0, logins = 0;
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/register") registrations++;
    if (path === "/api/auth/login") logins++;
  });
  // Availability is advisory: another browser may register before submission.
  await page.route("**/api/auth/username", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: false }),
  }));
  await open(page);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).toContainText("That username is taken. Choose another.");
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  expect(registrations).toBe(1);
  expect(logins).toBe(0);
});

test("Enter checks the username without submitting credentials and canonical edits clear secrets", async ({ page }) => {
  let mutations = 0;
  page.on("request", request => {
    if (["/api/auth/register", "/api/auth/login"].includes(new URL(request.url()).pathname)) mutations++;
  });
  await open(page);
  const username = uniqueName();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await page.keyboard.press("Enter");
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toBeFocused();
  expect(mutations).toBe(0);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByLabel("Username", { exact: true }).fill(` ${username.toUpperCase()} `);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
  await enterUsername(page, uniqueName());
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  expect(mutations).toBe(0);
});
