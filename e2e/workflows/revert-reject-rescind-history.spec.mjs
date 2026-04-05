import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  makeAnyLegalMove,
  openDirectGameLink,
  openHistoryMode,
  requestPlayerJoin,
} from "../support/app.mjs";

const requestUndoForFirstMoveViaApi = async (page) =>
  page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      throw new Error("Expected identity and game route before requesting undo");
    }

    const gameId = decodeURIComponent(match[1]);
    const gameResponse = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const gameBody = await gameResponse.json();
    const targetMoveId = gameBody?.game?.moves?.[0]?.moveId ?? null;
    if (!targetMoveId) {
      throw new Error("Expected at least one move before requesting undo");
    }

    const revertResponse = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}/revert-request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, targetMoveId }),
    });
    const revertBody = await revertResponse.json();
    if (!revertResponse.ok) {
      throw new Error(`Undo request failed: ${revertResponse.status} ${JSON.stringify(revertBody)}`);
    }
    return revertBody;
  });

test("rejecting an undo request keeps a history viewer pinned to history mode", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, gameHash);
    await requestPlayerJoin(guest.page);
    await acceptPendingRequest(owner.page);
    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");

    await makeAnyLegalMove(owner.page, "p1");
    await openHistoryMode(guest.page, 0);

    await requestUndoForFirstMoveViaApi(owner.page);
    await expect(guest.page.locator('[data-action="reject-revert-request"]')).toBeVisible();

    await guest.page.locator('[data-action="reject-revert-request"]').click();

    await expect(guest.page.getByTestId("history-return-live")).toBeVisible();
    await expect(guest.page.getByText("You are on the live view.")).toHaveCount(0);
    await expect(guest.page.locator('[data-action="reject-revert-request"]')).toHaveCount(0);
    await expect(owner.page.locator('[data-action="rescind-revert-request"]')).toHaveCount(0);
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});

test("rescinding an undo request keeps the requester pinned to history mode", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, gameHash);
    await requestPlayerJoin(guest.page);
    await acceptPendingRequest(owner.page);
    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");

    await makeAnyLegalMove(owner.page, "p1");
    await openHistoryMode(owner.page, 0);

    await requestUndoForFirstMoveViaApi(owner.page);
    await expect(owner.page.locator('[data-action="rescind-revert-request"]')).toBeVisible();

    await owner.page.locator('[data-action="rescind-revert-request"]').click();

    await expect(owner.page.getByTestId("history-return-live")).toBeVisible();
    await expect(owner.page.getByText("You are on the live view.")).toHaveCount(0);
    await expect(owner.page.locator('[data-action="rescind-revert-request"]')).toHaveCount(0);
    await expect(guest.page.locator('[data-action="accept-revert-request"]')).toHaveCount(0);
    await expect(guest.page.locator('[data-action="reject-revert-request"]')).toHaveCount(0);
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});
