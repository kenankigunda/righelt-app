import { test, expect } from "@playwright/test";

import { closeContextQuietly, createIsolatedPage, importScenarioGame } from "../support/app.mjs";

const RUSH_BLOCKER_SCENARIO = {
  formatVersion: 2,
  id: "5e4b7ef0-2ab6-4ee7-9b1f-7c81f4088e3f",
  title: "Rush blocker preview",
  description: "Non-closable rush continuation that becomes closable after one reconnecting rush",
  incorrect: false,
  initialState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["A"],
      rushChainPieceIds: ["A"],
      chainLength: 1,
    },
    outcome: { status: "ongoing" },
    pieces: [
      { id: "A", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
      { id: "D", owner: "P1", kind: "unit", position: { row: 6, col: 5 }, supplied: true, commanded: true },
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 7, col: 1 }, supplied: true, commanded: true },
      { id: "E0", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
      { id: "E1", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      { id: "E2", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
      { id: "E3", owner: "P2", kind: "unit", position: { row: 6, col: 3 }, supplied: true, commanded: true },
    ],
  },
  moves: [],
  resultingState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: {
      type: "rush",
      owner: "P1",
      rushedPieceIds: ["A"],
      rushChainPieceIds: ["A"],
      chainLength: 1,
    },
    outcome: { status: "ongoing" },
    pieces: [
      { id: "A", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
      { id: "D", owner: "P1", kind: "unit", position: { row: 6, col: 5 }, supplied: true, commanded: true },
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 7, col: 1 }, supplied: true, commanded: true },
      { id: "E0", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
      { id: "E1", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      { id: "E2", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
      { id: "E3", owner: "P2", kind: "unit", position: { row: 6, col: 3 }, supplied: true, commanded: true },
    ],
  },
  expectedFinalStateHash: "hash-placeholder",
  expectedOutcome: "ongoing",
};

test("rush blocker preview chip matches the highlighted square", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, RUSH_BLOCKER_SCENARIO, baseURL);

    const previewLabel = page.locator("#shell-board-preview-label");
    await expect(page.getByTestId("game-role")).toContainText("Player 1");
    await expect(previewLabel).toContainText("Continue rushing on one of the highlighted squares to reconnect your piece at");
    const blockerChip = previewLabel.locator(".board-preview-coordinate-chip-rush-blocker");
    await expect(blockerChip).toHaveText("4,3");

    const blockerCell = page.locator('[data-testid="game-board"] .cell[data-row="4"][data-col="3"]');
    await expect
      .poll(async () => blockerCell.evaluate((cell) => cell.classList.contains("rush-blocker")), {
        message: "Expected the named rush blocker square to carry the dedicated rush-blocker highlight",
      })
      .toBe(true);

  } finally {
    await closeContextQuietly(context);
  }
});
