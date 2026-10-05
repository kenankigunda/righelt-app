import { test, expect } from "@playwright/test";

import {
  closeContextQuietly,
  createGameFromHome,
  createIsolatedPage,
  getHistoryMoveCount,
  importScenarioGame,
  makeAnyLegalMove,
  waitForLegacyIdentity,
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

const createSelfPlayGameViaApi = async (page) => {
  await waitForLegacyIdentity(page);
  return page.evaluate(async () => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before creating a self-play game");
    }

    const response = await fetch("/api/shell/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: 2, identityId, selfPlayMode: true }),
    });
    const body = await response.json();
    if (!response.ok || !body?.game?.id) {
      throw new Error(`Self-play game creation failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return body.game.id;
  });
};

const importScenarioIntoExistingGame = async (page, scenario, targetGameId) =>
  page.evaluate(async ({ scenario: payload, targetGameId: gameId }) => {
    const identityId = window.localStorage.getItem("righelt.identity.id.v1");
    if (!identityId) {
      throw new Error("Expected identity id in local storage before importing scenario into an existing game");
    }

    const response = await fetch("/api/shell/scenarios/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: 2, identityId, targetGameId: gameId, scenario: payload }),
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
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
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
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
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

test("scenario flyout saves history-authored scenarios from the selected pre-move snapshot", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const scenarioTitle = `History export scenario ${Date.now()}`;
    const scenarioDescription = "Saved from a history entry and loaded back into a fresh game.";
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

    const historyMove = page.getByTestId("history-move-item").filter({ hasText: "Move 5: PROJECT (3,4) -> (5,4)" });
    await historyMove.click();

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();
    await page.locator('[data-scenario-save-field="title"]').fill(scenarioTitle);
    await page.locator('[data-scenario-save-field="description"]').fill(scenarioDescription);
    await page.locator('[data-action="save-scenario"]').click();

    await expect
      .poll(() => savedScenario?.resultingState ?? null, {
        message: "Expected the history-authored scenario save to capture the selected pre-move snapshot",
      })
      .not.toBeNull();
    expect(savedScenario.moves).toHaveLength(4);
    expect(savedScenario.resultingState.sideToMove).toBe("P1");
    expect(savedScenario.resultingState.turnIndex).toBe(4);
    expect(savedScenario.savedSelection).toEqual({
      source: { row: 3, col: 4 },
      target: { row: 5, col: 4 },
      actorSide: "P1",
      turnIndex: 4,
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(scenarioTitle);
    await page.locator('[data-action="load-scenario"]').click();

    await expect(page.locator('[data-testid="scenario-load-skeleton"]')).toHaveCount(0);
    await expect(page.locator("#shell-board-turn-indicator")).toContainText("Player 1 to play");
    await expect(page.locator("#shell-board-preview-label")).toContainText("project new piece to 5,4");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected loading the history-authored scenario to replay only the moves before the selected history action",
      })
      .toBe(savedScenario.moves.length);
    await expect
      .poll(async () => cellHasClass(getBoardCell(page, savedScenario.savedSelection.source), "source"), {
        message: "Expected the loaded history-authored scenario to rehydrate the saved source selection",
      })
      .toBe(true);
    await expect
      .poll(async () => cellHasClass(getBoardCell(page, savedScenario.savedSelection.target), "target"), {
        message: "Expected the loaded history-authored scenario to rehydrate the saved destination selection",
      })
      .toBe(true);
  } finally {
    await closeContextQuietly(context);
  }
});

test("scenario flyout updates an existing scenario from the selected history pre-move snapshot", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const scenarioId = "11111111-1111-4111-8111-111111111111";
    let savedScenario = {
      ...RUSH_CAN_END_SCENARIO,
      id: scenarioId,
      title: "History scenario to update",
      description: "Will be updated from a selected history move.",
      savedSelection: null,
    };

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: [savedScenario],
        }),
      });
    });

    await page.route("**/scenarios/update", async (route) => {
      savedScenario = route.request().postDataJSON()?.scenario ?? savedScenario;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          catalog: {
            id: "S",
            title: "Saved Scenarios",
            scenarios: [savedScenario],
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

    const historyMove = page.getByTestId("history-move-item").filter({ hasText: "Move 5: PROJECT (3,4) -> (5,4)" });
    await historyMove.click();

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText("History scenario to update");
    await page.locator('[data-action="update-scenario"]').click();

    await expect
      .poll(() => savedScenario?.resultingState ?? null, {
        message: "Expected the scenario update to capture the selected pre-move history snapshot",
      })
      .not.toBeNull();
    expect(savedScenario.id).toBe(scenarioId);
    expect(savedScenario.moves).toHaveLength(4);
    expect(savedScenario.resultingState.sideToMove).toBe("P1");
    expect(savedScenario.resultingState.turnIndex).toBe(4);
    expect(savedScenario.savedSelection).toEqual({
      source: { row: 3, col: 4 },
      target: { row: 5, col: 4 },
      actorSide: "P1",
      turnIndex: 4,
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText("History scenario to update");
    await page.locator('[data-action="load-scenario"]').click();

    await expect(page.locator('[data-testid="scenario-load-skeleton"]')).toHaveCount(0);
    await expect(page.locator("#shell-board-turn-indicator")).toContainText("Player 1 to play");
    await expect(page.locator("#shell-board-preview-label")).toContainText("project new piece to 5,4");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected loading the updated scenario to replay only the moves before the selected history action",
      })
      .toBe(savedScenario.moves.length);
    await expect
      .poll(async () => cellHasClass(getBoardCell(page, savedScenario.savedSelection.source), "source"), {
        message: "Expected the updated history-authored scenario to rehydrate the saved source selection",
      })
      .toBe(true);
    await expect
      .poll(async () => cellHasClass(getBoardCell(page, savedScenario.savedSelection.target), "target"), {
        message: "Expected the updated history-authored scenario to rehydrate the saved destination selection",
      })
      .toBe(true);
  } finally {
    await closeContextQuietly(context);
  }
});

test("scenario authoring surfaces local writer failures for save and update without leaving controls stuck pending", async ({
  browser,
}) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const scenarioId = "22222222-2222-4222-8222-222222222222";
    let updateRequests = 0;
    let saveRequests = 0;

    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: [
            {
              ...RUSH_CAN_END_SCENARIO,
              id: scenarioId,
              title: "Scenario that fails to update",
              description: "Used to prove local writer error handling.",
            },
          ],
        }),
      });
    });

    await page.route("**/scenarios/save", async (route) => {
      saveRequests += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "save_failed" }),
      });
    });

    await page.route("**/scenarios/update", async (route) => {
      updateRequests += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "update_failed" }),
      });
    });

    await createGameFromHome(page);
    await makeAnyLegalMove(page, "p1");

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();

    await page.locator('[data-scenario-save-field="title"]').fill("Save failure scenario");
    await page.locator('[data-scenario-save-field="description"]').fill("Should stay editable after a failed local save.");
    await page.locator('[data-action="save-scenario"]').click();

    await expect
      .poll(() => saveRequests, {
        message: "Expected the save button to attempt a local writer request",
      })
      .toBe(1);
    await expect(page.locator(".scenario-panel-create .debug-pre")).toContainText("Failed to save scenario locally.");
    await expect(page.locator('[data-action="save-scenario"]')).toBeEnabled();
    await expect(page.locator('[data-scenario-save-field="title"]')).toHaveValue("Save failure scenario");
    await expect(page.locator('[data-scenario-save-field="description"]')).toHaveValue(
      "Should stay editable after a failed local save.",
    );

    await page.locator('[data-action="update-scenario"]').click();

    await expect
      .poll(() => updateRequests, {
        message: "Expected the update button to attempt a local writer request",
      })
      .toBe(1);
    await expect(page.locator(".scenario-panel-load .debug-pre")).toContainText("Failed to update scenario locally.");
    await expect(page.locator('[data-action="update-scenario"]')).toBeEnabled();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText("Scenario that fails to update");
  } finally {
    await closeContextQuietly(context);
  }
});

test("scenario load surfaces import failures without leaving the flyout stuck pending", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.route("**/scenarios/catalog.json", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "S",
          title: "Saved Scenarios",
          scenarios: [RUSH_CAN_END_SCENARIO],
        }),
      });
    });

    let importRequests = 0;
    await page.route("**/api/shell/scenarios/import", async (route) => {
      importRequests += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "import_failed" }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("home-create-game")).toBeVisible();
    await page.getByTestId("home-create-game").click();
    await page.getByRole("button", { name: "Close invite", exact: true }).click();
    await expect(page.getByTestId("game-shell")).toBeVisible();

    await page.getByRole("button", { name: "Scenarios" }).click();
    await expect(page.locator("#scenario-select")).toBeVisible();
    await expect(page.locator('[data-scenario-editable="title"]')).toContainText(RUSH_CAN_END_SCENARIO.title);

    await page.locator('[data-action="load-scenario"]').click();

    await expect
      .poll(() => importRequests, {
        message: "Expected loading the scenario to attempt the import request",
      })
      .toBe(1);
    await expect(page.locator('[data-testid="scenario-load-skeleton"]')).toHaveCount(0);
    await expect(page.locator(".scenario-panel-load .debug-pre")).toContainText("Failed to load scenario.");
    await expect(page.locator('[data-action="load-scenario"]')).toBeEnabled();
    await expect(page.locator("#scenario-select")).toBeVisible();
  } finally {
    await closeContextQuietly(context);
  }
});
