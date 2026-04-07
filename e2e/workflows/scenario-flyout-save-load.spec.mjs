import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  importScenarioGame,
  makeAnyLegalMove,
} from "../support/app.mjs";

const buildPiece = (id, owner, kind, row, col) => ({
  id,
  owner,
  kind,
  position: { row, col },
  supplied: true,
  commanded: true,
});

const RUSH_CAN_END_SCENARIO = {
  formatVersion: 2,
  id: "e0fdf81d-4545-4eca-a55b-8b384d7f8f08",
  title: "Scenario save/load end-turn settlement fixture",
  description: "Rush continuation that can be ended before saving a settled board state.",
  incorrect: false,
  initialState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    pieces: [
      buildPiece("C1", "P1", "commander", 3, 6),
      buildPiece("C2", "P2", "commander", 6, 3),
    ],
    continuation: null,
    outcome: { status: "ongoing" },
  },
  moves: [
    {
      turnIndex: 0,
      turnMoveIndex: 0,
      actorSide: "P1",
      notation: "PROJECT (3,6) -> (5,6)",
      action: { type: "project", actorId: "C1", from: { row: 3, col: 6 }, to: { row: 5, col: 6 } },
    },
    {
      turnIndex: 1,
      turnMoveIndex: 0,
      actorSide: "P2",
      notation: "PROJECT (6,3) -> (4,3)",
      action: { type: "project", actorId: "C2", from: { row: 6, col: 3 }, to: { row: 4, col: 3 } },
    },
    {
      turnIndex: 2,
      turnMoveIndex: 0,
      actorSide: "P1",
      notation: "PROJECT (3,6) -> (3,4)",
      action: { type: "project", actorId: "C1", from: { row: 3, col: 6 }, to: { row: 3, col: 4 } },
    },
    {
      turnIndex: 3,
      turnMoveIndex: 0,
      actorSide: "P2",
      notation: "PROJECT (6,3) -> (6,5)",
      action: { type: "project", actorId: "C2", from: { row: 6, col: 3 }, to: { row: 6, col: 5 } },
    },
    {
      turnIndex: 4,
      turnMoveIndex: 0,
      actorSide: "P1",
      notation: "PROJECT (3,4) -> (5,4)",
      action: { type: "project", actorId: "U1-2", from: { row: 3, col: 4 }, to: { row: 5, col: 4 } },
    },
    {
      turnIndex: 5,
      turnMoveIndex: 0,
      actorSide: "P2",
      notation: "RUSH (4,3) -> (5,3)",
      action: { type: "rush", actorId: "U2-1", from: { row: 4, col: 3 }, to: { row: 5, col: 3 } },
    },
  ],
  resultingState: {
    boardSize: 10,
    sideToMove: "P2",
    turnIndex: 5,
    pieces: [
      buildPiece("C1", "P1", "commander", 3, 6),
      buildPiece("U1-1", "P1", "unit", 5, 6),
      buildPiece("U1-2", "P1", "unit", 3, 4),
      buildPiece("U1-3", "P1", "unit", 5, 4),
      buildPiece("C2", "P2", "commander", 6, 3),
      buildPiece("U2-1", "P2", "unit", 5, 3),
      buildPiece("U2-2", "P2", "unit", 6, 5),
    ],
    continuation: {
      type: "rush",
      owner: "P2",
      frozenOwner: "P2",
      frozenPieceStatesById: {
        C2: { supplied: true, commanded: true },
        "U2-1": { supplied: true, commanded: true },
        "U2-2": { supplied: true, commanded: true },
      },
      rushedPieceIds: ["U2-1"],
      rushChainPieceIds: ["C2", "U2-1"],
      chainLength: 1,
    },
    outcome: { status: "ongoing" },
  },
  expectedFinalStateHash: "hash-placeholder",
  expectedOutcome: "ongoing",
};

const getBoardCell = (page, coord) =>
  page.locator(`[data-testid="game-board"] .cell[data-row="${coord.row}"][data-col="${coord.col}"]`);

const cellHasClass = async (locator, className) =>
  locator.evaluate((element, token) => element.classList.contains(token), className);

const getLegalActions = async (page) =>
  page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
    if (!identityId || !match) {
      return [];
    }

    const gameId = decodeURIComponent(match[1]);
    const response = await fetch(`/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}`);
    const body = await response.json();
    return Array.isArray(body?.game?.legalActions) ? body.game.legalActions : [];
  });

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

const importScenarioIntoExistingGame = async (page, scenario, targetGameId) =>
  page.evaluate(async ({ scenario: payload, targetGameId: gameId }) => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before importing scenario into an existing game");
    }

    const response = await fetch("/api/shell/scenarios/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, targetGameId: gameId, scenario: payload }),
    });
    const body = await response.json();
    if (!response.ok || !body?.game?.id) {
      throw new Error(`Scenario import failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return body.game.id;
  }, { scenario, targetGameId });

test("scenario flyout can save the current board and load that scenario into a new empty game", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const scenarioTitle = `Tester scenario ${Date.now()}`;
    const scenarioDescription = "Saved from the browser flow and then loaded back into a fresh game.";
    let savedScenario = null;

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: savedScenario ? [savedScenario] : [],
        }),
      });
    });

    await page.route("**/scenarios/save", async (route) => {
      const requestBody = route.request().postDataJSON();
      savedScenario = requestBody?.scenario ?? null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          catalog: {
            id: "S",
            title: "Saved Scenarios",
            scenarios: savedScenario ? [savedScenario] : [],
          },
        }),
      });
    });

    await createGameFromHome(page);
    await makeAnyLegalMove(page, "p1");

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();

    await page.locator('[data-scenario-save-field="title"]').fill(scenarioTitle);
    await page.locator('[data-scenario-save-field="description"]').fill(scenarioDescription);
    await page.locator('[data-action="save-scenario"]').click();

    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(scenarioTitle);
    await expect(page.locator("#scenario-select")).toContainText(scenarioTitle);

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    const initialHistoryCount = await getHistoryMoveCount(page);
    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(scenarioTitle);
    await expect(page.locator('[data-action="load-scenario"]')).toHaveText("Load into This Game");

    await page.locator('[data-action="load-scenario"]').click();

    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected loading the saved scenario to replace the empty game with the saved scenario history",
      })
      .toBeGreaterThan(initialHistoryCount);
    await expect(page.locator('[data-testid="scenario-load-skeleton"]')).toHaveCount(0);
    await expect(page.locator('[data-scenario-editable="title"]')).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});

test("scenario flyout round-trips a settled post-rush board state after ending the continuation", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const scenarioTitle = `Settled rush scenario ${Date.now()}`;
    const scenarioDescription = "Saved after ending a rush chain and selecting a follow-up action.";
    let savedScenario = null;

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: savedScenario ? [savedScenario] : [],
        }),
      });
    });

    await page.route("**/scenarios/save", async (route) => {
      savedScenario = route.request().postDataJSON()?.scenario ?? null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          catalog: {
            id: "S",
            title: "Saved Scenarios",
            scenarios: savedScenario ? [savedScenario] : [],
          },
        }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    const gameId = await createSelfPlayGameViaApi(page);
    await importScenarioIntoExistingGame(page, RUSH_CAN_END_SCENARIO, gameId);
    await page.goto(`${baseURL}#/game/${encodeURIComponent(gameId)}`);
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.locator("#shell-board-preview-label")).toContainText("Continue rushing on one of the");
    await expect(page.locator('[data-board-preview-action="end-turn"]')).toBeVisible();

    await page.locator('[data-board-preview-action="end-turn"]').click();

    await expect(page.locator("#shell-board-turn-indicator")).toContainText("Player 1 to play");
    await expect(page.locator('[data-board-preview-action="end-turn"]')).toHaveCount(0);
    await expect(page.locator("#shell-board-preview-label")).not.toContainText("Continue rushing on one of the");

    const selectionAction = {
      type: "project",
      from: { row: 5, col: 4 },
      to: { row: 7, col: 4 },
    };
    await expect
      .poll(async () => {
        const legalActions = await getLegalActions(page);
        return legalActions.some(
          (action) =>
            action?.type === selectionAction.type &&
            action?.from?.row === selectionAction.from.row &&
            action?.from?.col === selectionAction.from.col &&
            action?.to?.row === selectionAction.to.row &&
            action?.to?.col === selectionAction.to.col,
        );
      }, {
        message: "Expected the settled board to expose the intended follow-up selection for scenario authoring",
      })
      .toBe(true);

    const sourceCell = getBoardCell(page, selectionAction.from);
    const targetCell = getBoardCell(page, selectionAction.to);

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();

    await sourceCell.click();
    await targetCell.click();

    await page.locator('[data-scenario-save-field="title"]').fill(scenarioTitle);
    await page.locator('[data-scenario-save-field="description"]').fill(scenarioDescription);
    await page.locator('[data-action="save-scenario"]').click();

    await expect
      .poll(() => savedScenario?.resultingState ?? null, {
        message: "Expected the saved scenario to capture the settled post-rush board state",
      })
      .not.toBeNull();
    expect(savedScenario.resultingState.sideToMove).toBe("P1");
    expect(savedScenario.resultingState.turnIndex).toBe(6);
    expect(savedScenario.resultingState.continuation).toBeNull();
    expect(savedScenario.savedSelection).toEqual({
      source: selectionAction.from,
      target: selectionAction.to,
      actorSide: "P1",
      turnIndex: 6,
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(scenarioTitle);
    await page.locator('[data-action="load-scenario"]').click();

    await expect(page.locator('[data-testid="scenario-load-skeleton"]')).toHaveCount(0);
    await expect(page.locator("#shell-board-turn-indicator")).toContainText("Player 1 to play");
    await expect(page.locator("#shell-board-preview-label")).toContainText("project new piece to 7,4");
    await expect(page.locator("#shell-board-preview-label")).not.toContainText("Continue rushing on one of the");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected loading the saved scenario to restore the replayed move history without adding a synthetic end-turn move",
      })
      .toBe(savedScenario.moves.length);
    await expect
      .poll(async () => cellHasClass(getBoardCell(page, savedScenario.savedSelection.source), "source"), {
        message: "Expected the loaded scenario to rehydrate the saved source selection on the settled board",
      })
      .toBe(true);
    await expect
      .poll(async () => cellHasClass(getBoardCell(page, savedScenario.savedSelection.target), "target"), {
        message: "Expected the loaded scenario to rehydrate the saved destination selection on the settled board",
      })
      .toBe(true);
  } finally {
    await closeContextQuietly(context);
  }
});
