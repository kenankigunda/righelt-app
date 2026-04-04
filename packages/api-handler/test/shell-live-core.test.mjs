/**
 * Unit and integration tests for shell-live-core.ts persistence changes.
 *
 * Covers test plan rows:
 *   U-07 — MoveEntry type accepts optional destroyedPieces field
 *   I-01 — applyServerAction stores destroyedPieces on game.moves entry
 *   I-02 — successive moves each get their own independent destroyedPieces array
 *   I-03 — duplicate clientCommandId returns destroyedPieces from stored move
 *   I-04 — destroyedPieces arrays are independent (not shared references)
 *   I-10 — removedPieces (transient, §12.3) still returned alongside destroyedPieces
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyServerAction,
  createInitialGame,
} from "../src/shell-live-core.ts";
import { listLegalActions, resolveToStability } from "../../game-engine/src/index.ts";

// ---------------------------------------------------------------------------
// U-07 — MoveEntry type: destroyedPieces field is optional
// ---------------------------------------------------------------------------

/**
 * U-07: Verify at runtime that a move returned by applyServerAction always
 * carries a destroyedPieces array. Since the optional field is a TS compile-time
 * concern, the runtime check here verifies:
 *   1. moved.move.destroyedPieces is an Array (not undefined/null)
 *   2. moved.destroyedPieces (result-level) is an Array
 *
 * The TypeScript compile check is implicit: if MoveEntry did not declare
 * destroyedPieces the assignment inside applyServerActionWithExpectedState
 * would produce a type error at build time.
 */
test("U-07: applyServerAction returns move with destroyedPieces array (MoveEntry type check)", () => {
  const game = createInitialGame({ gameId: "g-u07", identityId: "id-u07", selfPlayMode: true });
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal = listLegalActions(stable);
  assert.ok(legal.length > 0, "initial state should have legal actions");

  const moved = applyServerAction(game, legal[0]);
  assert.ok(moved.ok, "applyServerAction should succeed");

  // destroyedPieces must be present as an Array on the stored move
  assert.ok(
    Object.prototype.hasOwnProperty.call(moved.move, "destroyedPieces"),
    "MoveEntry must have destroyedPieces property",
  );
  assert.ok(Array.isArray(moved.move.destroyedPieces), "moved.move.destroyedPieces must be an array");
  assert.ok(Array.isArray(moved.destroyedPieces), "result.destroyedPieces must be an array");
  // For a standard initial-state action (no piece removal), both should be empty
  assert.deepEqual(moved.move.destroyedPieces, []);
  assert.deepEqual(moved.destroyedPieces, []);
});

// ---------------------------------------------------------------------------
// I-01 — applyServerAction stores destroyedPieces on game.moves entry
// ---------------------------------------------------------------------------

test("I-01: applyServerAction — move is stored on game.moves with destroyedPieces array", () => {
  const game = createInitialGame({ gameId: "g-i01", identityId: "id-i01", selfPlayMode: true });
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal = listLegalActions(stable);
  assert.ok(legal.length > 0);

  const moved = applyServerAction(game, legal[0]);
  assert.ok(moved.ok);

  // The move must be stored on game.moves with destroyedPieces
  assert.equal(game.moves.length, 1, "game.moves must have exactly one entry");
  const storedMove = game.moves[0];
  assert.ok(storedMove, "game.moves[0] should exist");
  assert.ok(Array.isArray(storedMove.destroyedPieces), "stored move must have destroyedPieces array");
  // Initial state move (no piece removal) produces empty destroyedPieces
  assert.deepEqual(storedMove.destroyedPieces, []);
  // Result destroyedPieces must match the stored move's value
  assert.deepEqual(moved.destroyedPieces, storedMove.destroyedPieces);
});

test("I-01b: result.destroyedPieces equals stored move.destroyedPieces", () => {
  const game = createInitialGame({ gameId: "g-i01b", identityId: "id-i01b", selfPlayMode: true });
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal = listLegalActions(stable);

  const moved = applyServerAction(game, legal[0]);
  assert.ok(moved.ok);
  assert.deepEqual(moved.destroyedPieces, moved.move.destroyedPieces);
});

// ---------------------------------------------------------------------------
// I-02 — successive moves each get their own independent destroyedPieces array
// ---------------------------------------------------------------------------

test("I-02: successive moves each store their own destroyedPieces array", () => {
  const game = createInitialGame({ gameId: "g-i02", identityId: "id-i02", selfPlayMode: true });

  const stable1 = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal1 = listLegalActions(stable1);
  assert.ok(legal1.length > 0);
  const moved1 = applyServerAction(game, legal1[0]);
  assert.ok(moved1.ok);

  const stable2 = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal2 = listLegalActions(stable2);
  assert.ok(legal2.length > 0);
  const moved2 = applyServerAction(game, legal2[0]);
  assert.ok(moved2.ok);

  assert.equal(game.moves.length, 2, "both moves must be stored");
  // Each move independently has a destroyedPieces array
  assert.ok(Array.isArray(game.moves[0].destroyedPieces), "moves[0].destroyedPieces must be an array");
  assert.ok(Array.isArray(game.moves[1].destroyedPieces), "moves[1].destroyedPieces must be an array");
});

// ---------------------------------------------------------------------------
// I-03 — duplicate clientCommandId returns destroyedPieces from stored move
// ---------------------------------------------------------------------------

test("I-03: duplicate clientCommandId — result.destroyedPieces comes from the stored move", () => {
  const game = createInitialGame({ gameId: "g-i03", identityId: "id-i03", selfPlayMode: true });
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal = listLegalActions(stable);
  assert.ok(legal.length > 0);

  const clientCommandId = "cmd-dup-i03";
  // First call — records the move
  const first = applyServerAction(game, legal[0], undefined, clientCommandId);
  assert.ok(first.ok);
  assert.ok(!first.duplicate, "first call must not be duplicate");
  assert.ok(Array.isArray(first.move.destroyedPieces));

  // Second call with same clientCommandId — must return duplicate with destroyedPieces
  const dup = applyServerAction(game, legal[0], undefined, clientCommandId);
  assert.ok(dup.ok);
  assert.ok(dup.duplicate, "second call must be duplicate");
  assert.ok(Array.isArray(dup.destroyedPieces), "duplicate result must have destroyedPieces");
  assert.deepEqual(
    dup.destroyedPieces,
    first.move.destroyedPieces,
    "duplicate destroyedPieces must match the stored move",
  );
  // game.moves must not be double-recorded
  assert.equal(game.moves.length, 1, "duplicate must not push a second move entry");
});

// ---------------------------------------------------------------------------
// I-04 — destroyedPieces arrays are independent (not shared references)
// ---------------------------------------------------------------------------

test("I-04: destroyedPieces on each stored move is an independent array (not shared reference)", () => {
  const game = createInitialGame({ gameId: "g-i04", identityId: "id-i04", selfPlayMode: true });

  const s1 = resolveToStability(game.board.state, { artifactMode: "full" });
  const l1 = listLegalActions(s1);
  const r1 = applyServerAction(game, l1[0]);
  assert.ok(r1.ok);

  const s2 = resolveToStability(game.board.state, { artifactMode: "full" });
  const l2 = listLegalActions(s2);
  const r2 = applyServerAction(game, l2[0]);
  assert.ok(r2.ok);

  const move0dp = game.moves[0].destroyedPieces;
  const move1dp = game.moves[1].destroyedPieces;
  assert.notEqual(move0dp, move1dp, "destroyedPieces should be distinct array references");
});

// ---------------------------------------------------------------------------
// I-10 — removedPieces (transient board tooltip path) is unchanged
// ---------------------------------------------------------------------------

test("I-10: removedPieces (transient) still returned alongside destroyedPieces after the change", () => {
  const game = createInitialGame({ gameId: "g-i10", identityId: "id-i10", selfPlayMode: true });
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const legal = listLegalActions(stable);

  const moved = applyServerAction(game, legal[0]);
  assert.ok(moved.ok);

  // Both removedPieces and destroyedPieces must be present on the result
  assert.ok(
    Object.prototype.hasOwnProperty.call(moved, "removedPieces"),
    "result must still carry removedPieces (transient board tooltip path)",
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(moved, "destroyedPieces"),
    "result must carry destroyedPieces (new persistence field)",
  );
  assert.ok(Array.isArray(moved.removedPieces), "removedPieces must be an array");
  assert.ok(Array.isArray(moved.destroyedPieces), "destroyedPieces must be an array");
});
