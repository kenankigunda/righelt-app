import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, deriveCanonicalSession } from "../src/shell-live-core.ts";

const makeDriftedGame = () => {
  const game = createInitialGame({
    gameId: "game-authority-adapter",
    identityId: "id-owner",
    playgroundMode: false,
    offlineLocal: false,
  });
  return structuredClone(game);
};

test("authority adapter: terminal state with turn index advance keeps control with opponent", () => {
  const game = makeDriftedGame();
  game.board.state = {
    ...game.board.state,
    turnIndex: 1,
    sideToMove: "P2",
    continuation: null,
  };

  const canonicalSession = deriveCanonicalSession(game);

  assert.equal(canonicalSession.activeTurn?.index, 1);
  assert.equal(canonicalSession.turnOwnerSeat, "Player 2");
  assert.equal(canonicalSession.controlSeat, "Player 2");
});

test("authority adapter: rush continuation keeps control with same turn owner", () => {
  const game = makeDriftedGame();
  game.board.state = {
    ...game.board.state,
    sideToMove: "P2",
    continuation: {
      type: "rush",
      owner: "P1",
      chainLength: 1,
      rushedPieceIds: ["C1"],
    },
  };

  const canonicalSession = deriveCanonicalSession(game);

  assert.equal(canonicalSession.turnOwnerSeat, "Player 1");
  assert.equal(canonicalSession.controlSeat, "Player 1");
});

test("authority adapter: push retreat transfers control to the opponent", () => {
  const game = makeDriftedGame();
  game.board.state = {
    ...game.board.state,
    sideToMove: "P2",
    continuation: {
      type: "push",
      owner: "P1",
      chainLength: 1,
      phase: "retreat",
    },
  };

  const canonicalSession = deriveCanonicalSession(game);

  assert.equal(canonicalSession.turnOwnerSeat, "Player 1");
  assert.equal(canonicalSession.controlSeat, "Player 2");
});

test("authority adapter: push follow restores control to the turn owner", () => {
  const game = makeDriftedGame();
  game.board.state = {
    ...game.board.state,
    sideToMove: "P2",
    continuation: {
      type: "push",
      owner: "P1",
      chainLength: 1,
      phase: "follow",
    },
  };

  const canonicalSession = deriveCanonicalSession(game);

  assert.equal(canonicalSession.turnOwnerSeat, "Player 1");
  assert.equal(canonicalSession.controlSeat, "Player 1");
});

test("authority adapter: canonicalization flags replay mismatch and reports repaired projection", () => {
  const game = makeDriftedGame();
  game.moves.push({
    index: 0,
    turnIndex: 0,
    turnMoveIndex: 0,
    actorSide: "P1",
    at: "2026-03-16T00:00:00.000Z",
    notation: "PASS",
    action: { type: "pass" },
    selectionSnapshot: structuredClone(game.board.state),
    snapshot: structuredClone(game.board.state),
  });
  game.board.state = {
    ...game.board.state,
    sideToMove: "P2",
  };
  game.turns[0].playerSeat = "Player 2";

  const canonicalSession = deriveCanonicalSession(game);

  assert.equal(canonicalSession.repaired, true);
  assert.equal(canonicalSession.state.sideToMove, "P1");
  assert.equal(canonicalSession.turnOwnerSeat, "Player 1");
  assert.equal(canonicalSession.repairedProjection.board.state.sideToMove, "P1");
  assert.equal(canonicalSession.repairedProjection.turns[0].playerSeat, "Player 1");
});

test("authority adapter: already-canonical projection does not trigger repair", () => {
  const game = makeDriftedGame();
  const canonicalSession = deriveCanonicalSession(game);

  assert.equal(canonicalSession.repaired, false);
  assert.equal(canonicalSession.activeTurn?.index, 0);
  assert.equal(canonicalSession.turnOwnerSeat, "Player 1");
});
