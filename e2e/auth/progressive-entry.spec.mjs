import { test, expect } from "@playwright/test";
import { enterUsername } from "./helpers.mjs";
import { AUTH_REQUEST_HEADER, AUTH_PROTOCOL_HEADER, AUTH_PROTOCOL_VERSION } from "../../packages/shared-types/src/auth-policy.js";
const dialog = page => page.getByTestId("account-dialog");
const uniqueName = () => `Entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const password = "Account browser password 428";

test.beforeEach(async () => {
  expect((await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" })).status).toBe(200);
});
async function open(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Log in to start playing" })).toBeVisible();
}
async function create(page) {
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
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

test("sign-in immediately shows both fields and never looks up a username", async ({ page, request, baseURL }) => {
  const username = await existingAccount(request, baseURL);
  let lookups = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/username") lookups++; });
  await open(page);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toBeVisible();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await expect(dialog(page).getByTestId("password-requirements")).toHaveCount(0);
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await page.keyboard.press("Enter");
  await expect(dialog(page)).not.toBeVisible();
  expect(lookups).toBe(0);
});

test("explicit creation retains a taken username without changing forms or disabling submit", async ({ page, request, baseURL }) => {
  const taken = await existingAccount(request, baseURL);
  await open(page);
  await create(page);
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await enterUsername(page, taken);
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "taken");
  await expect(dialog(page)).toContainText("That username is taken. Choose another.");
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeEnabled();
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await dialog(page).getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(taken);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
});

test("creation keeps optional display name and password through username edits, clearing only secrets on a form switch", async ({ page }) => {
  await open(page);
  await create(page);
  const username = uniqueName();
  await enterUsername(page, username);
  await expect(dialog(page).getByLabel("Display name (optional)", { exact: true })).toHaveAttribute("placeholder", username);
  await dialog(page).getByLabel("Display name (optional)", { exact: true }).fill("Étoile 🌟");
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  const changed = uniqueName();
  await enterUsername(page, changed);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
  await expect(dialog(page).getByLabel("Display name (optional)", { exact: true })).toHaveValue("Étoile 🌟");
  await dialog(page).getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(changed);
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  const destination = page.url();
  await dialog(page).getByLabel("Password", { exact: true }).focus();
  await dialog(page).getByRole("link", { name: "Create a new account.", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(changed);
  await expect(dialog(page).getByLabel("Display name (optional)", { exact: true })).toHaveValue("Étoile 🌟");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue("");
  expect(page.url()).toBe(destination);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(dialog(page).getByLabel("Display name", { exact: true })).toHaveValue("Étoile 🌟");
});

test("creation checklist starts neutral and validates an eight-character password locally", async ({ page }) => {
  await open(page);
  await create(page);
  const checklist = dialog(page).getByTestId("password-requirements");
  for (const name of ["length", "differentFromUsername", "notCommon"])
    await expect(checklist.locator(`[data-requirement="${name}"]`)).toHaveAttribute("data-state", "neutral");
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel("Password", { exact: true }).fill("password");
  await expect(checklist.locator('[data-requirement="notCommon"]')).toHaveAttribute("data-state", "unmet");
  await dialog(page).getByLabel("Password", { exact: true }).fill("Ax7!pQ2z");
  await expect(checklist.locator('[data-state="met"]')).toHaveCount(3);
  await dialog(page).getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
});

test("obsolete availability results cannot overwrite a newer name or switch into sign-in", async ({ page }) => {
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
    await create(page);
    await enterUsername(page, first);
    await started;
    await enterUsername(page, second);
    await dialog(page).getByLabel("Password", { exact: true }).fill(password);
    await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
    await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "available");
    await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
    await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
  } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
});

test("failed availability is unknown and permits authoritative registration", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/auth/username", async route => {
    calls++;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
  });
  await open(page);
  await create(page);
  const username = uniqueName();
  await enterUsername(page, username);
  await expect(dialog(page).locator("form")).toHaveAttribute("data-lookup-state", "error");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveValue(username);
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeEnabled();
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  expect(calls).toBe(1);
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
    await route.abort("failed");
  });
  await open(page);
  await create(page);
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
  await page.route("**/api/auth/username", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, exists: false }),
  }));
  await open(page);
  await create(page);
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).toContainText("That username is taken. Choose another.");
  await expect(dialog(page).locator("form")).toHaveAttribute("data-entry-mode", "create");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveValue(password);
  expect(registrations).toBe(1);
  expect(logins).toBe(0);
});

test("an unavailable common-password list is disclosed without blocking authoritative creation", async ({ page }) => {
  await page.route("**/generated/packages/shared-types/data/common-passwords.json", route => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }),
  }));
  await open(page);
  await create(page);
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  const common = dialog(page).getByTestId("password-requirements").locator('[data-requirement="notCommon"]');
  await expect(common).toHaveAttribute("data-state", "unavailable");
  await expect(common).toContainText(/unavailable/i);
  await expect(dialog(page).getByRole("button", { name: "Create account & continue", exact: true })).toBeEnabled();
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
});


test("sign-in creation hint appears only after a nonempty username loses focus", async ({ page }) => {
  let lookups = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/auth/username") lookups++; });
  await open(page);
  const hint = dialog(page).locator("[data-existing-hint]");
  const username = dialog(page).getByLabel("Username", { exact: true });
  await expect(hint).toBeHidden();
  await expect(dialog(page).getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await username.fill("NewPlayer"); await expect(hint).toBeHidden();
  await page.keyboard.press("Tab"); await expect(hint).toBeVisible();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toBeFocused();
  await username.fill("DifferentPlayer"); await expect(hint).toBeHidden();
  await page.keyboard.press("Tab"); await expect(hint).toBeVisible();
  await username.fill("   "); await page.keyboard.press("Tab"); await expect(hint).toBeHidden();
  await username.fill("NewPlayer"); await page.keyboard.press("Tab");
  await dialog(page).getByRole("link", { name: "Create a new account.", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Create account", exact: true })).toBeVisible();
  expect(lookups).toBe(0);
});
