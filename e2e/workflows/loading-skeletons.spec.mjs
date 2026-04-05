import { test, expect } from "@playwright/test";

import { buildAppUrl, closeContextQuietly, createGamesViaApi, createIsolatedPage } from "../support/app.mjs";

test("game route shows a skeleton while the initial game load is still in flight", async ({ browser, baseURL }) => {
  const { context: ownerContext, page } = await createIsolatedPage(browser);
  let delayedContext = null;

  try {
    const [gameId] = await createGamesViaApi(page, 1);
    const gameHash = `#/game/${encodeURIComponent(gameId)}`;
    await closeContextQuietly(ownerContext);
    delayedContext = await browser.newContext();
    const delayedPage = await delayedContext.newPage();
    await delayedPage.addInitScript(({ targetPath }) => {
      const originalFetch = window.fetch.bind(window);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      window.__righeltTestFetchSeen = false;
      window.__righeltTestReleaseFetch = () => release();
      window.fetch = async (input, init) => {
        const requestUrl =
          typeof input === "string" || input instanceof URL ? String(input) : typeof input?.url === "string" ? input.url : String(input);
        const url = new URL(requestUrl, window.location.origin);
        const method =
          (init?.method ??
            (typeof input === "object" && input && "method" in input ? input.method : null) ??
            "GET")
            .toString()
            .toUpperCase();
        if (method === "GET" && url.pathname === targetPath) {
          window.__righeltTestFetchSeen = true;
          await gate;
        }
        return originalFetch(input, init);
      };
    }, { targetPath: `/api/shell/games/${gameId}` });

    const navigation = delayedPage.goto(buildAppUrl(baseURL, gameHash));
    await delayedPage.waitForLoadState("domcontentloaded");
    await expect(delayedPage.getByTestId("game-view-skeleton")).toBeVisible();
    await delayedPage.evaluate(() => window.__righeltTestReleaseFetch());

    await navigation;
    await expect(delayedPage.getByTestId("game-shell")).toBeVisible();
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
    await closeContextQuietly(ownerContext);
    inviteContext = await browser.newContext();
    const invitePage = await inviteContext.newPage();
    await invitePage.addInitScript(({ targetPath }) => {
      const originalFetch = window.fetch.bind(window);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      window.__righeltTestFetchSeen = false;
      window.__righeltTestReleaseFetch = () => release();
      window.fetch = async (input, init) => {
        const requestUrl =
          typeof input === "string" || input instanceof URL ? String(input) : typeof input?.url === "string" ? input.url : String(input);
        const url = new URL(requestUrl, window.location.origin);
        const method =
          (init?.method ??
            (typeof input === "object" && input && "method" in input ? input.method : null) ??
            "GET")
            .toString()
            .toUpperCase();
        if (method === "GET" && url.pathname === targetPath) {
          window.__righeltTestFetchSeen = true;
          await gate;
        }
        return originalFetch(input, init);
      };
    }, { targetPath: `/api/shell/invites/${gameId}` });

    const navigation = invitePage.goto(buildAppUrl(baseURL, `#/invite/${encodeURIComponent(gameId)}`));
    await invitePage.waitForLoadState("domcontentloaded");
    await expect(invitePage.getByTestId("invite-view-skeleton")).toBeVisible();
    await invitePage.evaluate(() => window.__righeltTestReleaseFetch());

    await navigation;
    await expect(invitePage.getByTestId("invite-gate")).toBeVisible();
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
    await expect(page.getByTestId("home-create-game")).toBeVisible();

    releasePageLoad?.();

    await expect(page.locator('[data-action="home-page-next"][data-home-section="my"]')).toBeVisible();
  } finally {
    await closeContextQuietly(context);
  }
});
