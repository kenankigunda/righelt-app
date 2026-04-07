import test from "node:test";
import assert from "node:assert/strict";

import { createInitialState, listLegalActions, resolveToStability } from "../generated/packages/game-engine/src/index.js";
import {
  buildScenarioStaticPreviewModel,
  resolvePreviewActionFromSavedSelection,
} from "../shell/static-preview-model.js";
import { buildDestroyedPieceOverlays } from "../shell/history-preview.js";

test("static preview model keeps source-only saved selections in interactive mode", () => {
  const snapshot = resolveToStability(createInitialState(), { artifactMode: "full" });
  const sourceAction = listLegalActions(snapshot).find((action) => action.type === "project");
  assert.ok(sourceAction, "expected an initial project action");

  const preview = buildScenarioStaticPreviewModel({
    resultingState: snapshot,
    savedSelection: {
      source: sourceAction.from,
      target: null,
      actorSide: snapshot.sideToMove,
      turnIndex: snapshot.turnIndex,
    },
  });

  assert.equal(preview.overlay.mode, "interactive");
  assert.equal(preview.selectedPieceId, sourceAction.actorId);
  assert.equal(preview.selectedPieceMoves.some((action) => action.type === "project"), true);
  assert.deepEqual(preview.selection.source, sourceAction.from);
  assert.equal(preview.snapshot.sideToMove, snapshot.sideToMove);
});

test("static preview model resolves source+target selections into recorded-action previews", () => {
  const snapshot = resolveToStability(createInitialState(), { artifactMode: "full" });
  const projectAction = listLegalActions(snapshot).find((action) => action.type === "project");
  assert.ok(projectAction, "expected an initial project action");

  const preview = buildScenarioStaticPreviewModel({
    resultingState: snapshot,
    savedSelection: {
      source: projectAction.from,
      target: projectAction.to,
      actorSide: snapshot.sideToMove,
      turnIndex: snapshot.turnIndex,
    },
  });

  assert.equal(preview.overlay.mode, "recorded-action");
  assert.equal(preview.overlay.recordedAction?.type, "project");
  assert.equal(preview.overlay.recordedActionStartPiece?.id, projectAction.actorId);
  assert.equal(preview.snapshot.sideToMove, "P2");
});

test("static preview action resolution uses live target preference rules", () => {
  const resolved = resolvePreviewActionFromSavedSelection({
    savedSelection: {
      source: { row: 4, col: 3 },
      target: { row: 4, col: 4 },
      actorSide: "P1",
      turnIndex: 0,
    },
    snapshot: {
      sideToMove: "P1",
      turnIndex: 0,
      pieces: [{ id: "U1", owner: "P1", kind: "unit", position: { row: 4, col: 3 } }],
      continuation: null,
      outcome: { status: "ongoing" },
    },
    legalActions: [
      { type: "move", actorId: "U1", from: { row: 4, col: 3 }, to: { row: 4, col: 4 } },
      { type: "rush", actorId: "U1", from: { row: 4, col: 3 }, to: { row: 4, col: 4 } },
    ],
    currentActionType: "move",
  });

  assert.equal(resolved?.type, "rush");
});

test("static preview model falls back when the saved selection is stale", () => {
  const snapshot = resolveToStability(createInitialState(), { artifactMode: "full" });
  const preview = buildScenarioStaticPreviewModel({
    resultingState: snapshot,
    savedSelection: {
      source: { row: 9, col: 9 },
      target: { row: 8, col: 8 },
      actorSide: snapshot.sideToMove,
      turnIndex: snapshot.turnIndex,
    },
  });

  assert.equal(preview.overlay.mode, "none");
  assert.equal(preview.selectedPieceMoves.length, 0);
  assert.deepEqual(preview.selection, {
    selectedPieceId: null,
    source: { row: 9, col: 9 },
    target: { row: 8, col: 8 },
  });
});

test("history-style destroyed overlays preserve the pre-action inactive state", () => {
  const overlays = buildDestroyedPieceOverlays({
    destroyedPieceRecords: [
      {
        position: { row: 6, col: 2 },
        ownerSeat: "p2",
        supplied: true,
        commanded: true,
        reason: "loss_of_supply",
      },
    ],
    preActionSnapshot: {
      pieces: [
        {
          id: "U2",
          owner: "P2",
          kind: "unit",
          position: { row: 6, col: 2 },
          supplied: false,
          commanded: false,
        },
      ],
    },
  });

  assert.deepEqual(overlays, [
    {
      row: 6,
      col: 2,
      ownerSeat: "p2",
      kind: "unit",
      supplied: false,
      commanded: false,
      piece: {
        id: "U2",
        owner: "P2",
        kind: "unit",
        position: { row: 6, col: 2 },
        supplied: false,
        commanded: false,
        pushed: false,
      },
    },
  ]);
});
