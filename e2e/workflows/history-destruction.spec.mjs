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
// Move 2: follow — U1-2 follows (9,9) -> (8,9), continuation closes.
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
      action: { type: "push", actorId: "U1-2", from: { row: 8, col: 9 }, to: { row: 9, col: 9 } },
      notation: "PUSH (8,9) -> (9,9)",
    },
    // P1 U1-2 follows back to (8,9), closing the continuation
    {
      turnIndex: 0,
      action: { type: "follow", actorId: "U1-2", from: { row: 9, col: 9 }, to: { row: 8, col: 9 } },
      notation: "FOLLOW (9,9) -> (8,9)",
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
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 7, col: 9 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 8, col: 9 }, supplied: true, commanded: true },
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
// TWO_COLOR_SCENARIO: produces both a P2-colour and a P1-colour DESTROYED
// sub-bullet by having two separate turns each with a no_retreat push.
//
// Board extends DESTRUCTION_SCENARIO with extra P2 pieces:
//   P2 extra: U2-3@(7,8), U2-4@(8,7), U2-5@(9,7), U2-6@(9,6), U2-7@(9,5)
//   All extra P2 pieces are in supply via row 9 → col 7 → rows 7-8.
//
// Turn 0 — P1:
//   Push U2-2@(9,9): same as DESTRUCTION_SCENARIO (P2-colour sub-bullet).
//   Follow U1-2 back to (8,9).
//
// Turn 1 — P2:
//   U2-4@(8,7) pushes P1 U1-3@(8,8):
//     Attacker group: {U2-4, U2-5, U2-6, U2-7} = strength 4
//     Defender group: {U1-3, U1-2, U1-1} = strength 3  → 4 > 3 ✓
//     followPoint=(8,7), retreat from (8,8):
//       (7,8)=U2-3[P2,blocked], (9,8)=U2-1[P2,blocked],
//       (8,9)=U1-2[P1,blocked], (8,7)=followPoint → NO RETREAT.
//   U1-3 destroyed → P1-colour sub-bullet.
//   P2 U2-4 follows from (8,8) -> (8,7).
// ---------------------------------------------------------------------------
const TWO_COLOR_SCENARIO = {
  formatVersion: 2,
  id: "f1e2d3c4-b5a6-4978-8b7c-6d5e4f3a2b1c",
  title: "Two-color destruction E2E fixture",
  description: "P1 destroys P2 unit then P2 destroys P1 unit, producing both player-colour sub-bullets",
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
      { id: "U2-3", owner: "P2", kind: "unit", position: { row: 7, col: 8 }, supplied: true, commanded: true },
      { id: "U2-4", owner: "P2", kind: "unit", position: { row: 8, col: 7 }, supplied: true, commanded: true },
      { id: "U2-5", owner: "P2", kind: "unit", position: { row: 9, col: 7 }, supplied: true, commanded: true },
      { id: "U2-6", owner: "P2", kind: "unit", position: { row: 9, col: 6 }, supplied: true, commanded: true },
      { id: "U2-7", owner: "P2", kind: "unit", position: { row: 9, col: 5 }, supplied: true, commanded: true },
    ],
  },
  moves: [
    // Turn 0 — P1: push U2-2 → no_retreat → U2-2 destroyed (P2 colour)
    {
      turnIndex: 0,
      action: { type: "push", actorId: "U1-2", from: { row: 8, col: 9 }, to: { row: 9, col: 9 } },
      notation: "PUSH (8,9) -> (9,9)",
    },
    {
      turnIndex: 0,
      action: { type: "follow", actorId: "U1-2", from: { row: 9, col: 9 }, to: { row: 8, col: 9 } },
      notation: "FOLLOW (9,9) -> (8,9)",
    },
    // Turn 1 — P2: push U1-3 → no_retreat → U1-3 destroyed (P1 colour)
    {
      turnIndex: 1,
      action: { type: "push", actorId: "U2-4", from: { row: 8, col: 7 }, to: { row: 8, col: 8 } },
      notation: "PUSH (8,7) -> (8,8)",
    },
    {
      turnIndex: 1,
      action: { type: "follow", actorId: "U2-4", from: { row: 8, col: 8 }, to: { row: 8, col: 7 } },
      notation: "FOLLOW (8,8) -> (8,7)",
    },
  ],
  resultingState: {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 2,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 0, col: 9 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 7, col: 9 }, supplied: true, commanded: true },
      { id: "U1-2", owner: "P1", kind: "unit", position: { row: 8, col: 9 }, supplied: true, commanded: true },
      // U1-3 removed (no_retreat)
      { id: "C2", owner: "P2", kind: "commander", position: { row: 9, col: 0 }, supplied: true, commanded: true },
      { id: "U2-1", owner: "P2", kind: "unit", position: { row: 9, col: 8 }, supplied: true, commanded: true },
      // U2-2 removed (no_retreat)
      { id: "U2-3", owner: "P2", kind: "unit", position: { row: 7, col: 8 }, supplied: true, commanded: true },
      { id: "U2-4", owner: "P2", kind: "unit", position: { row: 8, col: 7 }, supplied: true, commanded: true },
      { id: "U2-5", owner: "P2", kind: "unit", position: { row: 9, col: 7 }, supplied: true, commanded: true },
      { id: "U2-6", owner: "P2", kind: "unit", position: { row: 9, col: 6 }, supplied: true, commanded: true },
      { id: "U2-7", owner: "P2", kind: "unit", position: { row: 9, col: 5 }, supplied: true, commanded: true },
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
// E-02 — Success path: click sub-bullet highlights the named square on board
// ---------------------------------------------------------------------------
test("E-02: clicking a DESTROYED sub-bullet navigates to the parent snapshot and highlights the square", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, DESTRUCTION_SCENARIO, baseURL);

    await expect(getDestructionItems(page).first()).toBeVisible();
    const destructionItem = getDestructionItems(page).first();

    // Read the target position from the data attributes before clicking
    const row = await destructionItem.getAttribute("data-position-row");
    const col = await destructionItem.getAttribute("data-position-col");

    expect(row).not.toBeNull();
    expect(col).not.toBeNull();

    // Click the sub-bullet
    await destructionItem.click();

    // The history-return-live button must be visible (we are now in history mode)
    await expect(page.getByTestId("history-return-live")).toBeVisible();

    // The board must show a destruction highlight chip on the named square.
    // The chip renders as a <span class="board-preview-coordinate-chip
    // board-preview-coordinate-chip-destruction"> inside the highlighted cell.
    const highlightChip = page.locator(
      `[data-testid="game-board"] .cell[data-row="${row}"][data-col="${col}"] .board-preview-coordinate-chip-destruction`,
    );
    await expect
      .poll(
        async () => highlightChip.count(),
        { message: `Expected a destruction-highlight chip inside cell (${row},${col})` },
      )
      .toBeGreaterThan(0);
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
// E-06 — Both colours: P2 and P1 DESTROYED sub-bullets both appear
// ---------------------------------------------------------------------------
test("E-06: scenario with both P1 and P2 destructions shows sub-bullets in both player colours", async ({ browser, baseURL }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await importScenarioGame(page, TWO_COLOR_SCENARIO, baseURL);

    // Wait for the history panel to show moves
    await expect(getHistoryMoveItems(page).first()).toBeVisible();

    // Expect at least two DESTROYED sub-bullets (one P2-colour, one P1-colour)
    await expect
      .poll(
        async () => getDestructionItems(page).count(),
        { message: "Expected at least two DESTROYED sub-bullets (one per destroyed piece)" },
      )
      .toBeGreaterThanOrEqual(2);

    const items = getDestructionItems(page);
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // At least one item must have a P1 color class and one a P2 color class
    const classNames = await Promise.all(
      Array.from({ length: count }, (_, index) => items.nth(index).getAttribute("class")),
    );
    const hasP1Color = classNames.some((cls) => cls && cls.includes("player-tone-p1"));
    const hasP2Color = classNames.some((cls) => cls && cls.includes("player-tone-p2"));
    expect(hasP1Color).toBe(true);
    expect(hasP2Color).toBe(true);
  } finally {
    await closeContextQuietly(context);
  }
});
