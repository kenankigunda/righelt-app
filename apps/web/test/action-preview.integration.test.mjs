import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../generated/packages/game-engine/src/state.js";
import { resolveToStability } from "../generated/packages/game-engine/src/resolve.js";
import { listLegalActions } from "../generated/packages/game-engine/src/legal.js";
import { buildImmediateActionPreview } from "../board/action-preview.js";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";

test("real engine preview moves pieces and leaves the authoritative input untouched", () => {
  const state = resolveToStability(createInitialState(), { artifactMode: "full" });
  const before = structuredClone(state);
  const action = listLegalActions(state).find((item) => item.type === "move");
  const preview = buildImmediateActionPreview(state, action);
  assert.deepEqual(state, before);
  assert.deepEqual(preview.state.pieces.find((piece) => piece.id === action.actorId).position, action.to);
  assert.ok(preview.changed.some((piece) => piece.id === action.actorId));
  assert.deepEqual(preview.removed, []);
});

test("runtime previews real effects, re-arms after authority change and sends once on rapid confirmation", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  let click, rendered, resolveApply;
  let authority = "account-a";
  let calls = 0;
  const state = resolveToStability(createInitialState(), { artifactMode: "full" });
  const legal = listLegalActions(state);
  const action = legal.find((item) => item.type === "move");
  const runtime = createBoardRuntime({
    boardAdapter: {
      mount: (callbacks) => { click = callbacks.onCellClick; },
      render: ({ snapshot }) => { rendered = snapshot; },
      getPieceAt: (snapshot, point) => snapshot.pieces.find((piece) => piece.position.row === point.row && piece.position.col === point.col),
      getPieceById: (snapshot, id) => snapshot.pieces.find((piece) => piece.id === id),
      getSelectedPieceSummary: ({ snapshot, selectedPieceId }) => { const piece = snapshot.pieces.find((candidate) => candidate.id === selectedPieceId); return piece ? { details: { owner: piece.owner }, actions: legal } : null; },
      nextSelectionForCell: ({ clickedCoord }) => ({ selection: { selectedPieceId: action.actorId, source: clickedCoord, target: null }, nextActionType: "move" }),
    },
    host: {
      canInteract: () => true,
      getInteractionKey: () => authority,
      loadPieceMoves: async () => ({ state, actions: legal, previewActions: legal }),
      loadLegalActions: async () => ({ state, legalActions: legal }),
      applyAction: async () => { calls += 1; return new Promise((resolve) => { resolveApply = resolve; }); },
    },
  });
  try {
    runtime.bindElements({ boardEl: { querySelector: () => null }, overlayLinesEl: {} });
    await runtime.loadSnapshot(state, { legalActions: legal });
    click(action.from);
    click(action.to);
    assert.equal(calls, 0);
    assert.deepEqual(rendered.pieces.find((piece) => piece.id === action.actorId).position, action.to);
    authority = "account-b";
    click(action.to);
    assert.equal(calls, 0, "an old preview cannot confirm under changed authority");
    click(action.to);
    click(action.to);
    assert.equal(calls, 1);
    resolveApply({ accepted: false, state, legalActions: legal });
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally { globalThis.document = originalDocument; }
});
