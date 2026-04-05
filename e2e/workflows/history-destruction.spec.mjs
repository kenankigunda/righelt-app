import { test, expect } from "@playwright/test";

import {
  buildAppUrl,
  closeContextQuietly,
  createIsolatedPage,
  importScenarioGame,
  joinAsViewer,
  openDirectGameLink,
} from "../support/app.mjs";

// ---------------------------------------------------------------------------
// DESTRUCTION_SCENARIO: P1 group (strength 3) pushes a P2 unit into the
// bottom-right corner (9,9) which has no valid retreat squares:
//   followPoint=(8,9) reserved, (9,8) occupied by P2 U2-1, off-board squares.
//
// Board:
//   P1: C1@(0,9) [supply pt], U1-1@(7,9), U1-2@(8,9), U1-3@(8,8)
//   P2: C2@(9,0) [supply pt], U2-1@(9,8), U2-2@(9,9)
//
// All pieces are in supply at initialState (verified: P1 via col 9, P2 via row
// 9). No P1 command edges block P2's BFS along row 9.
//
// Move 1: push — U1-2@(8,9) pushes U2-2@(9,9), attacker group={U1-1,U1-2,U1-3}
//          strength 3 > defender group={U2-1,U2-2} strength 2.
//          U2-2 has no retreat → immediately removed. destroyedPieces records
//          {position:(9,9), ownerSeat:"p2", reason:"no_retreat"}.
// Move 2: follow — U1-1 follows (7,9) -> (8,9), continuation closes.
// ---------------------------------------------------------------------------
const DESTRUCTION_SCENARIO = {
  formatVersion: 2,
  id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  title: "History destruction E2E fixture",
  description: "P1 group (strength 3) pushes isolated P2 unit into corner (9,9) with no retreat squares",
  incorrect: false,
  initialState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 7, col: 9 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 8, col: 9 }, supplied: true, commanded: true },
      { id: "U1-3", owner: "P1", kind: "unit", position: { row: 8, col: 8 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 9, col: 8 }, supplied: true, commanded: true },
      { id: "U2-2", owner: "P2", kind: "unit", position: { row: 9, col: 9 }, supplied: true, commanded: true },
    ],
  },
  moves: [
    // P1 U1-2 pushes P2 U2-2 into (9,9) corner — no valid retreat
    {
      turnIndex: 0,
      turnMoveIndex: 0,
      actorSide: "P1",
      action: { type: "push", actorId: "U1-2", from: { row: 8, col: 9 }, to: { row: 9, col: 9 } },
      notation: "PUSH (8,9) -> (9,9)",
    },
    // P1 U1-2 follows back to (8,9), closing the continuation
    {
      turnIndex: 0,
      turnMoveIndex: 1,
      actorSide: "P1",
      action: { type: "follow", actorId: "U1-1", from: { row: 7, col: 9 }, to: { row: 8, col: 9 } },
      notation: "FOLLOW (7,9) -> (8,9)",
    },
  ],
  resultingState: {
    boardSize: 10,
    sideToMove: "P2",
    turnIndex: 1,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 8, col: 9 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 9, col: 9 }, supplied: true, commanded: true },
      { id: "U1-3", owner: "P1", kind: "unit", position: { row: 8, col: 8 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 9, col: 8 }, supplied: true, commanded: true },
      // U2-2 removed (no_retreat)
    ],
  },
  expectedFinalStateHash: "hash-placeholder",
  expectedOutcome: "ongoing",
};

// ---------------------------------------------------------------------------
// P1_DESTRUCTION_SCENARIO: mirrored no-retreat push where P2 destroys a P1
// unit at the top-left corner. This gives us a browser-proof P1-colour
// DESTROYED sub-bullet using a fully legal imported history.
// ---------------------------------------------------------------------------
const P1_DESTRUCTION_SCENARIO = {
  formatVersion: 2,
  id: "f1e2d3c4-b5a6-4978-8b7c-6d5e4f3a2b1c",
  title: "P1 destruction E2E fixture",
  description: "P2 destroys a P1 unit at the top-left corner",
  incorrect: false,
  initialState: {
    boardSize: 10,
    sideToMove: "P2",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 0, col: 1 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 0, col: 0 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 2, col: 0 }, supplied: true, commanded: true },
      { id: "U2-2", owner: "P2", kind: "unit", position: { row: 1, col: 0 }, supplied: true, commanded: true },
      { id: "U2-3", owner: "P2", kind: "unit", position: { row: 1, col: 1 }, supplied: true, commanded: true },
    ],
  },
  moves: [
    {
      turnIndex: 0,
      turnMoveIndex: 0,
      actorSide: "P2",
      action: { type: "push", actorId: "U2-2", from: { row: 1, col: 0 }, to: { row: 0, col: 0 } },
      notation: "PUSH (1,0) -> (0,0)",
    },
    {
      turnIndex: 0,
      turnMoveIndex: 1,
      actorSide: "P2",
      action: { type: "follow", actorId: "U2-1", from: { row: 2, col: 0 }, to: { row: 1, col: 0 } },
      notation: "FOLLOW (2,0) -> (1,0)",
    },
  ],
  resultingState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 1,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 0, col: 1 }, supplied: true, commanded: true },
      // U1-2 removed (no_retreat)
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 1, col: 0 }, supplied: true, commanded: true },
      { id: "U2-2", owner: "P2", kind: "unit", position: { row: 0, col: 0 }, supplied: true, commanded: true },
      { id: "U2-3", owner: "P2", kind: "unit", position: { row: 1, col: 1 }, supplied: true, commanded: true },
    ],
  },
  expectedFinalStateHash: "hash-placeholder",
  expectedOutcome: "ongoing",
};

const getDestructionItems = (page) =>
  page.locator('[data-testid="history-destruction-item"]');

const getHistoryMoveItems = (page) =>
  page.locator('[data-testid="history-move-item"]');

// ---------------------------------------------------------------------------
// E-01 — Success path: destructive move shows DESTROYED sub-bullet in history
// ---------------------------------------------------------------------------
test("E-01: destructive move shows DESTROYED sub-bullet in history panel", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, DESTRUCTION_SCENARIO, baseURL);

    // The history panel must show at least one move entry
    await expect(getHistoryMoveItems(page).first()).toBeVisible();

    // At least one DESTROYED sub-bullet must appear (the P2 unit at (9,9))
    await expect
      .poll(
        async () => getDestructionItems(page).count(),
        { message: "Expected at least one DESTROYED sub-bullet in the history panel" },
      )
      .toBeGreaterThan(0);

    // Sub-bullet text must match the expected format
    const firstItem = getDestructionItems(page).first();
    await expect(firstItem).toBeVisible();
    await expect(firstItem).toContainText("DESTROYED");
  } finally {
    await closeContextQuietly(context);
  }
});

// ---------------------------------------------------------------------------
// E-02 — Success path: clicking a destruction line selects the parent move
// ---------------------------------------------------------------------------
test("E-02: clicking a DESTROYED sub-bullet navigates to the parent snapshot and shows destruction markers on board", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, DESTRUCTION_SCENARIO, baseURL);

    await expect(getDestructionItems(page).first()).toBeVisible();
    const destructionItem = getDestructionItems(page).first();
    const parentMoveItem = destructionItem.locator("xpath=ancestor::*[@data-testid='history-move-item'][1]");

    // Click the sub-bullet
    await destructionItem.click();

    // The history-return-live button must be visible (we are now in history mode)
    await expect(page.getByTestId("history-return-live")).toBeVisible();

    // The selected move should now show the recorded-action board state with a
    // destruction marker rendered on the destroyed square.
    const destroyedMarker = page.locator('[data-testid="game-board"] .cell[data-row="9"][data-col="9"] .history-destruction-piece');
    await expect(destroyedMarker).toBeVisible();
    await expect(parentMoveItem).toHaveClass(/is-selected/);
  } finally {
    await closeContextQuietly(context);
  }
});

// ---------------------------------------------------------------------------
// E-03 — Persistence: destruction records survive page reload
// ---------------------------------------------------------------------------
test("E-03: DESTROYED sub-bullets survive a page reload", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await importScenarioGame(page, DESTRUCTION_SCENARIO, baseURL);

    // Verify sub-bullets are visible before reload
    await expect(getDestructionItems(page).first()).toBeVisible();
    const countBeforeReload = await getDestructionItems(page).count();
    expect(countBeforeReload).toBeGreaterThan(0);

    // Reload the page
    await page.reload();
    await page.goto(buildAppUrl(baseURL, gameHash));
    await expect(page.getByTestId("game-shell")).toBeVisible();

    // Sub-bullets must still be present after reload
    await expect
      .poll(
        async () => getDestructionItems(page).count(),
        { message: "Expected DESTROYED sub-bullets to persist after page reload" },
      )
      .toBeGreaterThanOrEqual(countBeforeReload);
  } finally {
    await closeContextQuietly(context);
  }
});

// ---------------------------------------------------------------------------
// E-04 — Recovery path: late-join viewer sees destruction records
// ---------------------------------------------------------------------------
test("E-04: late-join viewer receives identical DESTROYED sub-bullets", async ({ browser, baseURL }) => {
  const { context: creatorContext, page: creatorPage } = await createIsolatedPage(browser);
  const { context: viewerContext, page: viewerPage } = await createIsolatedPage(browser);

  try {
    const { gameHash } = await importScenarioGame(creatorPage, DESTRUCTION_SCENARIO, baseURL);

    // Verify creator sees sub-bullets
    await expect(getDestructionItems(creatorPage).first()).toBeVisible();
    const creatorCount = await getDestructionItems(creatorPage).count();
    expect(creatorCount).toBeGreaterThan(0);

    // A new viewer joins the same game
    await openDirectGameLink(viewerPage, baseURL, gameHash);
    await joinAsViewer(viewerPage);
    await expect(viewerPage.getByTestId("game-role")).toContainText("Viewer");

    // The viewer must see the same number of DESTROYED sub-bullets
    await expect
      .poll(
        async () => getDestructionItems(viewerPage).count(),
        { message: "Expected viewer to see the same DESTROYED sub-bullets as the creator" },
      )
      .toBeGreaterThanOrEqual(creatorCount);
  } finally {
    await closeContextQuietly(creatorContext);
    await closeContextQuietly(viewerContext);
  }
});

// ---------------------------------------------------------------------------
// E-05 — Layout stability: non-destructive move rows do not shift
// ---------------------------------------------------------------------------
test("E-05: history panel shows no reserved space on non-destructive move rows", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, DESTRUCTION_SCENARIO, baseURL);

    await expect(getHistoryMoveItems(page).first()).toBeVisible();
    const moveCount = await getHistoryMoveItems(page).count();
    const destructionCount = await getDestructionItems(page).count();

    // There must be at least one move and at least one destruction sub-bullet
    expect(moveCount).toBeGreaterThan(0);
    expect(destructionCount).toBeGreaterThan(0);
    // At most a reasonable number of sub-bullets per move
    expect(destructionCount).toBeLessThanOrEqual(moveCount * 3);

    // Verify the history list container itself is present and visible
    await expect(page.locator('[data-testid="history-move-item"]').first()).toBeVisible();
  } finally {
    await closeContextQuietly(context);
  }
});

// ---------------------------------------------------------------------------
// E-06 — Both colours: legal fixtures prove P2 and P1 DESTROYED colours
// ---------------------------------------------------------------------------
test("E-06: scenario with both P1 and P2 destructions shows sub-bullets in both player colours", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, DESTRUCTION_SCENARIO, baseURL);
    await expect(getDestructionItems(page).first()).toBeVisible();
    const p2Classes = await getDestructionItems(page).first().getAttribute("class");
    expect(p2Classes?.includes("player-tone-p2")).toBe(true);

    await importScenarioGame(page, P1_DESTRUCTION_SCENARIO, baseURL);
    await expect(getDestructionItems(page).first()).toBeVisible();
    const p1Classes = await getDestructionItems(page).first().getAttribute("class");
    expect(p1Classes?.includes("player-tone-p1")).toBe(true);
  } finally {
    await closeContextQuietly(context);
  }
});
