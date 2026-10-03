import { test, expect } from "@playwright/test";
import { getHistoryMoveCount, submitPlayableAction } from "../support/app.mjs";

const password = "A long invite test password 482";
const replacement = "A recovered invite test password 963";
const dialog = page => page.getByTestId("account-dialog");
const uniqueName = () => `Invite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

test.beforeEach(async () => {
  const response = await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" });
  expect(response.status).toBe(200);
});

async function register(page, username, play = false) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  // Landing is public; an account overlay appears only after an explicit attempt.
  await expect(dialog(page)).not.toBeVisible();
  await page.getByRole("button", { name: play ? "Start new game" : "Sign in", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await dialog(page).getByLabel("Username", { exact: true }).fill(username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByTestId("recovery-code")).toBeVisible();
  const code = await page.getByTestId("recovery-code").textContent();
  await dialog(page).getByLabel("I saved my recovery code").check();
  await dialog(page).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  if (play) {
    await expect(page).toHaveURL(/#\/game\//);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
  }
  return code;
}

async function signOut(page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByText("Sign-out pending", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
}

async function sharedInvite(host) {
  await register(host, uniqueName(), true);
  const gameUrl = host.url();
  const players = host.getByRole("button", { name: "Players", exact: true });
  if (await players.isVisible()) await players.click();
  const invite = host.getByTestId("copy-invite");
  await expect(invite).toBeEnabled();
  // Read the actual share control's server-issued invite URL, not a game URL.
  const url = await invite.getAttribute("data-link");
  expect(new URL(url).hash).toMatch(/^#\/invite\//);
  expect(url).not.toBe(gameUrl);
  return { url, gameUrl };
}

async function playHostMove(host) {
  const boardTab = host.getByRole("button", { name: "Board", exact: true });
  if (await boardTab.isVisible()) await boardTab.click();
  const action = await host.evaluate(async () => {
    const session = await (await fetch("/api/auth/session")).json();
    const gameId = decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}`, {
      headers: { "X-Righelt-Auth-Version": "1", "X-Righelt-Session": session.contextId },
    });
    if (!response.ok) throw Error(`Game read failed: ${response.status}`);
    const body = await response.json();
    return body.game.legalActions.find(item => item.from && item.to);
  });
  expect(action).toBeTruthy();
  await submitPlayableAction(host, action);
}

for (const method of ["login", "recovery"]) {
  test(`a shared player invite survives ${method} and preserves its destination`, async ({ page, browser }) => {
    const invite = await sharedInvite(page);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const visitor = await context.newPage();
      const username = uniqueName();
      const code = await register(visitor, username);
      await signOut(visitor);
      const joins = [];
      visitor.on("request", request => {
        if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/join"))
          joins.push(request.postDataJSON());
      });
      await visitor.goto(invite.url);
      await expect(visitor.getByTestId("invite-join-player")).toBeVisible();
      await expect(dialog(visitor)).not.toBeVisible();
      await visitor.getByTestId("invite-join-player").click();
      await expect(dialog(visitor)).toBeVisible();
      await expect(visitor).toHaveURL(invite.url);

      if (method === "login") {
        await dialog(visitor).getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog(visitor)).not.toBeVisible();
        await expect(visitor).toHaveURL(invite.url);
        expect(joins).toEqual([]);
        await visitor.getByTestId("invite-join-viewer").click();
        await expect(visitor).toHaveURL(/#\/game\//);
        await expect(visitor.getByTestId("game-board")).toBeVisible();
        await expect(visitor.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
        await expect(dialog(visitor)).not.toBeVisible();
        const before = await getHistoryMoveCount(visitor);
        await playHostMove(page);
        await expect.poll(() => getHistoryMoveCount(visitor)).toBeGreaterThan(before);
        expect(joins).toEqual([]); // Public spectating must not claim an account seat.
        await visitor.goto(invite.url);
        await visitor.getByTestId("invite-join-player").click();
        await dialog(visitor).getByLabel("Username", { exact: true }).fill(username);
        await dialog(visitor).getByLabel("Password", { exact: true }).fill(password);
        await dialog(visitor).getByRole("button", { name: "Sign in", exact: true }).click();
      } else {
        await dialog(visitor).getByRole("button", { name: "Recover account", exact: true }).click();
        await dialog(visitor).getByLabel("Username", { exact: true }).fill(username);
        await dialog(visitor).getByLabel("Recovery code", { exact: true }).fill(code);
        await dialog(visitor).getByLabel("New password", { exact: true }).fill(replacement);
        await dialog(visitor).getByRole("button", { name: "Prepare recovery", exact: true }).click();
        await expect(visitor.getByTestId("recovery-code")).toBeVisible();
        expect(await visitor.getByTestId("recovery-code").textContent()).not.toBe(code);
        await expect(visitor).toHaveURL(invite.url);
        expect(joins).toEqual([]);
        await dialog(visitor).getByLabel("I saved my recovery code").check();
        await dialog(visitor).getByRole("button", { name: "Continue", exact: true }).click();
      }
      await expect(dialog(visitor)).not.toBeVisible();
      await expect(visitor.getByTestId("game-role")).toContainText("Player 2");
      const expectedGame = new URL(invite.gameUrl).hash.match(/^#\/game\/([^?]+)/)[1];
      expect(new URL(visitor.url()).hash.match(/^#\/game\/([^?]+)/)?.[1]).toBe(expectedGame);
      expect(joins).toHaveLength(1);
      expect(joins[0].mode).toBe("player");
      expect(joins[0].inviteToken).toBe(decodeURIComponent(new URL(invite.url).hash.match(/^#\/invite\/([^?]+)/)[1]));
      await expect(page.getByTestId("game-role")).toContainText("Player 1");
    } finally { await context.close(); }
  });
}
