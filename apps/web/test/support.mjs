import { createShellStore } from "../shell/store.js";

export const createMemoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

export const createTestStore = () => {
  const storage = createMemoryStorage();
  const board = {
    state: {
      pieces: [
        { id: "P1-C", owner: "P1", kind: "commander", position: { row: 0, col: 0 }, supplied: true, commanded: true },
        { id: "P2-C", owner: "P2", kind: "commander", position: { row: 9, col: 9 }, supplied: true, commanded: true },
      ],
      sideToMove: "P1",
      turnIndex: 0,
    },
    legalActions: [],
  };

  let tick = 0;
  const deterministicRandom = () => {
    tick += 1;
    const seed = 0.123456 + tick * 0.0001;
    return seed % 1;
  };

  const store = createShellStore({
    storage,
    random: deterministicRandom,
    now: () => "2026-02-26T00:00:00.000Z",
    loadBoardState: async () => structuredClone(board),
  });

  return { store, storage };
};
