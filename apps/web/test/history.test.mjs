import test from "node:test";
import assert from "node:assert/strict";
import { createTestStore } from "./support.mjs";

test("history mode uses selected move snapshot and return-to-live clears history mode", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.addMove({ gameId: game.id, notation: "M2", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.endTurn({ gameId: game.id });
  store.addMove({ gameId: game.id, notation: "M3", snapshot: { turnIndex: 1, sideToMove: "P2" } });

  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  let vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.currentSnapshot.turnIndex, 0);

  store.returnToLive({ gameId: game.id });
  vm = store.getGameViewModel(game.id);
  assert.equal(vm.inHistoryMode, false);
  assert.equal(vm.currentTurn.index, 1);
});

test("new moves append while in history mode", async () => {
  const { store } = createTestStore();
  const game = await store.createGame();

  store.addMove({ gameId: game.id, notation: "M1", snapshot: { turnIndex: 0, sideToMove: "P1" } });
  store.selectHistoryMove({ gameId: game.id, moveIndex: 0 });
  store.addMove({ gameId: game.id, notation: "M2", snapshot: { turnIndex: 0, sideToMove: "P1" } });

  const vm = store.getGameViewModel(game.id);
  assert.equal(vm.moves.length, 2);
  assert.equal(vm.inHistoryMode, true);
  assert.equal(vm.currentTurn.moveIndexes.length, 2);
});
