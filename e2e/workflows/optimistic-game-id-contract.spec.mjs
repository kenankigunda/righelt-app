import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getCurrentGameIdFromPage,
  getHistoryMoveCount,
  launchHistoryBranchFromMove,
  makeAnyLegalMove,
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
