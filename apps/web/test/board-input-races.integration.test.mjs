import test from "node:test";
import assert from "node:assert/strict";
import { createBoardRuntime } from "../board/runtime/board-runtime.js";
import { createEngineBoardAdapter } from "../board-adapters/engine-board-adapter.js";
import { buildPieceMoveResponse } from "../board/client-move-generation.js";

const coord = (row, col) => ({ row, col });
const action = (type = "rush", from = coord(4, 2), to = coord(4, 3)) => ({ type, actorId: "A", from, to });
const snapshot = (position = coord(4, 2)) => ({
  boardSize: 10, sideToMove: "P1", turnIndex: 0, continuation: null, outcome: { status: "ongoing" },
  pieces: [{ id: "A", owner: "P1", kind: "unit", position, supplied: true, commanded: true }],
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture({ actions = [action(), action("rush", coord(4, 2), coord(5, 2))], state = snapshot(), hover = true, host = {}, controls = {} } = {}) {
  let handlers, rendered, previewClick;
  const applied = [];
  const runtime = createBoardRuntime({
    boardAdapter: { ...createEngineBoardAdapter(), mount: value => { handlers = value; }, render: value => { rendered = value; } },
    host: {
      canInteract: () => true,
      loadPieceMoves: async state => buildPieceMoveResponse({ state, legalActions: actions, pieceId: "A" }),
      loadLegalActions: async state => ({ state, legalActions: actions }),
      applyAction: async (_state, value) => { applied.push(value); return { accepted: false }; },
      ...host,
    },
    controls: { getSupportsHover: () => hover, ...controls },
  });
  runtime.bindElements({ boardEl: {}, overlayLinesEl: {}, boardPreviewLabelEl: {
    addEventListener: (_name, handler) => { previewClick = handler; }, removeEventListener: () => {},
  } });
  await runtime.loadSnapshot(state, { legalActions: actions });
  handlers.onCellClick(state.pieces[0].position);
  await settle();
  return { runtime, applied, click: value => handlers.onCellClick(value), hover: value => handlers.onCellHoverStart(value), rendered: () => rendered,
    endTurn: () => previewClick({ target: { closest: () => ({ getAttribute: () => "end-turn" }) } }),
  };
}

for (const type of ["rush", "move", "project", "retreat", "follow"]) {
  test(`${type} preview submits without a preceding hover event`, async () => {
    const moves = [action(type), action(type, coord(4, 2), coord(5, 2))];
    const f = await fixture({ actions: moves });
    assert.equal(f.runtime.getSelection().target, null);
    f.click(moves[0].to);
    assert.deepEqual(f.applied, [moves[0]]);
  });
}

test("retained selection follows a moved piece through snapshot hydration", async () => {
  const f = await fixture();
  const next = snapshot(coord(4, 3));
  const moves = [action("rush", coord(4, 3), coord(4, 4)), action("rush", coord(4, 3), coord(5, 3))];
  await f.runtime.loadSnapshot(next, { legalActions: moves, resetSelection: false });
  assert.deepEqual(f.runtime.getSelection().source, coord(4, 3));
  f.hover(coord(4, 4));
  f.click(coord(4, 4));
  assert.deepEqual(f.applied, [moves[0]]);
});

test("duplicate clicks and end-turn cannot overlap a pending submission", async () => {
  const pending = deferred();
  const calls = [];
  const f = await fixture({ host: {
    applyAction: async (_state, move) => { calls.push(move); return pending.promise; },
    endTurn: async () => { calls.push("end-turn"); return { accepted: false }; },
  } });
  f.hover(coord(4, 3));
  f.click(coord(4, 3));
  f.click(coord(4, 3));
  f.endTurn();
  assert.deepEqual(calls, [action()]);
  pending.resolve({ accepted: false });
  await settle();
});

test("an old action completion cannot overwrite a newer hydrated snapshot", async () => {
  const pending = deferred();
  const f = await fixture({ host: { applyAction: () => pending.promise } });
  f.hover(coord(4, 3));
  f.click(coord(4, 3));
  const newer = { ...snapshot(coord(6, 2)), turnIndex: 2 };
  await f.runtime.loadSnapshot(newer, { legalActions: [] });
  pending.resolve({ accepted: true, state: snapshot(coord(4, 3)), legalActions: [] });
  await settle();
  assert.deepEqual(f.runtime.getState(), newer);
});

test("old legal-action loads cannot overwrite a newer snapshot", async () => {
  const pending = deferred();
  const f = await fixture({ host: { loadLegalActions: () => pending.promise } });
  const loading = f.runtime.reloadLegalActions();
  const newer = { ...snapshot(), turnIndex: 3 };
  await f.runtime.loadSnapshot(newer, { legalActions: [] });
  pending.resolve({ state: snapshot(), legalActions: [action()] });
  await loading;
  assert.deepEqual(f.runtime.getState(), newer);
  assert.deepEqual(f.runtime.getLegalActions(), []);
});

test("a failed piece load releases the loading guard and selection can be cleared", async () => {
  const f = await fixture({ host: { loadPieceMoves: async () => { throw Error("offline"); } } });
  f.click(coord(0, 0));
  assert.equal(f.runtime.getSelection().selectedPieceId, null);
});

test("rejected actions rehydrate executable moves without reselection", async () => {
  const f = await fixture();
  f.hover(coord(4, 3));
  f.click(coord(4, 3));
  await settle();
  assert.ok(f.rendered().selectedPieceMoves.some(move => move.to?.col === 3));
});

test("touch selection still requires a target click followed by confirmation", async () => {
  const f = await fixture({ hover: false });
  f.click(coord(4, 3));
  assert.equal(f.applied.length, 0);
  f.click(coord(4, 3));
  assert.deepEqual(f.applied, [action()]);
});

test("rush wins over move at a shared target without hover", async () => {
  const f = await fixture({ actions: [action("move"), action("rush"), action("move", coord(4, 2), coord(5, 2))] });
  f.runtime.setActionType("move");
  f.click(coord(4, 3));
  assert.deepEqual(f.applied, [action("rush")]);
});

test("blocked previews cannot submit", async () => {
  const f = await fixture({ actions: [] });
  f.click(coord(4, 3));
  assert.equal(f.applied.length, 0);
});

test("control permissions and history overlays prevent preview submission", async () => {
  let allowed = true;
  const f = await fixture({ host: { canInteract: () => allowed } });
  allowed = false;
  f.click(coord(4, 3));
  assert.equal(f.applied.length, 0);
  allowed = true;
  await f.runtime.loadSnapshot(snapshot(), { legalActions: [action()], overlayMode: "recorded-action", selectionAction: action() });
  await f.runtime.submitCurrentAction(action());
  assert.equal(f.applied.length, 0);
});

test("removed selected pieces are cleared when selection is retained", async () => {
  const f = await fixture();
  await f.runtime.loadSnapshot({ ...snapshot(), pieces: [] }, { legalActions: [], resetSelection: false });
  assert.equal(f.runtime.getSelection().selectedPieceId, null);
});

test("stale piece responses cannot refill a newer selection", async () => {
  const pending = deferred();
  const f = await fixture({ host: { loadPieceMoves: () => pending.promise } });
  const nextMoves = [action("rush", coord(4, 3), coord(4, 4))];
  await f.runtime.loadSnapshot(snapshot(coord(4, 3)), { legalActions: nextMoves, resetSelection: false });
  pending.resolve({ state: snapshot(), actions: [action()], previewActions: [action()] });
  await settle();
  assert.deepEqual(f.rendered().selectedPieceMoves, nextMoves);
});

test("piece queries describing a different snapshot do not replace current actions", async () => {
  const f = await fixture({ host: { loadPieceMoves: async () => ({ state: snapshot(coord(7, 7)), actions: [action("move", coord(7, 7), coord(7, 8))] }) } });
  assert.deepEqual(f.runtime.getState(), snapshot());
  assert.ok(f.rendered().selectedPieceMoves.every(move => move.from.col === 2));
});

test("the latest legal-actions query wins when responses arrive out of order", async () => {
  const requests = [];
  const f = await fixture({ host: { loadLegalActions: () => { const request = deferred(); requests.push(request); return request.promise; } } });
  const first = f.runtime.reloadLegalActions();
  const second = f.runtime.reloadLegalActions();
  requests[1].resolve({ state: snapshot(), legalActions: [action("project")] });
  await second;
  requests[0].resolve({ state: snapshot(), legalActions: [action("rush")] });
  await first;
  assert.deepEqual(f.runtime.getLegalActions(), [action("project")]);
});

test("a failed submission releases its guard for the next click", async () => {
  let calls = 0;
  const f = await fixture({ host: { applyAction: async () => { calls++; throw Error("offline"); } } });
  f.click(coord(4, 3));
  await settle();
  f.click(coord(4, 3));
  await settle();
  assert.equal(calls, 2);
});

test("accepted moves update the retained source and allow the next move while previews load", async () => {
  const slow = deferred();
  const calls = [];
  let loading = false;
  const moves = [action("rush", coord(4, 3), coord(4, 4)), action("rush", coord(4, 3), coord(5, 3))];
  const f = await fixture({ host: {
    applyAction: async (_state, value) => { calls.push(value); loading = true; return { accepted: true, state: snapshot(coord(4, 3)), legalActions: moves }; },
    loadPieceMoves: async state => loading ? slow.promise : buildPieceMoveResponse({ state, legalActions: [action(), action("rush", coord(4, 2), coord(5, 2))], pieceId: "A" }),
  } });
  f.click(coord(4, 3));
  await settle();
  assert.deepEqual(f.runtime.getSelection().source, coord(4, 3));
  f.click(coord(4, 4));
  await settle();
  assert.deepEqual(calls, [action(), moves[0]]);
  slow.resolve({ actions: moves, previewActions: moves });
  await settle();
});

test("end-turn completion cannot replace a newer hydrated snapshot", async () => {
  const pending = deferred();
  const f = await fixture({ host: { endTurn: () => pending.promise } });
  f.endTurn();
  const newer = { ...snapshot(), turnIndex: 4 };
  await f.runtime.loadSnapshot(newer, { legalActions: [] });
  pending.resolve({ accepted: true, state: { ...snapshot(), turnIndex: 1 }, legalActions: [] });
  await settle();
  assert.deepEqual(f.runtime.getState(), newer);
});

test("an older legal query cannot cancel an accepted pending action", async () => {
  const legal = deferred(), applied = deferred();
  const f = await fixture({ host: { loadLegalActions: () => legal.promise, applyAction: () => applied.promise } });
  const loading = f.runtime.reloadLegalActions();
  f.click(coord(4, 3));
  legal.resolve({ state: snapshot(), legalActions: [action()] });
  await loading;
  applied.resolve({ accepted: true, state: snapshot(coord(4, 3)), legalActions: [] });
  await settle();
  assert.deepEqual(f.runtime.getState().pieces[0].position, coord(4, 3));
});

test("rejection recovery keeps admission until its refresh has completed", async () => {
  const legal = deferred(), second = deferred();
  let calls = 0;
  const f = await fixture({ host: {
    loadLegalActions: () => legal.promise,
    applyAction: async () => ++calls === 1 ? { accepted: false } : second.promise,
  } });
  f.click(coord(4, 3));
  await settle();
  await f.runtime.loadSnapshot(snapshot(), { legalActions: [action()] });
  f.click(coord(4, 2));
  f.click(coord(4, 3));
  assert.equal(calls, 1);
  legal.resolve({ state: snapshot(), legalActions: [action()] });
  await settle();
  f.click(coord(4, 2));
  f.click(coord(4, 3));
  f.click(coord(4, 3));
  assert.equal(calls, 2);
  second.resolve({ accepted: true, state: snapshot(coord(4, 3)), legalActions: [] });
  await settle();
});

test("an older legal query cannot cancel an accepted pending end-turn", async () => {
  const legal = deferred(), ending = deferred();
  const f = await fixture({ host: { loadLegalActions: () => legal.promise, endTurn: () => ending.promise } });
  const loading = f.runtime.reloadLegalActions();
  f.endTurn();
  legal.resolve({ state: snapshot(), legalActions: [action()] });
  await loading;
  ending.resolve({ accepted: true, state: { ...snapshot(), sideToMove: "P2", turnIndex: 1 }, legalActions: [] });
  await settle();
  assert.equal(f.runtime.getState().turnIndex, 1);
});
