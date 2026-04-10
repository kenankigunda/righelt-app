import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  setOfflineState,
} from "../support/app.mjs";

const createSelfPlayGameViaApi = async (page) =>
  page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before creating a self-play game");
    }

    const response = await fetch("/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, selfPlayMode: true }),
    });
    const body = await response.json();
    if (!response.ok || !body?.game?.id) {
      throw new Error(`Self-play game creation failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return body.game.id;
  });

const openCardMenu = async (card, label) => {
  await expect(card).toBeVisible();
  await card.locator(`summary[aria-label="${label}"]`).click();
};

const getGameIdFromUrl = (page) => {
  const url = new URL(page.url());
  const match = url.hash.match(/^#\/game\/([^?]+)/);
  if (!match) {
    throw new Error(`Expected game hash in page URL, received ${url.hash}`);
  }
  return decodeURIComponent(match[1]);
};

const getVisibleJoinSurface = async (page) => {
  if (await page.getByTestId("invite-join-viewer").first().isVisible().catch(() => false)) {
    return "invite-gate";
  }
  if (await page.getByTestId("invite-join-player").first().isVisible().catch(() => false)) {
    return "invite-gate";
  }
  if (await page.getByTestId("join-viewer").first().isVisible().catch(() => false)) {
    return "join-panel";
  }
  if (await page.getByTestId("join-player").first().isVisible().catch(() => false)) {
    return "join-panel";
  }
  return null;
};

const openDirectGameLink = async (page, baseURL, gameHash) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await page.goto(`${baseURL}${gameHash}`);
  await page.waitForLoadState("domcontentloaded");
};

const requestPlayerJoin = async (page) => {
  const gameId = getGameIdFromUrl(page);
  await page.evaluate(
    async ({ gameId: currentGameId }) => {
      const identityId = window.localStorage.getItem("righelt.identity.id.v1");
      if (!identityId) {
        throw new Error("Expected identity id in local storage before requesting a player join");
      }

      const response = await fetch(`/api/shell/games/${encodeURIComponent(currentGameId)}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, mode: "player", inviteFromRole: null, inviteToken: null }),
      });
      const body = await response.json();
      if (!response.ok || !body?.game) {
        throw new Error(`Player join request failed: ${response.status} ${JSON.stringify(body)}`);
      }
    },
    { gameId },
  );
  await expect(page.getByTestId("game-role")).toContainText("Viewer");
  await expect(page.getByTestId("pending-player-request-notice")).toBeVisible();
};

const joinAsViewer = async (page) => {
  const gameId = getGameIdFromUrl(page);
  const inviteViewerButton = page.getByTestId("invite-join-viewer");
  try {
    await expect(inviteViewerButton).toBeVisible({ timeout: 20_000 });
    await inviteViewerButton.click();
  } catch {
    await page.evaluate(
      async ({ gameId: currentGameId }) => {
        const identityId = window.localStorage.getItem("righelt.identity.id.v1");
        if (!identityId) {
          throw new Error("Expected identity id in local storage before joining as viewer");
        }

        const response = await fetch(`/api/shell/games/${encodeURIComponent(currentGameId)}/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identityId, mode: "viewer", inviteFromRole: null, inviteToken: null }),
        });
        const body = await response.json();
        if (!response.ok || !body?.game) {
          throw new Error(`Viewer join failed: ${response.status} ${JSON.stringify(body)}`);
        }
      },
      { gameId },
    );
    await page.reload();
  }
  await expect(page.getByTestId("game-role")).toContainText("Viewer");
};

const expectViewerFallbackJoinSurface = async (page) => {
  await expect
    .poll(async () => getVisibleJoinSurface(page), {
      message: "Expected a visible join surface for a fallback viewer join",
    })
    .not.toBeNull();
  if ((await page.getByTestId("join-player").count()) > 0) {
    await expect(page.getByTestId("join-player")).toBeVisible();
    await expect(page.getByTestId("join-player")).toBeEnabled();
    return;
  }
  if ((await page.getByTestId("invite-join-player").count()) > 0) {
    await expect(page.getByTestId("invite-join-player")).toBeVisible();
    await expect(page.getByTestId("invite-join-player")).toBeEnabled();
    return;
  }
  if ((await page.getByTestId("join-viewer").count()) > 0) {
    await expect(page.getByTestId("join-viewer")).toBeVisible();
    await expect(page.getByTestId("join-viewer")).toBeEnabled();
    return;
  }
  await expect(page.getByTestId("invite-join-viewer")).toBeVisible();
  await expect(page.getByTestId("invite-join-viewer")).toBeEnabled();
};

const getLatestNote = (page) => page.locator('[data-testid="game-shell"] .game-shell-summary-copy').getByText(/^Latest:/).first();

const getHomeCard = (page, gameId) => page.locator(`[data-home-game-card="${gameId}"]`).first();
const getHomeSectionCard = (page, sectionKey, gameId) =>
  page.locator(`[data-home-section-root="${sectionKey}"] [data-home-game-card="${gameId}"]`).first();

test.describe("t-030 leave/delete/trash workflows", () => {
  test("E-05 and E-21: leaving from a home card animates it out and vacates the other player's seat", async ({ browser, baseURL }) => {
    const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
    const { context: playerContext, page: playerPage } = await createIsolatedPage(browser);

    try {
      const { gameId, gameHash } = await createGameFromHome(creatorPage);
      await openDirectGameLink(playerPage, baseURL, gameHash);
      await requestPlayerJoin(playerPage);
      await acceptPendingRequest(creatorPage);

      await creatorPage.goto("/");
      const homeCard = getHomeCard(creatorPage, gameId);
      await expect(homeCard).toBeVisible();

      let releaseLeave = null;
      const leaveReleased = new Promise((resolve) => {
        releaseLeave = resolve;
      });
      await creatorPage.route(`**/api/shell/games/${gameId}/leave`, async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        await leaveReleased;
        const response = await route.fetch();
        await route.fulfill({ response });
      });

      await openCardMenu(homeCard, "Leave game actions");
      await homeCard.getByTestId("leave-game").click();

      await expect(homeCard).toHaveClass(/is-leaving/);
      releaseLeave?.();

      await expect(getHomeSectionCard(creatorPage, "my", gameId)).toHaveCount(0);
      await expect(getHomeSectionCard(creatorPage, "other", gameId)).toContainText("Open to join as player");
      await expect(playerPage.getByTestId("participant-player-1")).toContainText("Open seat");
    } finally {
      await closeContextQuietly(creatorContext);
      await closeContextQuietly(playerContext);
    }
  });

  test("E-06, E-07, and E-24: leaving from the game page shows the banner, rejoining restores the seat, and reload keeps the role", async ({
    browser,
    baseURL,
  }) => {
    const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
    const { context: playerContext, page: playerPage } = await createIsolatedPage(browser);

    try {
      const { gameHash } = await createGameFromHome(creatorPage);
      await openDirectGameLink(playerPage, baseURL, gameHash);
      await requestPlayerJoin(playerPage);
      await acceptPendingRequest(creatorPage);

      const leaveGameMenu = creatorPage.locator('summary[aria-label="Leave game actions"]').first();
      await expect(leaveGameMenu).toBeVisible();
      await leaveGameMenu.click();
      await creatorPage.getByTestId("leave-game").click();

      await expect(creatorPage.getByTestId("game-role")).toContainText("Guest");
      await expect(creatorPage.getByText("Latest: Player left")).toBeVisible();
      await expect(creatorPage.getByTestId("rejoin-left-game")).toBeVisible();

      await creatorPage.getByTestId("rejoin-left-game").click();
      await expect(creatorPage.getByTestId("game-role")).toContainText("Player 1");
      await expect(creatorPage.getByTestId("pending-player-request-notice")).toHaveCount(0);

      await creatorPage.reload();
      await expect(creatorPage.getByTestId("game-role")).toContainText("Player 1");
      await expect(playerPage.getByTestId("participant-player-1")).toContainText("Connected");
    } finally {
      await closeContextQuietly(creatorContext);
      await closeContextQuietly(playerContext);
    }
  });

  test("E-10, E-11, E-14, E-15, and E-16: last-player delete moves the game into trash, notifies viewers, and restores from trash", async ({
    browser,
    baseURL,
  }) => {
    const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
    const { context: viewerContext, page: viewerPage } = await createIsolatedPage(browser);

    try {
      const { gameId, gameHash } = await createGameFromHome(creatorPage);
      await openDirectGameLink(viewerPage, baseURL, gameHash);
      await joinAsViewer(viewerPage);

      await creatorPage.goto("/");
      const homeCard = getHomeCard(creatorPage, gameId);
      await expect(homeCard).toBeVisible();

      let releaseDelete = null;
      const deleteReleased = new Promise((resolve) => {
        releaseDelete = resolve;
      });
      await creatorPage.route(`**/api/shell/games/${gameId}/leave`, async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        await deleteReleased;
        const response = await route.fetch();
        await route.fulfill({ response });
      });

      await openCardMenu(homeCard, "Delete game actions");
      await homeCard.getByTestId("delete-game").click();

      await expect(homeCard).toHaveClass(/is-leaving/);
      releaseDelete?.();

      await expect(getHomeSectionCard(creatorPage, "my", gameId)).toHaveCount(0);
      await expect(viewerPage.getByTestId("game-deleted-gate")).toBeVisible();
      await expect(viewerPage.getByTestId("restore-game")).toHaveCount(0);

      await creatorPage.goto("/#/trash");
      await expect(creatorPage.getByText("My deleted games")).toBeVisible();
      await expect(creatorPage.getByText("Other games")).toBeVisible();
      const trashCard = getHomeCard(creatorPage, gameId);
      await expect(trashCard).toBeVisible();
      await openCardMenu(trashCard, "Restore game actions");
      await expect(trashCard.getByTestId("restore-game")).toBeVisible();
      await trashCard.getByTestId("restore-game").click();

      await creatorPage.goto("/");
      await expect(getHomeCard(creatorPage, gameId)).toBeVisible();
    } finally {
      await closeContextQuietly(creatorContext);
      await closeContextQuietly(viewerContext);
    }
  });

  test("E-18: viewer leave returns to the join flow without notifying the remaining player", async ({ browser, baseURL }) => {
    const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
    const { context: viewerContext, page: viewerPage } = await createIsolatedPage(browser);

    try {
      const { gameHash } = await createGameFromHome(creatorPage);
      await openDirectGameLink(viewerPage, baseURL, gameHash);
      await joinAsViewer(viewerPage);

      const latestBefore = await getLatestNote(creatorPage).textContent();
      const viewerMenu = viewerPage.locator('summary[aria-label="Leave game actions"]').first();
      await expect(viewerMenu).toBeVisible();
      await viewerMenu.click();
      await viewerPage.getByTestId("leave-viewer").click();

      await expectViewerFallbackJoinSurface(viewerPage);
      await expect(getLatestNote(creatorPage)).toHaveText(latestBefore ?? "");
    } finally {
      await closeContextQuietly(creatorContext);
      await closeContextQuietly(viewerContext);
    }
  });

  test("E-19: offline leave/delete controls stay visible but disabled with an explainer", async ({ browser }) => {
    const { context, page } = await createIsolatedPage(browser);

    try {
      const { gameId } = await createGameFromHome(page);
      await page.goto("/");
      const homeCard = getHomeCard(page, gameId);
      await expect(homeCard).toBeVisible();

      await setOfflineState(page, true);
      await openCardMenu(homeCard, "Delete game actions");
      const leaveButton = (await homeCard.getByTestId("leave-game").count()) > 0 ? homeCard.getByTestId("leave-game") : homeCard.getByTestId("delete-game");

      await expect(leaveButton).toBeVisible();
      await expect(leaveButton).toBeDisabled();
      await expect(homeCard.getByText("Not available offline.")).toBeVisible();
    } finally {
      await closeContextQuietly(context);
    }
  });

  test("E-20: self-play home cards label the hamburger action as Delete", async ({ browser }) => {
    const { context, page } = await createIsolatedPage(browser);

    try {
      await page.goto("/");
      await expect(page.getByTestId("home-create-game")).toBeVisible();

      const gameId = await createSelfPlayGameViaApi(page);
      await page.goto("/");

      const homeCard = getHomeCard(page, gameId);
      await expect(homeCard).toBeVisible();
      await openCardMenu(homeCard, "Delete game actions");
      await expect(homeCard.getByTestId("delete-game")).toHaveText("Delete");
    } finally {
      await closeContextQuietly(context);
    }
  });

  test("E-17: navigating directly to a missing game shows the game-not-found screen", async ({ browser }) => {
    const { context, page } = await createIsolatedPage(browser);

    try {
      await page.goto("/#/game/00000000-0000-4000-8000-000000000000");
      await expect(page.getByTestId("game-not-found")).toBeVisible();
      await expect(page.getByTestId("game-not-found")).toContainText("Game not found");
      await expect(page.getByTestId("restore-game")).toHaveCount(0);
      await expect(page.getByTestId("game-shell")).toHaveCount(0);
    } finally {
      await closeContextQuietly(context);
    }
  });
});
