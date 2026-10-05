import { enterUsername } from "./helpers.mjs";
import { profileLayoutDisplayName, sampleParticipantGeometry } from "../support/profile-layout.mjs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { AUTH_REQUEST_HEADER, AUTH_PROTOCOL_HEADER, AUTH_PROTOCOL_VERSION, SESSION_CONTEXT_HEADER } from "../../packages/shared-types/src/auth-policy.js";
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
  // The play button also exists while startup retries. The account trigger
  // appears only after startup is ready, which this happy-path helper needs.
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByRole("button", { name: gate ? "Start new game" : "Sign in", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  if (gate) {
    await expect(page).toHaveURL(/#\/game\//);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
  }
}
async function signIn(page, username, secret = password) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(secret);
  await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
}

test("registration helper waits for a failed bootstrap retry before submitting", async ({ page }) => {
  let bootstrapRequests = 0, registerRequests = 0, release, retryStarted;
  const held = new Promise(resolve => { release = resolve; });
  const retry = new Promise(resolve => { retryStarted = resolve; });
  await page.route("**/api/shell/bootstrap", async route => {
    if (++bootstrapRequests === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "local_api_unavailable" }) });
      return;
    }
    retryStarted();
    await held;
    await route.continue();
  });
  await page.route("**/api/auth/register", async route => {
    registerRequests++;
    await route.continue();
  });
  // Capture rejection immediately, including when demonstrating the old race.
  const registration = register(page, uniqueName(), { gate: true }).then(value => ({ value }), error => ({ error }));
  try {
    await retry;
    await expect(page.getByRole("button", { name: "Start new game", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).not.toBeVisible();
    await expect(dialog(page)).not.toBeVisible();
    expect(registerRequests).toBe(0);
    release();
    const outcome = await registration;
    if (outcome.error) throw outcome.error;
    expect(registerRequests).toBe(1);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
  } finally {
    release();
    await registration;
    await page.unrouteAll({ behavior: "wait" });
  }
});
async function makeAccountMove(page) {
  const action = await page.evaluate(async () => {
    const session = await (await fetch("/api/auth/session")).json();
    const gameId = decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}`, {
      headers: { "X-Righelt-Auth-Version": "2", "X-Righelt-Session": session.contextId },
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

test("account forms support autofill, keyboard focus, narrow layouts and cancellation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Sign in", exact: true });
  await trigger.click();
  await expect(dialog(page).getByLabel("Username", { exact: true })).toHaveAttribute("autocomplete", "username");
  await expect(dialog(page).getByLabel("Password", { exact: true })).not.toBeVisible();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  const axe = await new AxeBuilder({ page }).include('[data-testid="account-dialog"]').analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("account-narrow.png") });
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(dialog(page).getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
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
    await expect(dialog(page).getByLabel("Current password", { exact: true })).toHaveCount(0);
    await expect(dialog(page).getByLabel("New password", { exact: true })).toHaveAttribute("type", "password");
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
  await enterUsername(page, first);
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

test("current public names and view preferences follow the account across browsers", async ({ page, browser }) => {
  const username = uniqueName();
  await register(page, username, { gate: true });
  const gameUrl = page.url();
  const separate = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await separate.newPage();
    await other.goto(gameUrl);
    await signIn(other, username);
    await account(other);
    await expect(dialog(other).getByLabel("View preference")).toHaveValue("focused");
    await dialog(other).getByRole("button", { name: "Cancel", exact: true }).click();
    await account(page);
    await dialog(page).getByLabel("Display name", { exact: true }).fill("Étoile 🌟");
    await dialog(page).getByLabel("View preference").selectOption("explanatory");
    await dialog(page).getByRole("button", { name: "Save account settings" }).click();
    await expect(dialog(page).locator("[data-account-status]")).toHaveText("Account settings saved.");
    await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(page.url()).toBe(gameUrl);
    await other.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await account(other);
    await expect(dialog(other).getByLabel("Display name", { exact: true })).toHaveValue("Étoile 🌟");
    await expect(dialog(other).getByLabel("View preference")).toHaveValue("explanatory");
    await dialog(other).getByRole("button", { name: "Cancel", exact: true }).click();
    await other.reload();
    await expect(other.getByTestId("participant-player-1")).toContainText("Étoile 🌟");
    await expect(other.getByTestId("participant-player-1")).toContainText(`@${username}`);
    await expect(other.getByTestId("history-player-names")).toContainText("Étoile 🌟");
    const spectator = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const guest = await spectator.newPage();
      await guest.goto(gameUrl);
      const person = guest.getByTestId("participant-player-1").getByRole("button");
      await expect(person).toContainText("Étoile 🌟");
      await person.click();
      const profileDialog = guest.getByTestId("public-profile");
      await expect(profileDialog.getByRole("heading", { name: "Player profile" })).toBeVisible();
      await expect(profileDialog).toContainText(`@${username}`);
      await expect(profileDialog).toContainText("Étoile 🌟");
      await profileDialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(person).toBeFocused();
      const publicResponse = await spectator.request.get(new URL(`/api/profiles/${username.toLowerCase()}`, gameUrl).href);
      expect(publicResponse.headers()["cache-control"]).toBe("no-store");
      const profile = await publicResponse.json();
      expect(Object.keys(profile).sort()).toEqual(["displayName", "joinedMonth", "username"]);
      expect(profile).toMatchObject({ username, displayName: "Étoile 🌟", joinedMonth: expect.stringMatching(/^\d{4}-\d{2}$/) });
    } finally { await spectator.close(); }
  } finally { await separate.close(); }
});

test("tutorial skipping and completion persist without manual replay resetting them", async ({ page, browser }) => {
  const username = uniqueName();
  await register(page, username);
  await account(page);
  await dialog(page).getByRole("button", { name: "Replay tutorial" }).click();
  await page.getByRole("button", { name: "Skip tutorial", exact: true }).click();
  await expect(page).toHaveURL(/#\/(?:\?|$)/);
  await account(page);
  await expect(page.getByTestId("tutorial-status")).toHaveText("Tutorial: skipped");
  await dialog(page).getByRole("button", { name: "Replay tutorial" }).click();
  await page.getByRole("button", { name: "Finish Tutorial", exact: true }).click();
  await expect(page).toHaveURL(/#\/(?:\?|$)/);
  const separate = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const other = await separate.newPage();
    await other.goto(page.url());
    await signIn(other, username);
    await account(other);
    await expect(other.getByTestId("tutorial-status")).toHaveText("Tutorial: completed");
    await dialog(other).getByRole("button", { name: "Replay tutorial" }).click();
    await other.getByRole("button", { name: "Skip tutorial", exact: true }).click();
    await expect(other).toHaveURL(/#\/(?:\?|$)/);
    await account(other);
    await expect(other.getByTestId("tutorial-status")).toHaveText("Tutorial: completed");
  } finally { await separate.close(); }
});

for (const gesture of ["pointer", "keyboard"]) test(`finishing the home load during a ${gesture} gesture does not swallow the account click`, async ({ page }) => {
  let release, held;
  const waiting = new Promise(resolve => { held = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  await page.route(/\/api\/shell\/games(?:\?|$)/, async route => {
    const response = await route.fetch();
    held();
    await released;
    await route.fulfill({ response });
  });
  try {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(trigger).toBeVisible();
  await waiting;
  if (gesture === "pointer") { await trigger.hover(); await page.mouse.down(); }
  else { await trigger.focus(); await page.keyboard.down("Space"); }
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/shell/games");
  release();
  await refreshed;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (gesture === "pointer") await page.mouse.up();
  else await page.keyboard.up("Space");
  await expect(dialog(page)).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a stalled startup read recovers without granting guest play", async ({ page }) => {
  let requests = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/api/shell/bootstrap", async route => {
    if (++requests === 1) {
      await held;
      await route.abort().catch(() => {});
    } else await route.continue();
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    expect(requests).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Start new game", exact: true }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page).not.toHaveURL(/#\/game\//);
  } finally { release(); }
});

test("switching accounts in another tab retires the old settings form", async ({ page }) => {
  const first = uniqueName(), second = uniqueName();
  await register(page, second);
  await account(page);
  await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await register(page, first);
  const sibling = await page.context().newPage();
  try {
    await sibling.goto("/");
    await expect(sibling.getByRole("button", { name: "Account", exact: true })).toBeVisible();
    await account(page);
    await dialog(page).getByLabel("Display name", { exact: true }).fill("Unsaved first account name");
    await account(sibling);
    await dialog(sibling).getByRole("button", { name: "Switch account", exact: true }).click();
    await enterUsername(sibling, second);
    await dialog(sibling).getByLabel("Password", { exact: true }).fill(password);
    await dialog(sibling).getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog(sibling)).not.toBeVisible();
    await expect(dialog(page)).not.toBeVisible();
    await account(page);
    await expect(dialog(page)).toContainText(`@${second}`);
    await expect(dialog(page).getByLabel("Display name", { exact: true })).toHaveValue(second);
  } finally { await sibling.close(); }
});

test("keyboard board activation opens sign in without losing the board", async ({ page, browser }) => {
  const username = uniqueName();
  await register(page, username, { gate: true });
  const gameUrl = page.url();
  const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const owner = await otherContext.newPage();
    await owner.goto(gameUrl);
    await signIn(owner, username);
    await expect(owner.getByTestId("game-role")).toContainText("Player 1");
    await account(page);
    await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.getByText("Sign-out pending", { exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    const before = await getHistoryMoveCount(page);
    const cell = page.locator("#shell-board button").first();
    await expect(cell).toBeVisible();
    await cell.focus();
    // A real remote move replaces the board while the spectator is using its
    // keyboard. Keep focus on the same coordinate before physical Enter.
    await makeAccountMove(owner);
    await expect.poll(() => getHistoryMoveCount(page)).toBeGreaterThan(before);
    await expect(cell).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByRole("heading", { name: "Log in to start playing", exact: true })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(page.url()).toBe(gameUrl);
    await expect(page.getByTestId("game-board")).toBeVisible();
  } finally { await otherContext.close(); }
});

test("a delayed play continuation is discarded after a cross-tab account switch", async ({ page, request, baseURL }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.__heldAccountLists = [];
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (window.__holdAccountLists && new URL(args[0], location.href).pathname === "/api/shell/games" && (!args[1]?.method || args[1].method === "GET")) {
        const json = response.json.bind(response);
        response.json = async () => {
          const body = await json();
          await new Promise(resolve => window.__heldAccountLists.push(resolve));
          return body;
        };
      }
      return response;
    };
  });
  const first = uniqueName(), second = uniqueName();
  // This case covers continuation retirement, not registration form mechanics.
  // Create real accounts in the isolated API fixture cookie jar;
  // the browser remains anonymous and still performs both actual UI logins.
  for (const username of [second, first]) {
    const headers = {
      Origin: new URL(baseURL).origin,
      [AUTH_REQUEST_HEADER]: "1",
      [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION),
    };
    const registered = await request.post("/api/auth/register", {
      headers, data: { username, password },
    });
    expect(registered.status()).toBe(200);
    const session = await registered.json();
    expect(session.account.username).toBe(username);
    const sessionHeaders = { ...headers, [SESSION_CONTEXT_HEADER]: session.contextId };
    const loggedOut = await request.post("/api/auth/logout", { headers: sessionHeaders, data: {} });
    expect(loggedOut.status()).toBe(200);
  }
  await page.goto("/");
  const sibling = await page.context().newPage();
  let creates = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/shell/games") creates++; });
  try {
    await sibling.goto("/");
    await page.getByRole("button", { name: "Start new game", exact: true }).click();
    await enterUsername(page, first);
    await dialog(page).getByLabel("Password", { exact: true }).fill(password);
    await page.evaluate(() => { window.__holdAccountLists = true; });
    await dialog(page).getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog(page)).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__heldAccountLists.length)).toBeGreaterThan(0);
    await expect(sibling.getByRole("button", { name: "Account", exact: true })).toBeVisible();
    await account(sibling);
    await dialog(sibling).getByRole("button", { name: "Switch account", exact: true }).click();
    await enterUsername(sibling, second);
    await dialog(sibling).getByLabel("Password", { exact: true }).fill(password);
    await dialog(sibling).getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(dialog(sibling)).not.toBeVisible();
    await account(page);
    await expect(dialog(page)).toContainText(`@${second}`);
    await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await page.evaluate(async () => {
      window.__holdAccountLists = false;
      window.__heldAccountLists.splice(0).forEach(resolve => resolve());
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(creates).toBe(0);
    expect(new URL(page.url()).hash).not.toContain("game/");
  } finally {
    if (!page.isClosed()) await page.evaluate(() => window.__heldAccountLists.splice(0).forEach(resolve => resolve()));
    await sibling.close();
  }
});

test('a failed continuation read preserves the play choice for explicit retry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start new game', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Create account', exact: true }).click();
  await enterUsername(page, uniqueName());
  await dialog(page).getByLabel('Password', { exact: true }).fill(password);
  let denyReads = true;
  let creates = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/shell/games') creates++; });
  await page.route('**/api/shell/games?**', async route => {
    if (denyReads) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporarily_unavailable' }) });
    else await route.continue();
  });
  await dialog(page).getByRole('button', { name: 'Create account & continue', exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  expect(creates).toBe(0);
  denyReads = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page).toHaveURL(/#\/game\//);
  await expect(page.getByTestId('game-role')).toContainText('Player 1');
  expect(creates).toBe(1);
});

test("long profile names wrap inside participants without covering the board", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await register(page, uniqueName(), { gate: true });
  await account(page);
  const displayName = profileLayoutDisplayName;
  await dialog(page).getByLabel("Display name", { exact: true }).fill(displayName);
  await dialog(page).getByRole("button", { name: "Save account settings" }).click();
  await expect(dialog(page).locator("[data-account-status]")).toHaveText("Account settings saved.");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  const profile = page.getByTestId("participant-player-1").getByRole("button");
  await expect(profile).toContainText(displayName);
  let geometry;
  await expect.poll(async () => {
    geometry = await page.evaluate(sampleParticipantGeometry);
    return geometry !== null;
  }).toBe(true);
  expect(geometry.x).toBeGreaterThanOrEqual(geometry.panelX);
  expect(geometry.x + geometry.width).toBeLessThanOrEqual(geometry.panelX + geometry.panelWidth);
  expect(geometry.scrollWidth <= geometry.clientWidth + 1).toBe(true);
  await profile.click();
  await expect(page.getByTestId("public-profile")).toContainText(displayName);
});
