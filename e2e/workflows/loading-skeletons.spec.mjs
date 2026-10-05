import { test, expect } from "@playwright/test";

import { buildAppUrl, closeContextQuietly, createGamesViaApi, createIsolatedPage } from "../support/app.mjs";

const expectInviteLanding = async (page) => {
  await expect(page.getByRole("heading", { name: "Choose how to enter this game" })).toBeVisible();
  await expect(page.getByTestId("invite-join-viewer")).toBeVisible();
};

const getInviteTokenForGame = async (page, gameId) =>
  page.evaluate(async ({ targetGameId }) => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before loading invite metadata");
    }

    const response = await fetch(
      `/api/shell/games/${encodeURIComponent(targetGameId)}?identityId=${encodeURIComponent(identityId)}`,
    );
    const body = await response.json();
    if (!response.ok || !body?.game?.inviteToken) {
      throw new Error(`Invite token lookup failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return body.game.inviteToken;
  }, { targetGameId: gameId });

const deferRequest = async (context, predicate) => {
  let releaseRequest = null;
  const allowRequest = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  let seen = false;

  await context.route("**/api/shell/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!predicate({ method: request.method(), url })) {
      await route.fallback();
      return;
    }
    seen = true;
    await allowRequest;
    await route.fallback();
  });

  return {
    release: () => releaseRequest?.(),
    waitUntilSeen: async () => {
      await expect
        .poll(() => seen, {
          message: "Expected the cold-load API request to hit the deferred route",
        })
        .toBe(true);
    },
  };
};

test("game route shows a skeleton while the initial game load is still in flight", async ({ browser, baseURL }) => {
  const { context: ownerContext, page } = await createIsolatedPage(browser);
  let delayedContext = null;

  try {
    const [gameId] = await createGamesViaApi(page, 1);
    const gameHash = `#/game/${encodeURIComponent(gameId)}`;
    await closeContextQuietly(ownerContext);
    delayedContext = await browser.newContext();
    const delayedPage = await delayedContext.newPage();
    const deferredRequest = await deferRequest(
      delayedContext,
      ({ method, url }) => method === "GET" && url.pathname === `/api/shell/games/${gameId}`,
    );

    let releaseSnapshot;
    let snapshotSeen = false;
    const initialSnapshot = new Promise(resolve => { releaseSnapshot = resolve; });
    await delayedPage.routeWebSocket(new RegExp(`/api/shell/games/${gameId}/ws`), socket => {
      const server = socket.connectToServer();
      server.onMessage(async message => { snapshotSeen = true; await initialSnapshot; socket.send(message); });
    });
    const navigation = delayedPage.goto(buildAppUrl(baseURL, gameHash));
    await delayedPage.waitForLoadState("domcontentloaded");
    await expect.poll(() => snapshotSeen).toBe(true);
    await delayedPage.waitForSelector('[data-testid="game-view-skeleton"]', { state: "visible" });
    deferredRequest.release();
    releaseSnapshot();

    await navigation;
    await expectInviteLanding(delayedPage);
  } finally {
    await closeContextQuietly(delayedContext);
    await closeContextQuietly(ownerContext);
  }
});

test("invite route shows a skeleton while invite resolution is pending", async ({ browser, baseURL }) => {
  const { context: ownerContext, page } = await createIsolatedPage(browser);
  let inviteContext = null;

  try {
    const [gameId] = await createGamesViaApi(page, 1);
    const inviteToken = await getInviteTokenForGame(page, gameId);
    await closeContextQuietly(ownerContext);
    inviteContext = await browser.newContext();
    const invitePage = await inviteContext.newPage();
    const deferredRequest = await deferRequest(
      inviteContext,
      ({ method, url }) => method === "GET" && url.pathname === `/api/shell/invites/${inviteToken}`,
    );

    const navigation = invitePage.goto(buildAppUrl(baseURL, `#/invite/${encodeURIComponent(inviteToken)}`));
    await invitePage.waitForLoadState("domcontentloaded");
    await deferredRequest.waitUntilSeen();
    await invitePage.waitForSelector('[data-testid="invite-view-skeleton"]', { state: "visible" });
    deferredRequest.release();

    await navigation;
    await expectInviteLanding(invitePage);
  } finally {
    await closeContextQuietly(inviteContext);
  }
});

test("home pagination swaps only the active section into a skeleton while the next page loads", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);
  let releasePageLoad = null;
  const allowPageLoad = new Promise((resolve) => {
    releasePageLoad = resolve;
  });

  try {
    await createGamesViaApi(page, 5);
    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();

    const pageLoadSeen = new Promise((resolve) => {
      context.route("**/api/shell/games?*", async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== "GET" || url.searchParams.get("section") !== "my" || url.searchParams.get("page") !== "1") {
          await route.fallback();
          return;
        }
        resolve();
        await allowPageLoad;
        await route.fallback();
      });
    });

    await page.locator('[data-action="home-page-next"][data-home-section="my"]').click();
    await pageLoadSeen;
    await expect(page.getByTestId("home-section-skeleton").first()).toBeVisible();
    await expect(page.getByTestId("home-create-game")).toHaveCount(1);
    await expect(page.getByTestId("home-create-game")).toBeVisible();

    releasePageLoad?.();

    await expect(page.locator('[data-action="home-page-next"][data-home-section="my"]')).toBeVisible();
  } finally {
    await closeContextQuietly(context);
  }
});
