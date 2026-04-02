import { expect } from "@playwright/test";

const historyMoveItems = (page) => page.locator('[data-testid="history-move-item"]');

const locatorIsVisible = async (locator) => {
  if ((await locator.count()) === 0) {
    return false;
  }
  return locator.first().isVisible();
};

const getVisibleJoinSurface = async (page) => {
  if (await locatorIsVisible(page.getByTestId("invite-join-viewer"))) {
    return "invite-gate";
  }

  if (await locatorIsVisible(page.getByTestId("join-viewer"))) {
    return "join-panel";
  }

  if (await locatorIsVisible(page.getByTestId("invite-gate"))) {
    return "invite-gate";
  }

  if (await locatorIsVisible(page.getByTestId("join-invite-heading"))) {
    return "join-panel";
  }

  return null;
};

export const buildAppUrl = (baseURL, hash = "#/") => `${baseURL}${hash}`;

export const createIsolatedPage = async (browser) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
};

export const createGameFromHome = async (page) => {
  await page.goto("/");
  await expect(page.getByTestId("home-create-game")).toBeVisible();
  await page.getByTestId("home-create-game").click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.getByTestId("game-role")).toContainText("Player 1");

  const url = new URL(page.url());
  const match = url.hash.match(/^#\/game\/([^?]+)/);
  if (!match) {
    throw new Error(`Expected game hash after creation, received ${url.hash}`);
  }

  return {
    gameHash: url.hash,
    gameId: decodeURIComponent(match[1]),
  };
};

export const openDirectGameLink = async (page, baseURL, gameHash) => {
  await page.goto(buildAppUrl(baseURL, gameHash));
  await expect
    .poll(async () => getVisibleJoinSurface(page), {
      message: "Expected either the invite gate or in-game join panel to render for a new device",
    })
    .not.toBeNull();
};

export const joinAsViewer = async (page) => {
  if (await getVisibleJoinSurface(page) === "invite-gate") {
    await page.getByTestId("invite-join-viewer").click();
  } else {
    await page.getByTestId("join-viewer").click();
  }
  await expect(page.getByTestId("game-role")).toContainText("Viewer");
};

export const requestPlayerJoin = async (page) => {
  if (await getVisibleJoinSurface(page) === "invite-gate") {
    await page.getByTestId("invite-join-player").click();
  } else {
    await page.getByTestId("join-player").click();
  }
  await expect(page.getByTestId("game-role")).toContainText("Viewer");
  await expect(page.getByTestId("pending-player-request-notice")).toBeVisible();
};

export const acceptPendingRequest = async (page) => {
  await expect(page.getByTestId("approval-gate")).toBeVisible();
  await page.getByTestId("accept-request").click();
  await expect(page.getByTestId("approval-gate")).toHaveCount(0);
};

export const ignorePendingRequest = async (page) => {
  await expect(page.getByTestId("approval-gate")).toBeVisible();
  await page.getByTestId("ignore-request").click();
  await expect(page.getByTestId("approval-gate")).toHaveCount(0);
};

export const getHistoryMoveCount = async (page) => historyMoveItems(page).count();

export const expectHistoryMoveCountToIncrease = async (page, initialCount) => {
  await expect
    .poll(async () => getHistoryMoveCount(page), {
      message: "Expected browser history move count to increase",
    })
    .toBeGreaterThan(initialCount);
};

const getFirstPlayableAction = async (page) =>
  page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      return null;
    }

    const gameId = decodeURIComponent(match[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const body = await response.json();
    const legalActions = Array.isArray(body?.game?.legalActions) ? body.game.legalActions : [];
    return legalActions.find((action) => action?.from && action?.to) ?? null;
  });

export const makeAnyLegalMove = async (page, ownerClass = "p1") => {
  const startingHistoryCount = await getHistoryMoveCount(page);
  const action = await getFirstPlayableAction(page);

  if (!action?.from || !action?.to) {
    throw new Error(`No playable browser action was exposed in the live game payload for ${ownerClass.toUpperCase()}`);
  }

  const sourceCell = page.locator(
    `[data-testid="game-board"] .cell[data-row="${action.from.row}"][data-col="${action.from.col}"]`,
  );
  const targetCell = page.locator(
    `[data-testid="game-board"] .cell[data-row="${action.to.row}"][data-col="${action.to.col}"]`,
  );

  await sourceCell.click();
  await expect
    .poll(async () => {
      await targetCell.hover();
      return targetCell.evaluate((cell) => cell.classList.contains("target"));
    }, {
      timeout: 2_000,
      message: "Expected hovering the legal destination to select it in the live board UI",
    })
    .toBe(true);
  await targetCell.click();
  await expectHistoryMoveCountToIncrease(page, startingHistoryCount);
};

export const openHistoryAndReturnLive = async (page) => {
  await expect(historyMoveItems(page).first()).toBeVisible();
  await historyMoveItems(page).first().click();
  await expect(page.getByTestId("history-return-live")).toBeVisible();
  await page.getByTestId("history-return-live").click();
  await expect(page.getByTestId("history-return-live")).toHaveCount(0);
};

export const closeContextQuietly = async (context) => {
  try {
    await context.close();
  } catch {
    // Ignore teardown races after Playwright aborts the test on timeout.
  }
};
