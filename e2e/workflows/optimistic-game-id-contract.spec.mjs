import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getCurrentGameIdFromPage,
  getHistoryMoveCount,
  launchHistoryBranchFromMove,
  makeAnyLegalMove,
  openPendingHistoryBranchFromMove,
} from "../support/app.mjs";

const waitForApplyRequestForGame = (page, gameId) =>
  page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "POST" && url.pathname === `/api/shell/games/${encodeURIComponent(gameId)}/apply`;
  });

test("optimistic create-game keeps route id, server id, and first apply target aligned", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const createRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && url.pathname === "/api/shell/games";
    });
    const created = await createGameFromHome(page);
    const initialHistoryCount = await getHistoryMoveCount(page);
    const applyRequestPromise = waitForApplyRequestForGame(page, created.gameId);
    const createRequest = await createRequestPromise;

    await makeAnyLegalMove(page, "p1");

    const applyRequest = await applyRequestPromise;
    expect(createRequest.postDataJSON()?.gameId).toBe(created.gameId);
    expect(created.serverGameId).toBe(created.gameId);
    expect(new URL(applyRequest.url()).pathname).toBe(`/api/shell/games/${created.gameId}/apply`);
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected the created game to record a move after the first optimistic action",
      })
      .toBeGreaterThan(initialHistoryCount);
  } finally {
    await closeContextQuietly(context);
  }
});

test("optimistic history branch keeps popup route id, server id, and first apply target aligned", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await createGameFromHome(page);
    await makeAnyLegalMove(page, "p1");

    const branchRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && url.pathname === "/api/shell/history/branch";
    });
    const { popup, branchBody, gameId } = await launchHistoryBranchFromMove(page, 0);
    const branchHistoryCount = await getHistoryMoveCount(popup);
    const applyRequestPromise = waitForApplyRequestForGame(popup, gameId);
    const branchRequest = await branchRequestPromise;

    expect(branchRequest.postDataJSON()?.gameId).toBe(gameId);
    expect(branchBody?.game?.id).toBe(gameId);
    expect(await getCurrentGameIdFromPage(popup)).toBe(gameId);

    await makeAnyLegalMove(popup, "p1");

    const applyRequest = await applyRequestPromise;
    expect(new URL(applyRequest.url()).pathname).toBe(`/api/shell/games/${gameId}/apply`);
    await expect
      .poll(async () => getHistoryMoveCount(popup), {
        message: "Expected the branched game to record a move after its first optimistic action",
      })
      .toBeGreaterThan(branchHistoryCount);

  } finally {
    await closeContextQuietly(context);
  }
});

test("optimistic history branch renders the popup shell before the branch response returns", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    let releaseBranchResponse = null;
    const branchRequestBlocked = new Promise((resolve) => {
      releaseBranchResponse = resolve;
    });
    const branchRequestSeen = new Promise((resolve) => {
      context.route("**/api/shell/history/branch", async (route) => {
        if (route.request().method() !== "POST") {
          await route.fallback();
          return;
        }
        resolve();
        await branchRequestBlocked;
        await route.fallback();
      });
    });

    await createGameFromHome(page);
    await makeAnyLegalMove(page, "p1");

    const { popup, gameId } = await openPendingHistoryBranchFromMove(page, 0);
    await branchRequestSeen;
    const pendingHistoryCount = await getHistoryMoveCount(popup);
    const applyRequestPromise = waitForApplyRequestForGame(popup, gameId);

    await expect(popup.getByTestId("game-shell")).toBeVisible();
    await expect(popup.getByTestId("game-role")).toContainText("Player 1");
    await expect(popup.getByText("Latest: History branch pending sync")).toBeVisible();
    await expect(popup).toHaveURL(new RegExp(`#\\/game\\/${gameId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`));

    releaseBranchResponse?.();

    await expect(popup.getByTestId("game-shell")).toBeVisible();
    await makeAnyLegalMove(popup, "p1");

    const applyRequest = await applyRequestPromise;
    expect(new URL(applyRequest.url()).pathname).toBe(`/api/shell/games/${gameId}/apply`);
    await expect
      .poll(async () => getHistoryMoveCount(popup), {
        message: "Expected the delayed-commit history branch popup to remain usable after the branch response completes",
      })
      .toBeGreaterThan(pendingHistoryCount);
  } finally {
    await closeContextQuietly(context);
  }
});
