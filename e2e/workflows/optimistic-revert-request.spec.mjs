import { test, expect } from "@playwright/test";
import {isOperationRequest,operationValues} from "../support/shared-request.mjs";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  makeAnyLegalMove,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

test("undo-last-move applies optimistically before the revert request response returns", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    let delivered,release;const delivery=new Promise(resolve=>{delivered=resolve;});
    const blocked=new Promise(resolve=>{release=resolve;});
    await page.route(/\/api\/shell\/games\/[^/]+\/(shared|revert-request)$/, async (route) => {
      if (!isOperationRequest(route.request(),"revert-request")) {
        await route.fallback();
        return;
      }
      await blocked;
      try {await route.continue();}finally{delivered();}
    });

    const {gameId}=await createGameFromHome(page);
    await makeAnyLegalMove(page);

    await expect(page.locator('[data-action="undo-last-move"]')).toBeVisible();
    await page.locator('[data-action="undo-last-move"]').click();

    await expect(page.getByText("Latest: Move undone")).toBeVisible({ timeout: 700 });

    release();await delivery;
    await expect.poll(()=>page.evaluate(async gameId=>{const identity=localStorage.getItem("righelt.identity.id.v1");const body=await(await fetch(`/api/shell/games/${gameId}?identityId=${identity}`)).json();return body.game.moves.every(move=>move.undone);},gameId)).toBe(true);
    await expect(page.getByTestId("game-board-wrap")).toHaveAttribute("data-reconnecting","false");
    await expect(page.getByText(/Latest: (Move undone|Undo request accepted)/)).toBeVisible();
    await expect(page.locator('[data-action="undo-last-move"]')).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});

test("undo-last-move keeps the optimistic revert request id aligned when approval is required", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const created = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, created.gameHash);
    await requestPlayerJoin(guest.page);
    await acceptPendingRequest(owner.page);
    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");

    await makeAnyLegalMove(owner.page);

    let delivered;const delivery=new Promise(resolve=>{delivered=resolve;});
    let releaseRevertResponse = null;
    const revertResponseBlocked = new Promise((resolve) => {
      releaseRevertResponse = resolve;
    });
    await owner.page.route(/\/api\/shell\/games\/[^/]+\/(shared|revert-request)$/, async (route) => {
      if (!isOperationRequest(route.request(),"revert-request")) {
        await route.fallback();
        return;
      }
      await revertResponseBlocked;
      try {await route.continue();}finally{delivered();}
    });

    const revertRequestPromise = owner.page.waitForRequest((request) => {
      const url = new URL(request.url());
      return isOperationRequest(request,"revert-request");
    });

    await expect(owner.page.locator('[data-action="undo-last-move"]')).toBeVisible();
    await owner.page.locator('[data-action="undo-last-move"]').click();

    const rescindButton = owner.page.locator('[data-action="rescind-revert-request"]');
    await expect(rescindButton).toBeVisible({ timeout: 700 });
    await expect(owner.page.getByText("Latest: Undo request pending approval")).toBeVisible({ timeout: 700 });

    const revertRequest = await revertRequestPromise;
    const requestId = operationValues(revertRequest)?.requestId;
    expect(requestId).toMatch(/^revert-/);
    await expect.poll(async () => rescindButton.getAttribute("data-request-id")).toBe(requestId);

    releaseRevertResponse?.();await delivery;
    await expect.poll(()=>owner.page.evaluate(async gameId=>{const identity=localStorage.getItem("righelt.identity.id.v1");const body=await(await fetch(`/api/shell/games/${gameId}?identityId=${identity}`)).json();return body.game.pendingRevertRequest?.requestId;},created.gameId)).toBe(requestId);

    await expect(owner.page.getByText("Latest: Undo request pending approval")).toBeVisible();
    await expect(rescindButton).toHaveAttribute("data-request-id", requestId);
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});
