import { test, expect } from "@playwright/test";

import {
  acceptPendingRequest,
  closeContextQuietly,
  createIsolatedPage,
  joinAsViewer,
  openDirectGameLink,
  requestPlayerJoin,
} from "../support/app.mjs";

const getHistoryMoveCount = async (page) => page.getByTestId("history-move-item").count();

const applyAnyLegalMoveViaApi = async (page) => {
  const startingCount = await getHistoryMoveCount(page);
  await page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      throw new Error("Expected identity and game hash before applying a replay test move");
    }
    const gameId = decodeURIComponent(match[1]);
    const gameResponse = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const gameBody = await gameResponse.json();
    const action = (Array.isArray(gameBody?.game?.legalActions) ? gameBody.game.legalActions : []).find(
      (candidate) => candidate?.from && candidate?.to,
    );
    if (!action) {
      throw new Error("No legal move available for replay E2E move");
    }
    const applyResponse = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identityId,
        state: gameBody.game.currentSnapshot,
        action,
        clientCommandId: `e2e-incoming-replay-${Date.now()}`,
      }),
    });
    const applyBody = await applyResponse.json();
    if (!applyResponse.ok || applyBody?.accepted !== true) {
      throw new Error(`Replay E2E move rejected: ${JSON.stringify(applyBody)}`);
    }
  });
  await expect
    .poll(async () => getHistoryMoveCount(page), {
      message: "Expected replay E2E move to appear in the history list",
    })
    .toBeGreaterThan(startingCount);
};

test("viewer replays unseen incoming human moves after browser focus returns", async ({ browser, baseURL }) => {
  const owner = await createIsolatedPage(browser);
  const opponent = await createIsolatedPage(browser);
  const viewer = await createIsolatedPage(browser);

  try {
    await viewer.page.addInitScript(() => {
      let focused = true;
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => focused,
      });
      globalThis.__setReplayFocusState = (next) => {
        focused = next !== false;
        window.dispatchEvent(new Event(focused ? "focus" : "blur"));
      };
    });

    await owner.page.goto("/");
    await expect(owner.page.getByTestId("home-create-game")).toBeVisible();
    const gameId = await owner.page.evaluate(async () => {
      const identityId = window.localStorage.getItem("righelt.identity.id.v1");
      if (!identityId) {
        throw new Error("Expected owner identity before creating a replay test game");
      }
      const response = await fetch("/api/shell/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identityId, selfPlayMode: false }),
      });
      const body = await response.json();
      if (!response.ok || !body?.game?.id) {
        throw new Error(`Replay test game creation failed: ${response.status}`);
      }
      return body.game.id;
    });
    const gameHash = `#/game/${encodeURIComponent(gameId)}`;
    await owner.page.goto(`${baseURL}${gameHash}`);
    await expect(owner.page.getByTestId("game-shell")).toBeVisible();

    await openDirectGameLink(opponent.page, baseURL, gameHash);
    await requestPlayerJoin(opponent.page);
    await acceptPendingRequest(owner.page);
    await expect(opponent.page.getByTestId("game-role")).toContainText("Player 2");

    await openDirectGameLink(viewer.page, baseURL, gameHash);
    await joinAsViewer(viewer.page);
    await expect(viewer.page.getByTestId("game-role")).toContainText("Viewer");

    await viewer.page.evaluate(() => globalThis.__setReplayFocusState(false));
    await expect.poll(() => viewer.page.evaluate(() => document.hasFocus())).toBe(false);

    await applyAnyLegalMoveViaApi(owner.page);
    await expect(opponent.page.getByTestId("active-turn-label")).toContainText("Player 2");
    await applyAnyLegalMoveViaApi(opponent.page);
    await expect(owner.page.getByTestId("active-turn-label")).toContainText("Player 1");
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getQueuedMoveIndexes?.(activeGameId)?.length ?? 0, gameId),
        { timeout: 10_000 },
      )
      .toBe(2);

    await expect(viewer.page.locator("#shell-board-preview-label")).not.toContainText("Incoming move");

    await viewer.page.evaluate(() => globalThis.__setReplayFocusState(true));
    await expect.poll(() => viewer.page.evaluate(() => document.hasFocus())).toBe(true);
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getActiveReplay?.(activeGameId)?.actorSeat ?? null, gameId),
        { timeout: 10_000 },
      )
      .toBe("Player 1");
    await expect(viewer.page.locator("#shell-board-turn-indicator")).toContainText("Replaying Player 1 move");
    await expect(viewer.page.locator("#shell-board-preview-label")).toContainText("Incoming move 1 of 2.");
    await expect
      .poll(async () => viewer.page.locator("#shell-board-turn-indicator").textContent(), {
        timeout: 2_500,
      })
      .toContain("Replaying Player 2 move");
    await expect(viewer.page.locator("#shell-board-preview-label")).toContainText("Incoming move 2 of 2.");
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(opponent.context);
    await closeContextQuietly(viewer.context);
  }
});
