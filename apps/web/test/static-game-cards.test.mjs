import test from "node:test";
import assert from "node:assert/strict";
import { buildStaticGameCardFromGame, buildStaticGameCardFromScenario, normalizeStaticGameCard } from "../shell/static-game-cards.js";

test("static game cards normalize list payloads without requiring full game state", () => {
  const card = normalizeStaticGameCard({
    id: "game-card-1",
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: "2026-02-26T00:00:02.000Z",
    updatedAt: "2026-02-26T00:00:02.000Z",
    moveCount: 2,
    previewSnapshot: { sideToMove: "P2", turnIndex: 1, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    myRole: "Guest",
    canJoinAsPlayer: true,
    player1: { identityId: "id-a", connected: true },
    player2: null,
  });

  assert.equal(card.id, "game-card-1");
  assert.equal(card.moveCount, 2);
  assert.equal(card.previewSnapshot.sideToMove, "P2");
  assert.equal(card.canJoinAsPlayer, true);
  assert.equal(card.player1.identityId, "id-a");
});

test("static game cards derive scenario previews from resulting state and move count", () => {
  const card = buildStaticGameCardFromScenario({
    id: "scenario-1",
    initialState: { sideToMove: "P1", turnIndex: 0, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    resultingState: { sideToMove: "P2", turnIndex: 3, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    savedSelection: { source: { row: 1, col: 1 }, target: { row: 1, col: 2 } },
    moves: [{}, {}, {}],
  });

  assert.equal(card.id, "scenario-1");
  assert.equal(card.moveCount, 3);
  assert.equal(card.previewSnapshot.sideToMove, "P2");
  assert.deepEqual(card.previewSelection, { source: { row: 1, col: 1 }, target: { row: 1, col: 2 } });
});

test("static game cards derive home-card summaries from full live game views", () => {
  const card = buildStaticGameCardFromGame({
    id: "game-live-1",
    createdAt: "2026-02-26T00:00:00.000Z",
    lastMoveAt: "2026-02-26T00:00:03.000Z",
    updatedAt: "2026-02-26T00:00:03.000Z",
    moves: [{}, {}],
    currentSnapshot: { sideToMove: "P1", turnIndex: 2, pieces: [], continuation: null, outcome: { status: "ongoing" } },
    myRole: "Player 1",
    canJoinAsPlayer: false,
    player1: { identityId: "id-a", connected: true },
    player2: { identityId: "id-b", connected: false },
    syncStatus: "confirming",
  });

  assert.equal(card.moveCount, 2);
  assert.equal(card.previewSnapshot.turnIndex, 2);
  assert.equal(card.myRole, "Player 1");
  assert.equal(card.syncStatus, "confirming");
});
