import test from "node:test";
import assert from "node:assert/strict";
import { buildStaticGameCardFromGame, buildStaticGameCardFromScenario, normalizeStaticGameCard, computerOpponentLabel } from "../shell/static-game-cards.js";

test('computer identity survives list normalization and full-game refresh on either side', () => {
  for (const profile of ['babs', 'tau', 'horus']) for (const side of ['player1', 'player2']) {
    const input = { id:'computer', myRole:'Player 1', player1:{identityId:'owner'}, player2:{identityId:'owner'} };
    input[side].computerProfile = profile;
    for (const card of [normalizeStaticGameCard(input), buildStaticGameCardFromGame(input)]) {
      assert.equal(card[side].computerProfile, profile);
      assert.equal(computerOpponentLabel(card), `You vs ${profile[0].toUpperCase()}${profile.slice(1)}`);
    }
  }
});

test('watched games and genuine self-play remain distinct', () => {
  assert.equal(computerOpponentLabel({player1:{computerProfile:'babs'},player2:{computerProfile:'tau'}}), 'Babs vs Tau');
  assert.equal(computerOpponentLabel({myRole:'Viewer',player2:{computerProfile:'tau'}}), 'Tau · Computer');
  const self = normalizeStaticGameCard({player1:{identityId:'owner'},player2:{identityId:'owner'}});
  assert.equal(computerOpponentLabel(self), null);
  assert.equal(normalizeStaticGameCard({player1:{identityId:'owner',computerProfile:'invalid'}}).player1.computerProfile, null);
});

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
