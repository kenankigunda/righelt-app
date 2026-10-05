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
      body: JSON.stringify({ protocolVersion: 2, identityId, targetMoveId }),
    });
    const revertBody = await revertResponse.json();
    if (!revertResponse.ok) {
      throw new Error(`Undo request failed: ${revertResponse.status} ${JSON.stringify(revertBody)}`);
    }
    return revertBody;
  });

test("accepting undo preserves each selected retained entry until explicit return to live", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const guest = await createIsolatedPage(browser);

  try {
    const { gameHash } = await createGameFromHome(owner.page);
    await openDirectGameLink(guest.page, baseURL, gameHash);
    await requestPlayerJoin(guest.page);
    await acceptPendingRequest(owner.page);
    await expect(guest.page.getByTestId("game-role")).toContainText("Player 2");

    await makeAnyLegalMove(owner.page, "p1");
    await makeAnyLegalMove(guest.page, "p2");

    await openHistoryMode(owner.page, 0);
    await openHistoryMode(guest.page, 0);

    const selectedId = await owner.page.locator('[data-testid="history-move-item"].is-selected').getAttribute("data-move-id");
    await requestUndoForFirstMoveViaApi(owner.page);
    await expect(guest.page.locator('[data-action="accept-revert-request"]')).toBeVisible();

    const approvalResponse = guest.page.waitForResponse(response => response.url().endsWith("/revert-approve") && response.request().method() === "POST");
    await guest.page.locator('[data-action="accept-revert-request"]').click();
    const response = await approvalResponse;
    expect(response.ok()).toBe(true);
    const approved = await response.json();
    const liveState = approved.game.board.state;
    const expectedBoard = Array.from({ length: liveState.boardSize ** 2 }, (_, index) => {
      const row = Math.floor(index / liveState.boardSize), col = index % liveState.boardSize;
      return { row, col, pieces: liveState.pieces.filter(piece => piece.position?.row === row && piece.position?.col === col).map(piece => `${piece.owner}:${piece.kind}`).sort() };
    });

    for (const page of [owner.page, guest.page]) {
      await expect(page.getByTestId("history-return-live")).toBeVisible();
      await page.locator('[data-action="toggle-undone-group"]').first().click();
      const selected = page.locator(`[data-testid="history-move-item"][data-move-id="${selectedId}"]`);
      await expect(selected).toHaveClass(/is-selected/);
      await expect(selected).toHaveClass(/is-undone/);
      await page.getByTestId("history-return-live").click();
    }
    await expect(owner.page.getByTestId("history-return-live")).toHaveCount(0);
    await expect(guest.page.getByTestId("history-return-live")).toHaveCount(0);
    await expect(owner.page.getByText("You are on the live view.")).toBeVisible();
    await expect(guest.page.getByText("You are on the live view.")).toBeVisible();
    // Action previews and recorded-action ghosts vary with pointer/selection.
    // Compare actual rendered pieces to the confirmed server state on each page.
    const board = page => page.locator('[data-testid="game-board"] .cell').evaluateAll(cells => cells.map(cell => ({
      row: Number(cell.dataset.row), col: Number(cell.dataset.col),
      pieces: [...cell.querySelectorAll('.piece-token:not(.move-ghost):not(.history-destruction-piece):not(.removal-piece)')]
        .map(piece => `${piece.classList.contains("p1") ? "P1" : piece.classList.contains("p2") ? "P2" : "unknown"}:${piece.classList.contains("commander") ? "commander" : piece.classList.contains("unit") ? "unit" : "unknown"}`).sort(),
    })));
    expect(expectedBoard).toHaveLength(100);
    expect(expectedBoard.some(cell => cell.pieces.length)).toBe(true);
    for (const page of [owner.page, guest.page]) await expect.poll(() => board(page)).toEqual(expectedBoard);
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(guest.context);
  }
});
