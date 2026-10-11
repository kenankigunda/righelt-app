import { continueFriendIntroduction, enterUsername, openPlaySignIn, waitForAccountStartup } from "./helpers.mjs";
import { test, expect } from "@playwright/test";
import { getHistoryMoveCount, submitPlayableAction } from "../support/app.mjs";

const password = "A long invite test password 482";
const dialog = page => page.getByTestId("account-dialog");
const uniqueName = () => `Invite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

test.beforeEach(async () => {
  const response = await fetch("http://127.0.0.1:10088/reset-limits", { method: "POST" });
  expect(response.status).toBe(200);
});

async function register(page, username, play = false) {
  await page.goto("/");
  await waitForAccountStartup(page);
  // Landing is public; an account overlay appears only after an explicit attempt.
  await expect(dialog(page)).not.toBeVisible();
  await openPlaySignIn(page);
  await dialog(page).getByRole("button", { name: "Create account", exact: true }).click();
  await enterUsername(page, username);
  await dialog(page).getByLabel("Password", { exact: true }).fill(password);
  await dialog(page).getByRole("button", { name: "Create account & continue", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await continueFriendIntroduction(page);
  await expect(page).toHaveURL(/#\/game\//);
  if (!play) await page.goto("/");
  if (play) {
    await expect(page).toHaveURL(/#\/game\//);
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
  }
}

async function signOut(page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByText("Sign-out pending", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Account", exact: true })).not.toBeVisible();
}

async function sharedInvite(host) {
  await register(host, uniqueName(), true);
  const gameUrl = host.url();
  const players = host.getByRole("button", { name: "Players", exact: true });
  if (await players.isVisible()) await players.click();
  const invite = host.getByTestId("copy-invite");
  await expect(invite).toBeEnabled();
  // Exercise the share action: it waits for an optimistic game's real invite
  // token before copying. Its provisional data-link can still contain a game ID.
  await host.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => {},
    } });
  });
  await invite.click();
  await expect.poll(() => host.evaluate(() => window.__righeltLastInvite)).toBeTruthy();
  const url = await host.evaluate(() => window.__righeltLastInvite);
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
      headers: { "X-Righelt-Auth-Version": "2", "X-Righelt-Session": session.contextId },
    });
    if (!response.ok) throw Error(`Game read failed: ${response.status}`);
    const body = await response.json();
    return body.game.legalActions.find(item => item.from && item.to);
  });
  expect(action).toBeTruthy();
  await submitPlayableAction(host, action);
}

for (const method of ["login", "registration"]) {
  test(`a shared player invite survives ${method} and preserves its destination`, async ({ page, browser }) => {
    const invite = await sharedInvite(page);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    let visitor;
    try {
      visitor = await context.newPage();
      await visitor.addInitScript(() => {
        const fetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const hold = window.__holdNextInviteRead && new URL(args[0], location.href).pathname.startsWith("/api/shell/invites/");
          if (hold) window.__holdNextInviteRead = false;
          const response = await fetch(...args);
          if (hold) {
            const json = response.json.bind(response);
            response.json = async () => {
              const body = await json();
              await new Promise(resolve => { window.__releaseInviteRead = resolve; });
              return body;
            };
          }
          return response;
        };
      });
      const username = uniqueName();
      if (method === "login") { await register(visitor, username); await signOut(visitor); }
      const joins = [];
      visitor.on("request", request => {
        if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/join"))
          joins.push(request.postDataJSON());
      });
      await visitor.goto(invite.url);
      await expect(visitor.getByTestId("invite-join-player")).toBeVisible();
      await expect(dialog(visitor)).not.toBeVisible();
      await visitor.getByTestId("invite-join-player").click();
      await expect(visitor).toHaveURL(/#\/tutorial(?:$|\/)/);
      if(method==='registration')await visitor.locator('[data-lesson-skip-all]').click();
      await expect(dialog(visitor)).toBeVisible();
      await expect(dialog(visitor)).toHaveAttribute('data-presentation','inline');

      if (method === "login") {
        await visitor.locator('[data-lesson-account] [data-lesson-exit]').click();
        await expect(dialog(visitor)).not.toBeVisible();
        await expect(visitor).toHaveURL(invite.url);
        expect(joins).toEqual([]);
        await visitor.getByTestId("invite-join-viewer").click();
        await expect(visitor).toHaveURL(/#\/game\//);
        await expect(visitor.getByTestId("game-board")).toBeVisible();
        await expect(visitor.getByRole("button", { name: "Account", exact: true })).not.toBeVisible();
        await expect(dialog(visitor)).not.toBeVisible();
        const before = await getHistoryMoveCount(visitor);
        await playHostMove(page);
        await expect.poll(() => getHistoryMoveCount(visitor)).toBeGreaterThan(before);
        expect(joins).toEqual([]); // Public spectating must not claim an account seat.
        await visitor.goto(invite.url);
        await visitor.getByTestId("invite-join-player").click();
        await expect(dialog(visitor)).toBeVisible();
        await enterUsername(visitor, username);
        await dialog(visitor).getByLabel("Password", { exact: true }).fill(password);
        // The reset and continuation share this read. Neither may act before
        // it finishes, or duplicate the preserved join after release.
        await visitor.evaluate(() => { window.__holdNextInviteRead = true; });
        await dialog(visitor).getByRole("button", { name: "Sign in", exact: true }).click();
        await expect.poll(() => visitor.evaluate(() => Boolean(window.__releaseInviteRead))).toBe(true);
        expect(joins).toEqual([]);
        await visitor.evaluate(() => window.__releaseInviteRead());
      } else {
        await dialog(visitor).getByRole("button", { name: "Create account", exact: true }).click();
        await enterUsername(visitor, username);
        await dialog(visitor).getByLabel("Password", { exact: true }).fill(password);
        expect(joins).toEqual([]);
        await dialog(visitor).getByRole("button", { name: "Create account & continue", exact: true }).click();
      }
      await expect(dialog(visitor)).not.toBeVisible();
      await expect(visitor.getByTestId("game-role")).toContainText("Player 2");
      const expectedGame = new URL(invite.gameUrl).hash.match(/^#\/game\/([^?]+)/)[1];
      await expect(visitor).toHaveURL(url => url.hash.match(/^#\/game\/([^?]+)/)?.[1] === expectedGame);
      expect(joins).toHaveLength(1);
      expect(joins[0].mode).toBe("player");
      expect(joins[0].inviteToken).toBe(decodeURIComponent(new URL(invite.url).hash.match(/^#\/invite\/([^?]+)/)[1]));
      await expect(page.getByTestId("game-role")).toContainText("Player 1");
    } finally {
      if (visitor && !visitor.isClosed()) await visitor.evaluate(() => window.__releaseInviteRead?.());
      await context.close();
    }
  });
}
