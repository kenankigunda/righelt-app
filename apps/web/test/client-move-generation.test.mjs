import test from "node:test";
import assert from "node:assert/strict";

import { buildPieceMoveResponse } from "../board/client-move-generation.js";

test("client move generation includes unsupplied-blocked previews but not legal actions", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "U2-wall-top", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
      { id: "U2-wall-bottom", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      { id: "U2-block-north", owner: "P2", kind: "unit", position: { row: 3, col: 5 }, supplied: true, commanded: true },
      { id: "U2-block-south", owner: "P2", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
      { id: "U2-block-east", owner: "P2", kind: "unit", position: { row: 4, col: 6 }, supplied: true, commanded: true },
    ],
    continuation: null,
    outcome: { status: "ongoing" },
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [
      { type: "pass" },
      { type: "move", actorId: "C1", from: { row: 4, col: 4 }, to: { row: 3, col: 4 } },
      { type: "move", actorId: "C1", from: { row: 4, col: 4 }, to: { row: 5, col: 4 } },
      { type: "move", actorId: "C1", from: { row: 4, col: 4 }, to: { row: 4, col: 3 } },
    ],
    pieceId: "C1",
  });

  assert.equal(
    response.actions.some((action) => action.type === "move" && action.to?.row === 4 && action.to?.col === 5),
    false,
  );
  assert.equal(
    response.previewActions.some(
      (action) =>
        action.to?.row === 4 &&
        action.to?.col === 5 &&
        action.legal === false &&
        action.blockedReason === "SUPPLY_DESTINATION_UNSUPPLIED",
    ),
    true,
  );
});

test("client move generation includes blocked push previews for inadequate group strength", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "A2", owner: "P1", kind: "unit", position: { row: 3, col: 3 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true },
    ],
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [{ type: "pass" }],
    pieceId: "A1",
  });

  assert.equal(
    response.actions.some((action) => action.type === "push" && action.to?.row === 5 && action.to?.col === 3),
    false,
  );
  assert.equal(
    response.previewActions.some(
      (action) =>
        action.type === "push" &&
        action.to?.row === 5 &&
        action.to?.col === 3 &&
        action.legal === false &&
        action.blockedReason === "PUSH_STRENGTH_TOO_WEAK",
    ),
    true,
  );
});

test("client move generation omits push moves and previews when local group strength is below 2", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "A1", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "D1", owner: "P2", kind: "unit", position: { row: 5, col: 3 }, supplied: true, commanded: true },
    ],
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [
      { type: "pass" },
      { type: "push", actorId: "A1", from: { row: 4, col: 3 }, to: { row: 5, col: 3 } },
    ],
    pieceId: "A1",
  });

  assert.equal(response.actions.some((action) => action.type === "push"), false);
  assert.equal(response.previewActions.some((action) => action.type === "push"), false);
});

test("client move generation previews a projected commander action as a unit", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 3 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
    ],
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [{ type: "project", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 3, col: 5 } }],
    pieceId: "C1",
  });

  const preview = response.previewActions.find((action) => action.type === "project" && action.to?.row === 3 && action.to?.col === 5);
  assert.equal(preview?.legal, true);
  assert.deepEqual(preview?.previewPiece, {
    owner: "P1",
    kind: "unit",
    position: { row: 3, col: 5 },
  });
});

test("client move generation marks preview pieces uncommanded when the resulting action severs command", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 3 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "U1-1", owner: "P1", kind: "unit", position: { row: 4, col: 3 }, supplied: true, commanded: true },
      { id: "U2-cut-top", owner: "P2", kind: "unit", position: { row: 2, col: 4 }, supplied: true, commanded: true },
      { id: "U2-cut-bottom", owner: "P2", kind: "unit", position: { row: 6, col: 4 }, supplied: true, commanded: true },
    ],
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [{ type: "project", actorId: "U1-1", from: { row: 4, col: 3 }, to: { row: 4, col: 5 } }],
    pieceId: "U1-1",
  });

  const preview = response.previewActions.find((action) => action.type === "project" && action.to?.row === 4 && action.to?.col === 5);
  assert.equal(preview?.legal, true);
  assert.deepEqual(preview?.previewPiece, {
    owner: "P1",
    kind: "unit",
    position: { row: 4, col: 5 },
  });
});

test("client move generation keeps sequence-completable rush previews legal", () => {
  const state = {
    boardSize: 10,
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      { id: "C1", owner: "P1", kind: "commander", position: { row: 3, col: 6 }, supplied: true, commanded: true },
      { id: "C2", owner: "P2", kind: "commander", position: { row: 6, col: 3 }, supplied: true, commanded: true },
      { id: "A", owner: "P1", kind: "unit", position: { row: 4, col: 4 }, supplied: true, commanded: true },
      { id: "B", owner: "P1", kind: "unit", position: { row: 5, col: 5 }, supplied: true, commanded: true },
      { id: "E0", owner: "P2", kind: "unit", position: { row: 0, col: 4 }, supplied: true, commanded: true },
      { id: "E1", owner: "P2", kind: "unit", position: { row: 9, col: 4 }, supplied: true, commanded: true },
      { id: "E2", owner: "P2", kind: "unit", position: { row: 4, col: 2 }, supplied: true, commanded: true },
    ],
  };

  const response = buildPieceMoveResponse({
    state,
    legalActions: [{ type: "rush", actorId: "A", from: { row: 4, col: 4 }, to: { row: 4, col: 3 } }],
    pieceId: "A",
  });

  assert.equal(
    response.actions.some((action) => action.type === "rush" && action.to?.row === 4 && action.to?.col === 3),
    true,
  );
  assert.equal(
    response.previewActions.some(
      (action) =>
        action.type === "rush" &&
        action.to?.row === 4 &&
        action.to?.col === 3 &&
        action.legal === true,
    ),
    true,
  );
});

test('non-spatial turn actions never become piece moves even with stale actor metadata', () => {
  const piece={id:'C1',owner:'P1',kind:'commander',position:{row:3,col:3},supplied:true,commanded:true};
  const state={sideToMove:'P1',continuation:null,outcome:{status:'ongoing'},pieces:[piece]};
  const response=buildPieceMoveResponse({state,pieceId:'C1',legalActions:[{type:'pass',actorId:'C1'},{type:'end_turn',actorId:'C1'}]});
  assert.deepEqual(response.actions,[]);
});

test('client previews reject Pass in sequences and allow End Turn only for closable rush', async () => {
  const {validateActionForPreview}=await import('../board/client-move-generation.js');
  const base={sideToMove:'P1',outcome:{status:'ongoing'},pieces:[],continuation:null};
  assert.equal(validateActionForPreview(base,{type:'pass'}).ok,true);
  assert.equal(validateActionForPreview(base,{type:'end_turn'}).ok,false);
  for(const continuation of [{type:'rush',owner:'P1',rushedPieceIds:[]},{type:'push',phase:'retreat'},{type:'push',phase:'follow'}]) {
    const state={...base,continuation};
    assert.equal(validateActionForPreview(state,{type:'pass'}).ok,false);
    assert.equal(validateActionForPreview(state,{type:'end_turn'}).ok,continuation.type==='rush');
  }
});
