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

const applyLegalActionViaApi = async (page, { preferredType = null } = {}) => {
  const startingCount = await getHistoryMoveCount(page);
  const action = await page.evaluate(async ({ preferredType: requestedType }) => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      throw new Error("Expected identity and game hash before applying a replay test move");
    }
    const gameId = decodeURIComponent(match[1]);
    const gameResponse = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const gameBody = await gameResponse.json();
    const snapshotPieces = Array.isArray(gameBody?.game?.currentSnapshot?.pieces) ? gameBody.game.currentSnapshot.pieces : [];
    const legalActions = Array.isArray(gameBody?.game?.legalActions) ? gameBody.game.legalActions : [];
    const action =
      (requestedType ? legalActions.find((candidate) => candidate?.type === requestedType) : null) ??
      legalActions.find(
        (candidate) =>
          candidate?.from &&
          candidate?.to &&
          !snapshotPieces.some(
            (piece) => piece?.position?.row === candidate.to.row && piece?.position?.col === candidate.to.col,
          ),
      ) ??
      legalActions.find((candidate) => candidate?.from && candidate?.to);
    if (!action) {
      throw new Error(`No legal ${requestedType ?? "replay"} action available for replay E2E move`);
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
    return action;
  }, { preferredType });
  await expect
    .poll(async () => getHistoryMoveCount(page), {
      message: "Expected replay E2E move to appear in the history list",
    })
    .toBeGreaterThan(startingCount);
  return action;
};

const getRenderableTokenCountAt = async (page, coord, { ghosts = false } = {}) =>
  page.locator(
    `[data-testid="game-board"] .cell[data-row="${coord.row}"][data-col="${coord.col}"] .piece-token${
      ghosts ? ".move-ghost" : ':not(.move-ghost):not(.history-destruction-piece):not(.removal-piece)'
    }`,
  ).count();

const getReplayDecoratedTokenCountAt = async (page, coord) =>
  page.locator(
    `[data-testid="game-board"] .cell[data-row="${coord.row}"][data-col="${coord.col}"] .piece-token.preview-created`,
  ).count();

test("viewer replays incoming moves without focused-start flicker and still keeps a hidden lead-in after refocus", async ({ browser, baseURL }) => {
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

    const firstAction = await applyLegalActionViaApi(owner.page);
    await expect(opponent.page.getByTestId("active-turn-label")).toContainText("Player 2");
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getReplayState?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toMatchObject({ actorSeat: "Player 1", phase: "lead-in", moveIndex: 0 });
    await expect(viewer.page.locator("#shell-board-preview-label")).not.toContainText("Incoming move");
    await expect(viewer.page.locator("#shell-board-turn-indicator")).not.toContainText("Replaying");
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, firstAction.to)).toBe(0);
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, firstAction.to, { ghosts: true })).toBe(0);

    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getActiveReplay?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toMatchObject({ actorSeat: "Player 1", phase: "preview", moveIndex: 0 });
    await expect(viewer.page.locator("#shell-board-turn-indicator")).toContainText("Replaying Player 1 move");
    await expect(viewer.page.locator("#shell-board-preview-label")).toContainText("Incoming move.");
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, firstAction.to, { ghosts: true })).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getActiveReplay?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toMatchObject({ actorSeat: "Player 1", phase: "settle", moveIndex: 0 });
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, firstAction.to)).toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getReplayState?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toBeNull();

    await viewer.page.evaluate(() => globalThis.__setReplayFocusState(false));
    await expect.poll(() => viewer.page.evaluate(() => document.hasFocus())).toBe(false);

    const secondAction = await applyLegalActionViaApi(opponent.page);
    await expect(owner.page.getByTestId("active-turn-label")).toContainText("Player 1");
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getQueuedMoveIndexes?.(activeGameId)?.length ?? 0, gameId),
        { timeout: 10_000 },
      )
      .toBe(1);

    await viewer.page.evaluate(() => globalThis.__setReplayFocusState(true));
    await expect.poll(() => viewer.page.evaluate(() => document.hasFocus())).toBe(true);
    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getActiveReplay?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toMatchObject({ actorSeat: "Player 2", phase: "lead-in", moveIndex: 1 });
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, secondAction.to)).toBe(0);
    await expect(viewer.page.locator("#shell-board-turn-indicator")).toContainText("Player 2 to play");
    await expect(viewer.page.locator("#shell-board-preview-label")).not.toContainText("Incoming move");
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(opponent.context);
    await closeContextQuietly(viewer.context);
  }
});

test("viewer project replay goes from an empty target directly to the recorded-style overlay without an intermediate ghost state", async ({
  browser,
  baseURL,
}) => {
  const owner = await createIsolatedPage(browser);
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

    await openDirectGameLink(viewer.page, baseURL, gameHash);
    await joinAsViewer(viewer.page);
    await expect(viewer.page.getByTestId("game-role")).toContainText("Viewer");

    const projectAction = await applyLegalActionViaApi(owner.page, { preferredType: "project" });

    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getReplayState?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toMatchObject({ actorSeat: "Player 1", phase: "lead-in", moveIndex: 0 });

    await expect.poll(() => getRenderableTokenCountAt(viewer.page, projectAction.to)).toBe(0);
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, projectAction.to, { ghosts: true })).toBe(0);
    await expect.poll(() => getReplayDecoratedTokenCountAt(viewer.page, projectAction.to)).toBe(0);

    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getActiveReplay?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toMatchObject({ actorSeat: "Player 1", phase: "preview", moveIndex: 0 });

    await expect.poll(() => getRenderableTokenCountAt(viewer.page, projectAction.to)).toBeGreaterThan(0);
    await expect.poll(() => getRenderableTokenCountAt(viewer.page, projectAction.to, { ghosts: true })).toBe(0);
    await expect.poll(() => getReplayDecoratedTokenCountAt(viewer.page, projectAction.to)).toBeGreaterThan(0);

    await expect
      .poll(
        () =>
          viewer.page.evaluate((activeGameId) => globalThis.__righeltIncomingMoveReplay?.getReplayState?.(activeGameId), gameId),
        { timeout: 10_000 },
      )
      .toBeNull();
    await expect.poll(() => getReplayDecoratedTokenCountAt(viewer.page, projectAction.to)).toBe(0);
  } finally {
    await closeContextQuietly(owner.context);
    await closeContextQuietly(viewer.context);
  }
});
