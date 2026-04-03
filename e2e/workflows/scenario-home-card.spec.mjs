import { test, expect } from "@playwright/test";

import { closeContextQuietly, createIsolatedPage, importScenarioGame } from "../support/app.mjs";

const HOME_CARD_SCENARIO = {
  formatVersion: 2,
  id: "5e4b7ef0-2ab6-4ee7-9b1f-7c81f4088e3f",
  title: "Home card scenario preview",
  description: "Imported scenarios should surface the right home-card snapshot.",
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

test("scenario import creates a home card with the imported preview state", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { gameId } = await importScenarioGame(page, HOME_CARD_SCENARIO, baseURL);

    await page.getByRole("link", { name: "Righelt" }).click();
    const homeCard = page.locator(`[data-game-id="${gameId}"]`).first();
    await expect(homeCard).toBeVisible();
    await expect(homeCard.locator("[data-mini-board-preview]")).toBeVisible();
    await expect(homeCard).toContainText("Move 1");
    await expect(homeCard.locator(".mini-board-preview-status")).toContainText("Player 1 to play");
  } finally {
    await closeContextQuietly(context);
  }
});
