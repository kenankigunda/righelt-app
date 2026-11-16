import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRevertToMove,
  applyServerAction,
  createInitialGame,
  withViewModel,
} from "../src/shell-live-core.ts";
import { listLegalActions, resolveToStability } from "../../game-engine/src/index.ts";
import { projectOptimisticGame } from "../../../apps/web/shell/optimistic-live.js";
import { recordedMoveNumber } from "../../../apps/web/shell/recorded-narration.js";
import { getNextDisplayMoveNumber, MAX_HISTORY } from "../../shared-types/src/history.ts";

const nextDecision = (game) => listLegalActions(
  resolveToStability(game.board.state, { artifactMode: "full" }),
).find((action) => action.type !== "end_turn");

const gameAfterUndo = () => {
  const game = createInitialGame({ gameId: "display-number-undo", identityId: "owner", selfPlayMode: true });
  const firstAction = nextDecision(game);
  assert.ok(firstAction);
  const first = applyServerAction(game, firstAction, undefined, "v2:first");
  assert.equal(first.ok, true);

  const replacementAction = nextDecision(game);
  assert.ok(replacementAction);
  const replaced = applyServerAction(game, replacementAction, undefined, "v2:replaced");
  assert.equal(replaced.ok, true);
  assert.equal(replaced.move.displayMoveNumber, 2);
  assert.equal(applyRevertToMove(game, replaced.move.moveId, "owner").ok, true);
  assert.equal(game.moves.length, 2, "Undo retains the durable physical record");
  assert.equal(game.moves[1].undone, true);
  return { game, replacementAction };
};

test("pending replacement keeps its accepted display number after Undo", () => {
  const { game, replacementAction } = gameAfterUndo();

  const clientCommandId = "v2:replacement";
  const projection = projectOptimisticGame({
    authoritativeGame: withViewModel(game, "owner"),
    identityId: "owner",
    queue: [{
      kind: "apply",
      action: replacementAction,
      clientCommandId,
      queuedAt: "2026-11-16T04:30:00.000Z",
    }],
  });
  assert.equal(projection.ok, true);
  const pending = projection.game.pendingMoves[0];
  assert.equal(pending.index, 2, "physical index remains append-only across Undo");
  assert.equal(recordedMoveNumber(pending), 2, "pending History uses the next active display number");

  const accepted = applyServerAction(game, replacementAction, undefined, clientCommandId);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.move.index, pending.index);
  assert.equal(accepted.move.displayMoveNumber, recordedMoveNumber(pending));
  assert.equal(accepted.move.clientCommandId, pending.clientCommandId);

  const duplicate = applyServerAction(game, replacementAction, undefined, clientCommandId);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(game.moves.length, 3, "duplicate settlement cannot add a move or consume a number");
});

test("queued decisions reserve stable consecutive display numbers", () => {
  const { game, replacementAction } = gameAfterUndo();
  const firstCommand = {
    kind: "apply",
    action: replacementAction,
    clientCommandId: "v2:queued-one",
    queuedAt: "2026-11-16T04:31:00.000Z",
  };
  const firstProjection = projectOptimisticGame({
    authoritativeGame: withViewModel(game, "owner"),
    identityId: "owner",
    queue: [firstCommand],
  });
  assert.equal(firstProjection.ok, true);
  const secondAction = nextDecision(firstProjection.game);
  assert.ok(secondAction);
  const projection = projectOptimisticGame({
    authoritativeGame: withViewModel(game, "owner"),
    identityId: "owner",
    queue: [firstCommand, {
      kind: "apply",
      action: secondAction,
      clientCommandId: "v2:queued-two",
      queuedAt: "2026-11-16T04:32:00.000Z",
    }],
  });
  assert.equal(projection.ok, true);
  assert.deepEqual(
    projection.game.pendingMoves.map((move) => move.displayMoveNumber),
    [2, 3],
  );
  assert.deepEqual(
    projection.game.pendingMoves.map((move) => move.index),
    [2, 3],
    "display allocation does not replace append-only durable indexes",
  );
});

test("Pass consumes a display number", () => {
  const game = createInitialGame({ gameId: "display-number-pass", identityId: "owner", selfPlayMode: true });
  const passCommand = {
    kind: "apply",
    action: { type: "pass" },
    clientCommandId: "v2:pass",
    queuedAt: "2026-11-16T04:33:00.000Z",
  };
  const passProjection = projectOptimisticGame({
    authoritativeGame: withViewModel(game, "owner"),
    identityId: "owner",
    queue: [passCommand],
  });
  assert.equal(passProjection.ok, true);
  assert.equal(passProjection.game.pendingMoves[0].displayMoveNumber, 1);
  const accepted = applyServerAction(game, passCommand.action, undefined, passCommand.clientCommandId);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.move.displayMoveNumber, 1);
});

test("shared display-number semantics preserve sparse, imported, bounded and legacy tails", () => {
  assert.equal(getNextDisplayMoveNumber([
    { displayMoveNumber: 17 },
    { displayMoveNumber: 18, undone: true },
  ]), 18, "undone retained tail does not advance the sequence");
  assert.equal(getNextDisplayMoveNumber([
    { displayMoveNumber: 4 },
    { displayMoveNumber: 11 },
  ]), 12, "persisted sparse numbering is never compacted");
  assert.equal(getNextDisplayMoveNumber([
    { displayMoveNumber: 28 },
  ]), 29, "preserved imported numbering continues directly from the move record");
  assert.equal(getNextDisplayMoveNumber(Array.from(
    { length: MAX_HISTORY },
    (_, index) => ({ displayMoveNumber: 301 + index }),
  )), 501, "bounded tails continue their persisted global sequence");
  assert.equal(getNextDisplayMoveNumber([
    {},
    { undone: true },
    {},
  ]), 3, "fully legacy history falls back to the loaded active count");
});
