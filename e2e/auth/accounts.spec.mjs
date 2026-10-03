import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getHistoryMoveCount, submitPlayableAction } from "../support/app.mjs";

const password = "A long browser test password 482";
const replacement = "A different browser test password 963";
const dialog = page => page.getByTestId("account-dialog");
const uniqueName = () => `User_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const control = async action => {
  const response = await fetch(`http://127.0.0.1:10088/${action}`, { method: "POST" });
  expect(response.status).toBe(200);
};
test.beforeEach(async () => control("reset-limits"));
async function register(page, username, { gate = false } = {}) {
  await page.goto("/");
  await page.getByRole("button", { name: gate ? "Start new game" : "Sign in", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Save your recovery code" })).toBeVisible();
  const code = await page.getByTestId("recovery-code").textContent();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(?:[ -][0-9A-HJKMNP-TV-Z]{4}){7}$/);
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  if (gate) {
    await expect(page).toHaveURL(/#\/game\//);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
  }
  return code;
}
async function signIn(page, username, secret = password) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(secret);
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}
async function makeAccountMove(page) {
  const action = await page.evaluate(async () => {
    const session = await (await fetch("/api/auth/session")).json();
    const gameId = decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}`, {
      headers: { "X-Righelt-Auth-Version": "1", "X-Righelt-Session": session.contextId },
    });
    if (!response.ok) throw new Error(`Game read failed: ${response.status}`);
    const body = await response.json();
    return body.game.legalActions.find(item => item.from && item.to);
  });
  expect(action).toBeTruthy();
  await submitPlayableAction(page, action);
}
async function account(page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Account", exact: true })).toBeVisible();
}

test("registration preserves the play attempt and the same seat works in another browser", async ({ page, browser }) => {
  const username = uniqueName();
  await register(page, username, { gate: true });
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  const gameUrl = page.url();
  const cookies = await page.context().cookies();
  const cookie = cookies.find(item => item.name === "__Host-righelt_session");
  expect(cookie).toMatchObject({ secure: true, httpOnly: true, sameSite: "Lax", path: "/" });
  const second = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await second.newPage();
    await other.goto(gameUrl);
    await expect(other.getByTestId("game-shell")).toBeVisible();
    await expect(other.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await signIn(other, username);
    await expect(other.getByTestId("game-role")).toContainText("Player 1");
    expect(other.url()).toBe(gameUrl);
    const before = await getHistoryMoveCount(page);
    await makeAccountMove(other);
    await expect.poll(() => getHistoryMoveCount(page)).toBeGreaterThan(before);
  } finally { await second.close(); }
});

test("recovery rotates credentials and revokes another browser without hiding the board", async ({ page, browser }) => {
  const username = uniqueName();
  const code = await register(page, username, { gate: true });
  const gameUrl = page.url();
  const second = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await second.newPage();
    await other.goto(gameUrl);
    await other.getByRole("button", { name: "Sign in", exact: true }).click();
    await dialog(other).getByRole("button", { name: "Recover account", exact: true }).click();
    await dialog(other).getByLabel("Username", { exact: true }).fill(username);
    await dialog(other).getByLabel("Recovery code", { exact: true }).fill(code.toLowerCase().replaceAll("-", " "));
    await dialog(other).getByLabel("New password", { exact: true }).fill(replacement);
    await dialog(other).getByRole("button", { name: "Prepare recovery", exact: true }).click();
    await expect(other.getByTestId("recovery-code")).toBeVisible();
    expect(await other.getByTestId("recovery-code").textContent()).not.toBe(code);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
    await dialog(other).getByLabel("I saved my recovery code").check();
    await dialog(other).getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog(other)).not.toBeVisible();
    await expect(other.getByTestId("game-role")).toContainText("Player 1");
    // Local workerd can delay delivery of a server-initiated close frame (~10s).
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("game-board")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await signIn(page, username, replacement);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
  } finally { await second.close(); }
});

test("account forms support autofill, keyboard focus, narrow layouts and cancellation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Sign in", exact: true });
  await trigger.click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveAttribute("autocomplete", "username");
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  const axe = await new AxeBuilder({ page }).include('[data-testid="account-dialog"]').analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("account-narrow.png") });
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Show password", exact: true }).click();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog(page).getByLabel("Username", { exact: true })).toBeFocused();
  const box = await dialog(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(new URL(page.url()).hash).not.toContain("game/");
});

test("password change and browser logout revoke the correct sessions across tabs", async ({ page, browser }) => {
  const username = uniqueName();
  await register(page, username, { gate: true });
  const gameUrl = page.url();
  const sibling = await page.context().newPage();
  await sibling.goto(gameUrl);
  const separate = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await separate.newPage();
    await other.goto(gameUrl);
    await signIn(other, username);
    await account(page);
    await dialog(page).getByRole("button", { name: "Change password", exact: true }).click();
    await dialog(page).getByLabel("Current password", { exact: true }).fill(password);
    await dialog(page).getByLabel("New password", { exact: true }).fill(replacement);
    await dialog(page).getByRole("button", { name: "Change password", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(other.getByRole("button", { name: "Sign in", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(other.getByTestId("game-board")).toBeVisible();
    await other.reload();
    await expect(other.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await signIn(other, username, replacement);
    await account(page);
    await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(sibling.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByTestId("game-board")).toBeVisible();
    await other.reload();
    await expect(other.getByTestId("game-role")).toContainText("Player 1");
  } finally { await sibling.close(); await separate.close(); }
});

test("offline logout blocks local authority until server revocation finishes", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__accountConnectivity = [];
    const record = data => window.__accountConnectivity.push({ ...data, time: performance.now(), online: navigator.onLine });
    for (const type of ["online", "offline"]) window.addEventListener(type, () => record({ type }));
    window.addEventListener("error", event => record({ type: "error", message: event.message }));
    window.addEventListener("unhandledrejection", event => record({ type: "unhandledrejection", message: String(event.reason) }));
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const path = new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.href).pathname;
      if (!path.startsWith("/api/auth/")) return original(...args);
      record({ type: "request", path });
      try { const response = await original(...args); record({ type: "response", path, status: response.status }); return response; }
      catch (error) { record({ type: "failure", path, error: error.name }); throw error; }
    };
  });
  const username = uniqueName();
  await register(page, username, { gate: true });
  const before = await getHistoryMoveCount(page);
  await account(page);
  await page.context().setOffline(true);
  await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Sign-out pending", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByTestId("game-board")).toBeVisible();
  await page.context().setOffline(false);
  try { await expect(page.getByText("Sign-out pending", { exact: true })).not.toBeVisible(); }
  finally {
    const events = await page.evaluate(() => window.__accountConnectivity);
    await testInfo.attach("account-connectivity", { body: JSON.stringify(events, null, 2), contentType: "application/json" });
    if (testInfo.status !== "passed") console.log("Account connectivity:", JSON.stringify(events));
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await signIn(page, username);
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  expect(await getHistoryMoveCount(page)).toBe(before);
});

test("expiry leaves the board visible and signing in restores the same seat", async ({ page }) => {
  const username = uniqueName();
  await register(page, username, { gate: true });
  const before = await getHistoryMoveCount(page);
  await control("expire-sessions");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("game-board")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await signIn(page, username);
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  expect(await getHistoryMoveCount(page)).toBe(before);
});

test("a delayed renewal cookie cannot overwrite an account switch", async ({ page }) => {
  const first = uniqueName(), second = uniqueName();
  await register(page, first);
  await account(page);
  await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await register(page, second);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let intercepted;
  const arrived = new Promise(resolve => { intercepted = resolve; });
  await page.route("**/api/auth/activity", async route => {
    const response = await route.fetch();
    intercepted();
    await held;
    await route.fulfill({ response });
  });
  // A foreground return initiates genuine controller activity with a Set-Cookie response.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await arrived;
  await account(page);
  await dialog(page).getByRole("button", { name: "Switch account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(first);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  let loginIssued = false;
  const observe = request => { if (new URL(request.url()).pathname === "/api/auth/login") loginIssued = true; };
  page.on("request", observe);
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  // Allow the event loop to dispatch the submit; a pending renewal must hold the login.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(loginIssued).toBe(false);
  release();
  await expect(dialog(page)).not.toBeVisible();
  page.off("request", observe);
  await page.unroute("**/api/auth/activity");
  const state = await page.evaluate(async () => (await fetch("/api/auth/session", { cache: "no-store" })).json());
  expect(state.account.username).toBe(first);
  await account(page);
  await expect(dialog(page)).toContainText(`@${first}`);
});

test("interrupted registration resumes with a replacement recovery code and an explicit save", async ({ page }) => {
  const username = uniqueName();
  await page.goto("/");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByTestId("recovery-code")).toBeVisible();
  const firstCode = await page.getByTestId("recovery-code").textContent();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain("game/");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Replace recovery code" })).toBeVisible();
  await dialog(page).getByLabel("Current password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Prepare replacement code", exact: true }).click();
  await expect(page.getByTestId("recovery-code")).toBeVisible();
  const code = await page.getByTestId("recovery-code").textContent();
  expect(code).not.toBe(firstCode);
  await dialog(page).getByRole("button", { name: "Copy recovery code", exact: true }).click();
  await expect(dialog(page).locator("[data-account-status]")).toContainText(/Recovery code copied|Copy failed/);
  const downloadPromise = page.waitForEvent("download");
  await dialog(page).getByRole("button", { name: "Download recovery code", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("righelt-recovery-code.txt");
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(await download.path(), "utf8");
  expect(content).toContain(username);
  expect(content).toContain(code);
  expect(content).toContain(new URL(page.url()).origin);
  expect(content).not.toContain(password);
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
});
