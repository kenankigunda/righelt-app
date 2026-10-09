import { continueFriendIntroduction, enterUsername, openPlaySignIn, waitForAccountStartup } from "./helpers.mjs";
import { test, expect } from "@playwright/test";
import { getHistoryMoveCount, submitPlayableAction } from "../support/app.mjs";
import { AUTH_REQUEST_HEADER, AUTH_PROTOCOL_HEADER, AUTH_PROTOCOL_VERSION } from "../../packages/shared-types/src/auth-policy.js";
const password = "A cutover account test password 482";
const dialog = page => page.getByTestId("account-dialog");
async function control(action) {
  expect((await fetch(`http://127.0.0.1:10088/${action}`, { method: "POST" })).status).toBe(200);
}
test.beforeEach(async () => { await control("maintenance-off"); await control("reset-limits"); });
test.afterEach(async () => control("maintenance-off"));
async function register(page, username, play = false) {
  await page.goto("/");
  await openPlaySignIn(page);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await continueFriendIntroduction(page);
  await expect(page).toHaveURL(/#\/game\//);
  if (!play) await page.goto("/");
  if (play) await expect(page.getByTestId("game-role")).toContainText("Player 1");
}
async function canary(page, baseURL) {
  // Use this isolated browser context's real cookie jar to prepare the canary.
  // Owner registration and all maintenance interactions stay in the browser.
  const origin = new URL(baseURL).origin;
  const profile = await page.request.get(`${origin}/api/profiles/cutover_canary`);
  expect([200, 404]).toContain(profile.status());
  const response = await page.request.post(`${origin}/api/auth/${profile.status() === 200 ? "login" : "register"}`, {
    headers: { Origin: origin, [AUTH_REQUEST_HEADER]: "1", [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION) },
    data: { username: "cutover_canary", password },
  });
  expect(response.status()).toBe(200);
  const session = await response.json();
  expect(session.account.username).toBe("cutover_canary");
  expect(session.contextId).toBeTruthy();
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  const browserSession = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
  expect(browserSession.account.username).toBe("cutover_canary");
}
async function request(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const session = await (await fetch("/api/auth/session")).json();
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: {
      "Content-Type": "application/json", "X-Righelt-Auth": "1", "X-Righelt-Auth-Version": "2",
      ...(session.contextId ? { "X-Righelt-Session": session.contextId } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, body });
}

test("an old guest invite stays view-only and offers a fresh account game", async ({ page }) => {
  await page.goto("/#/invite/cutover-legacy-invite");
  await expect(page.getByTestId("game-board")).toBeVisible();
  await expect(page.getByText("This older guest game is view-only.", { exact: false })).toBeVisible();
  const url = page.url();
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
  expect(page.url()).toBe(url);
  await register(page, `Legacy_${Date.now().toString(36)}`);
  await page.goto(url);
  await expect(page.getByTestId("game-board")).toBeVisible();
  const legacy = await request(page, "/api/shell/games/cutover-legacy-fixture");
  expect(legacy.status).toBe(200);
  expect(legacy.body.game.ownershipMode).toBe("legacy_guest");
  expect(legacy.body.game.canRecordMove).toBe(false);
  expect(legacy.body.game.myRoles).toEqual([]);
  const denied = await request(page, "/api/shell/games/cutover-legacy-fixture/join", { mode: "player" });
  expect(denied.body.error).toBe("legacy_read_only");
  await page.getByRole("button", { name: "Start new game", exact: true }).click();
  await continueFriendIntroduction(page);
  await expect(page.getByTestId("game-role")).toContainText("Player 1");
  expect(page.url()).not.toBe(url);
});

test("cutover maintenance preserves public boards and confines smoke writes to the canary", async ({ page, browser, baseURL }) => {
  await register(page, `Cutover_${Date.now().toString(36)}`, true);
  const gameUrl = page.url();
  const gameId = decodeURIComponent(new URL(gameUrl).hash.match(/^#\/game\/([^?]+)/)[1]);
  const before = await getHistoryMoveCount(page);
  const isolated = await browser.newContext({ ignoreHTTPSErrors: true });
  const spectator = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const smoke = await isolated.newPage();
    await canary(smoke, baseURL);
    await control("activate-cutover");
    await page.reload();
    await expect(page.getByTestId("game-board")).toBeVisible();
    await expect(page.getByTestId("game-shell").getByText("Play is temporarily paused. You can still browse and watch games.", { exact: true })).toBeVisible();
    await page.locator("#shell-board button").first().press("Enter");
    await expect(dialog(page)).not.toBeVisible();
    const blocked = await request(page, "/api/shell/games", { selfPlayMode: true });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error).toBe("temporarily_unavailable");
    const guest = await spectator.newPage();
    await guest.goto(gameUrl);
    await expect(guest.getByTestId("game-board")).toBeVisible();
    await expect(dialog(guest)).not.toBeVisible();
    const accepted = await request(smoke, "/api/shell/games", { selfPlayMode: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body.game.ownershipMode).toBe("account_v1");
    expect(accepted.body.game.myRoles.sort()).toEqual(["Player 1", "Player 2"]);
    await control("maintenance-off");
    await page.reload();
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
    const fresh = await request(page, `/api/shell/games/${gameId}`);
    expect(fresh.body.game.canRecordMove).toBe(true);
    const action = fresh.body.game.legalActions.find(item => item.from && item.to);
    expect(action).toBeTruthy();
    await submitPlayableAction(page, action);
    await expect.poll(() => getHistoryMoveCount(page)).toBeGreaterThan(before);
  } finally { await isolated.close(); await spectator.close(); }
});
