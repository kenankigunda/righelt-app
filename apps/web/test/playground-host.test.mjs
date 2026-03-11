import test from "node:test";
import assert from "node:assert/strict";
import { createPlaygroundBoardHost } from "../board/hosts/playground-host.js";

test("playground host serves selected piece moves from cached legal actions", async () => {
  const calls = [];
  const state = {
    sideToMove: "P1",
    turnIndex: 0,
    continuation: null,
    outcome: { status: "ongoing" },
    pieces: [
      {
        id: "C1",
        owner: "P1",
        kind: "commander",
        position: { row: 3, col: 3 },
        supplied: true,
        commanded: true,
      },
    ],
  };

  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url) === "/api/engine/playground/state") {
      return Response.json({
        ok: true,
        state,
        legalActions: [
          { type: "pass" },
          { type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 2, col: 3 } },
          { type: "move", actorId: "C1", from: { row: 3, col: 3 }, to: { row: 3, col: 4 } },
        ],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const host = createPlaygroundBoardHost(fetcher);
  await host.loadInitialState();
  const result = await host.loadPieceMoves(state, "C1");

  assert.deepEqual(
    result.actions.map((action) => action.to),
    [
      { row: 2, col: 3 },
      { row: 3, col: 4 },
    ],
  );
  assert.equal(calls.includes("/api/engine/playground/piece-moves"), false);
});
