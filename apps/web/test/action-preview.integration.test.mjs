import test from "node:test";
import { readFileSync } from "node:fs";
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
    const alternate = legal.find((candidate) => candidate.type === "move" && candidate.actorId === action.actorId && JSON.stringify(candidate.to) !== JSON.stringify(action.to));
    click(alternate.to);
    assert.equal(calls, 0, "a different destination replaces the preview");
    assert.deepEqual(rendered.pieces.find((piece) => piece.id === action.actorId).position, alternate.to);
    click(action.to);
    assert.equal(calls, 0);
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

const catalog = JSON.parse(readFileSync(new URL("../scenarios/catalog.json", import.meta.url))).scenarios;
const savedPreview = (title, action) => {
  const state = resolveToStability(catalog.find((scenario) => scenario.title === title).resultingState, { artifactMode: "full" });
  return buildImmediateActionPreview(state, action);
};

test("preview resolves immediate supply removals and command gains from a saved real position", () => {
  const result = savedPreview("Imminent loss of supply due to long horizontal line", {
    type: "move", actorId: "C2", from: { row: 5, col: 3 }, to: { row: 6, col: 3 },
  });
  assert.deepEqual(result.removed.map((piece) => piece.id), ["U2-1"]);
  assert.deepEqual(result.commandChanges.map((piece) => piece.id), ["U2-2", "U2-3", "U2-4", "U2-5"]);
  assert.ok(result.commandChanges.every((piece) => piece.commanded));
});

for (const [title, action] of [
  ["Push vs. project strategy endgame", { type: "push", actorId: "U1-11", from: { row: 5, col: 0 }, to: { row: 5, col: 1 } }],
  ["Retreat after push", { type: "retreat", actorId: "U1-2", from: { row: 5, col: 4 }, to: { row: 4, col: 4 } }],
  ["Push with multiple follow paths", { type: "follow", actorId: "U1-2", from: { row: 4, col: 4 }, to: { row: 5, col: 4 } }],
]) test(`${action.type} preview stops at the next unresolved continuation`, () => {
  const result = savedPreview(title, action);
  assert.equal(result.continuation.type, "push");
  assert.deepEqual(result.state.pieces.find((piece) => piece.id === action.actorId).position, action.to);
  assert.ok(result.changed.some((piece) => piece.id === action.actorId));
});

test("rush preview shows immediate supply loss without inventing a removal", () => {
  const result = savedPreview("Push vs. project strategy endgame", {
    type: "rush", actorId: "U1-11", from: { row: 5, col: 0 }, to: { row: 4, col: 1 },
  });
  assert.deepEqual(result.supplyChanges.map((piece) => [piece.id, piece.supplied]), [["U2-14", false]]);
  assert.deepEqual(result.removed, []);
});
