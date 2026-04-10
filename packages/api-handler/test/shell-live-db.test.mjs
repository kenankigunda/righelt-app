/**
 * Unit and integration tests for shell-live-db.ts normalization changes.
 *
 * Covers test plan rows:
 *   U-08 — normalization: missing destroyedPieces defaults to []
 *   U-09 — normalization: existing destroyedPieces is preserved
 *   U-24 — normalizePersistedGame round-trips deletedAt
 *   U-25 — StaticGameCard projection includes deletedAt
 *   I-08 — destroyedPieces survives a full persist → normalize → serve round-trip
 *   I-19 — schema normalization mismatch logging: absence is logged but not fatal
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  getHomeSectionWhereClause,
  getTrashSectionWhereClause,
  listHomeSectionStaticGameCardPage,
  loadGameProjection,
  persistGameState,
} from "../src/shell-live-db.ts";
import { createInitialGame } from "../src/shell-live-core.ts";
import { createFakeD1 } from "./support/fake-d1.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an environment with a fresh in-memory fake D1 database.
 */
const makeEnv = () => ({ DB: createFakeD1() });

const withWarnSpy = async (run) => {
  const originalWarn = console.warn;
  const calls = [];
  console.warn = (message) => {
    calls.push(message);
  };
  try {
    await run(calls);
  } finally {
    console.warn = originalWarn;
  }
};

/**
 * Build a minimal game whose moves array already contains entries with or
 * without destroyedPieces. Used to inject specific move shapes for testing
 * normalization behaviour without running the real engine.
 */
const makeGameWithMoves = (movesOverrides) => {
  const game = createInitialGame({ gameId: "g-db-test", identityId: "id-db-test", selfPlayMode: true });
  game.moves = movesOverrides;
  return game;
};

/** A valid minimal MoveEntry, as it would look before the destroyedPieces feature. */
const legacyMove = () => ({
  moveId: "move-legacy-001",
  index: 0,
  turnIndex: 0,
  turnMoveIndex: 0,
  displayMoveNumber: 1,
  actorSide: "P1",
  at: "2025-01-01T00:00:00.000Z",
  notation: "PASS",
  action: { type: "pass" },
  clientCommandId: null,
  undone: false,
  selectionSnapshot: { sideToMove: "P1", turnIndex: 0, continuation: null, outcome: { status: "ongoing" }, pieces: [] },
  snapshot: { sideToMove: "P2", turnIndex: 0, continuation: null, outcome: { status: "ongoing" }, pieces: [] },
  // destroyedPieces intentionally absent — simulates pre-deploy move
});

/** A valid minimal MoveEntry with destroyedPieces already set. */
const modernMoveWithDestroyedPieces = (destroyedPieces) => ({
  ...legacyMove(),
  moveId: "move-modern-001",
  destroyedPieces,
});

// ---------------------------------------------------------------------------
// U-08 — normalization: missing destroyedPieces defaults to []
// ---------------------------------------------------------------------------

test("U-08: normalizeMoves — missing destroyedPieces defaults to [] after round-trip", async () => {
  const env = makeEnv();
  const game = makeGameWithMoves([legacyMove()]);
  await persistGameState(env, game, 1);

  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection, "projection should exist");
  assert.equal(projection.kind, "ok", "projection should be valid");

  const normalizedMove = projection.game.moves[0];
  assert.ok(normalizedMove, "moves[0] should exist after normalization");
  assert.ok(Array.isArray(normalizedMove.destroyedPieces), "destroyedPieces must be an array after normalization");
  assert.deepEqual(normalizedMove.destroyedPieces, [], "missing destroyedPieces defaults to []");
});

// ---------------------------------------------------------------------------
// U-09 — normalization: existing destroyedPieces is preserved
// ---------------------------------------------------------------------------

test("U-09: normalizeMoves — existing destroyedPieces is preserved through round-trip", async () => {
  const destroyedPieces = [
    { position: { row: 3, col: 4 }, ownerSeat: "p2", reason: "no_retreat" },
  ];
  const env = makeEnv();
  const game = makeGameWithMoves([modernMoveWithDestroyedPieces(destroyedPieces)]);
  await persistGameState(env, game, 1);

  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection);
  assert.equal(projection.kind, "ok");

  const normalizedMove = projection.game.moves[0];
  assert.ok(Array.isArray(normalizedMove.destroyedPieces));
  assert.deepEqual(normalizedMove.destroyedPieces, destroyedPieces, "destroyedPieces must be preserved");
});

test("U-09b: normalizeMoves — empty destroyedPieces array is preserved (not replaced)", async () => {
  const env = makeEnv();
  const game = makeGameWithMoves([modernMoveWithDestroyedPieces([])]);
  await persistGameState(env, game, 1);

  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection);
  assert.equal(projection.kind, "ok");

  const normalizedMove = projection.game.moves[0];
  assert.deepEqual(normalizedMove.destroyedPieces, []);
});

test("U-09c: normalizeMoves — multiple destroyedPieces records preserved exactly", async () => {
  const destroyedPieces = [
    { position: { row: 3, col: 6 }, ownerSeat: "p1", reason: "commander_unsupplied" },
    { position: { row: 6, col: 3 }, ownerSeat: "p2", reason: "commander_unsupplied" },
  ];
  const env = makeEnv();
  const game = makeGameWithMoves([modernMoveWithDestroyedPieces(destroyedPieces)]);
  await persistGameState(env, game, 1);

  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection);
  assert.equal(projection.kind, "ok");
  assert.deepEqual(projection.game.moves[0].destroyedPieces, destroyedPieces);
});

// ---------------------------------------------------------------------------
// I-08 — destroyedPieces survives persist → normalize → serve round-trip
// ---------------------------------------------------------------------------

test("I-08: destroyedPieces survives full persist → normalize → serve round-trip", async () => {
  const destroyedPieces = [
    { position: { row: 2, col: 5 }, ownerSeat: "p1", reason: "loss_of_supply" },
  ];
  const env = makeEnv();
  const game = makeGameWithMoves([modernMoveWithDestroyedPieces(destroyedPieces)]);

  // Persist
  await persistGameState(env, game, 1);

  // Load and normalize
  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection);
  assert.equal(projection.kind, "ok");

  // Verify the field survives the round-trip intact
  const loaded = projection.game;
  assert.equal(loaded.moves.length, 1);
  assert.deepEqual(loaded.moves[0].destroyedPieces, destroyedPieces);

  // Persist again (simulate "reload after server restart") and load once more
  await persistGameState(env, loaded, 2);
  const secondProjection = await loadGameProjection(env, game.id);
  assert.ok(secondProjection);
  assert.equal(secondProjection.kind, "ok");
  assert.deepEqual(secondProjection.game.moves[0].destroyedPieces, destroyedPieces);
});

// ---------------------------------------------------------------------------
// I-19 — schema normalization mismatch logging: absence is logged but not fatal
// ---------------------------------------------------------------------------

/**
 * I-19: When a move is loaded that lacks destroyedPieces (pre-deploy data),
 * the normalization should:
 *   1. Default the field to []
 *   2. Record a mismatch entry (matching the existing mismatch pattern)
 *   3. Return a valid "ok" projection (not "invalid") — the game loads cleanly
 *
 * We verify the mismatch is recorded by observing that console.warn/console.log
 * would have been called, but since we can't easily intercept that in this
 * harness, we verify the contract indirectly:
 *   - The projection.kind is "ok" (not "invalid")
 *   - The move loads cleanly with destroyedPieces: []
 *
 * The mismatch logging path is exercised because the legacy move lacks the field.
 * Full logging assertion would require a spy, which is out of scope for this test.
 */
test("I-19: normalization of legacy moves (missing destroyedPieces) is not fatal — game loads cleanly", async () => {
  await withWarnSpy(async (warnCalls) => {
    const env = makeEnv();
    const game = makeGameWithMoves([legacyMove()]);
    await persistGameState(env, game, 1);

    let projection;
    try {
      projection = await loadGameProjection(env, game.id);
    } catch (error) {
      assert.fail(`loadGameProjection threw unexpectedly: ${error.message}`);
    }

    assert.ok(projection, "projection should exist");
    assert.equal(projection.kind, "ok", "projection kind must be 'ok' (not 'invalid')");
    assert.equal(projection.game.moves.length, 1);
    assert.deepEqual(projection.game.moves[0].destroyedPieces, [], "defaulted to [] cleanly");

    assert.equal(warnCalls.length, 1, "legacy move repair should emit one warning payload");
    const payload = JSON.parse(warnCalls[0]);
    assert.equal(payload.event, "live_game_shape_repaired");
    assert.equal(payload.gameId, game.id);
    assert.equal(payload.context, "single");
    assert.equal(Array.isArray(payload.mismatches), true);
    assert.equal(payload.mismatches.some((entry) => entry.field === "moves[0].destroyedPieces"), true);
    assert.equal(
      payload.mismatches.some((entry) => entry.repair === "defaulted_to_empty_array"),
      true,
      "repair log should record the destroyedPieces default",
    );
  });
});

test("I-19b: normalization of multiple legacy moves — all default to [], game loads cleanly", async () => {
  const env = makeEnv();
  const legacyMoves = [
    { ...legacyMove(), moveId: "move-leg-1", index: 0, displayMoveNumber: 1 },
    { ...legacyMove(), moveId: "move-leg-2", index: 1, displayMoveNumber: 2 },
    { ...legacyMove(), moveId: "move-leg-3", index: 2, displayMoveNumber: 3 },
  ];
  const game = makeGameWithMoves(legacyMoves);
  await persistGameState(env, game, 1);

  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection);
  assert.equal(projection.kind, "ok");
  assert.equal(projection.game.moves.length, 3);
  for (const move of projection.game.moves) {
    assert.deepEqual(move.destroyedPieces, [], "each legacy move defaults destroyedPieces to []");
  }
});

test("I-19d: normalization condenses repeated destroyedPieces repairs into a summary mismatch", async () => {
  await withWarnSpy(async (warnCalls) => {
    const env = makeEnv();
    const legacyMoves = Array.from({ length: 9 }, (_, index) => ({
      ...legacyMove(),
      moveId: `move-condense-${index}`,
      index,
      displayMoveNumber: index + 1,
    }));
    const game = makeGameWithMoves(legacyMoves);
    await persistGameState(env, game, 1);

    const projection = await loadGameProjection(env, game.id);
    assert.ok(projection);
    assert.equal(projection.kind, "ok");
    assert.equal(projection.game.moves.length, legacyMoves.length);
    for (const move of projection.game.moves) {
      assert.deepEqual(move.destroyedPieces, []);
    }

    assert.equal(warnCalls.length, 1, "condensed repair path should still emit a single warning payload");
    const payload = JSON.parse(warnCalls[0]);
    assert.equal(payload.event, "live_game_shape_repaired");
    assert.equal(payload.condensed, true);
    assert.ok(payload.mismatchCount >= legacyMoves.length);
    const destroyedSummary = payload.mismatches.find((entry) => entry.field === "moves[*].destroyedPieces");
    assert.ok(destroyedSummary, "condensed payload should summarize missing destroyedPieces repairs");
    assert.equal(destroyedSummary.repair, "defaulted_to_empty_array");
    assert.match(destroyedSummary.actualSummary, /9 move entries missing destroyedPieces/);
  });
});

test("U-21: home section WHERE clause excludes soft-deleted games", () => {
  const clause = getHomeSectionWhereClause({ identityId: "id-u21", section: "my", debug: false });
  assert.match(clause.sql, /deleted_at IS NULL/);
});

test("U-22: trash-my WHERE clause filters deleted rows for player identities", () => {
  const clause = getTrashSectionWhereClause({ identityId: "id-u22" }).my;
  assert.match(clause.sql, /deleted_at IS NOT NULL/);
  assert.match(clause.sql, /player1_identity_id/);
  assert.deepEqual(clause.params, ["id-u22"]);
});

test("U-23: trash-other list returns viewer-only deleted games", async () => {
  const env = makeEnv();

  const playerOwned = createInitialGame({ gameId: "g-trash-my", identityId: "id-viewer", selfPlayMode: false });
  playerOwned.deletedAt = "2026-04-09T12:00:00.000Z";

  const viewerOwned = createInitialGame({ gameId: "g-trash-other", identityId: "id-owner", selfPlayMode: false });
  viewerOwned.viewers.push({
    identityId: "id-viewer",
    connected: true,
    joinedAt: "2026-04-09T12:00:00.000Z",
    lastHeartbeatAt: "2026-04-09T12:00:00.000Z",
    sessionCount: 1,
  });
  viewerOwned.deletedAt = "2026-04-09T12:01:00.000Z";

  await persistGameState(env, playerOwned, 1);
  await persistGameState(env, viewerOwned, 1);

  const trashMy = await listHomeSectionStaticGameCardPage(env, {
    identityId: "id-viewer",
    section: "trash-my",
    page: 0,
    pageSize: 10,
    debug: false,
  });
  const trashOther = await listHomeSectionStaticGameCardPage(env, {
    identityId: "id-viewer",
    section: "trash-other",
    page: 0,
    pageSize: 10,
    debug: false,
  });

  assert.deepEqual(trashMy.games.map((game) => game.id), ["g-trash-my"]);
  assert.deepEqual(trashOther.games.map((game) => game.id), ["g-trash-other"]);
  assert.equal(trashOther.games[0].myRole, "Viewer");
});

test("I-19c: mixed legacy and modern moves — both handled correctly in same game", async () => {
  const destroyedPieces = [{ position: { row: 4, col: 2 }, ownerSeat: "p2", reason: "no_retreat" }];
  const env = makeEnv();
  const moves = [
    { ...legacyMove(), moveId: "move-old", index: 0, displayMoveNumber: 1 }, // legacy: no destroyedPieces
    { ...modernMoveWithDestroyedPieces(destroyedPieces), moveId: "move-new", index: 1, displayMoveNumber: 2 }, // modern
  ];
  const game = makeGameWithMoves(moves);
  await persistGameState(env, game, 1);

  const projection = await loadGameProjection(env, game.id);
  assert.ok(projection);
  assert.equal(projection.kind, "ok");
  assert.equal(projection.game.moves.length, 2);
  assert.deepEqual(projection.game.moves[0].destroyedPieces, [], "legacy move defaults to []");
  assert.deepEqual(projection.game.moves[1].destroyedPieces, destroyedPieces, "modern move is preserved");
});

test("U-24: normalizePersistedGame round-trips deletedAt when present and when absent", async () => {
  const env = makeEnv();
  const deletedGame = createInitialGame({ gameId: "g-u24-deleted", identityId: "id-u24", selfPlayMode: false });
  deletedGame.deletedAt = "2026-04-09T12:00:00.000Z";
  await persistGameState(env, deletedGame, 1);

  const deletedProjection = await loadGameProjection(env, deletedGame.id);
  assert.ok(deletedProjection);
  assert.equal(deletedProjection.kind, "ok");
  assert.equal(deletedProjection.game.deletedAt, "2026-04-09T12:00:00.000Z");

  const activeGame = createInitialGame({ gameId: "g-u24-active", identityId: "id-u24", selfPlayMode: false });
  await persistGameState(env, activeGame, 2);

  const activeProjection = await loadGameProjection(env, activeGame.id);
  assert.ok(activeProjection);
  assert.equal(activeProjection.kind, "ok");
  assert.equal(activeProjection.game.deletedAt, null);
});

test("U-25: static game card projections include deletedAt", async () => {
  const env = makeEnv();
  const game = createInitialGame({ gameId: "g-u25", identityId: "id-u25", selfPlayMode: false });
  game.deletedAt = "2026-04-09T12:00:00.000Z";
  await persistGameState(env, game, 1);

  const page = await listHomeSectionStaticGameCardPage(env, {
    identityId: "id-u25",
    section: "trash-my",
    page: 0,
    pageSize: 10,
    debug: false,
  });

  assert.equal(page.games.length, 1);
  assert.equal(page.games[0].deletedAt, "2026-04-09T12:00:00.000Z");
});
