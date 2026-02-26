import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("required prompt categories are represented through game notifications", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.joinGame({ gameId: game.id, mode: "viewer" });
  store.joinGame({ gameId: game.id, mode: "player", inviteFromRole: null });
  store.setParticipantConnected({ gameId: game.id, role: "Player 1", connected: false });
  store.setParticipantConnected({ gameId: game.id, role: "Player 1", connected: true });
  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 1 } });
  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });

  const vm = store.getGameViewModel(game.id);
  const joined = vm.notifications.some((note) => /joined|request/i.test(note));
  const history = vm.notifications.some((note) => /history/i.test(note));
  const presence = vm.notifications.some((note) => /connected|disconnected/i.test(note));

  assert.equal(joined, true);
  assert.equal(history, true);
  assert.equal(presence, true);
});
