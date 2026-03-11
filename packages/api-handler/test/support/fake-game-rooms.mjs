import { GameRoomDO } from "../../src/index.ts";

export const createFakeGameRooms = (getEnv) => {
  const rooms = new Map();

  const getRoom = (gameId) => {
    if (!rooms.has(gameId)) {
      const instance = new GameRoomDO(
        {
          blockConcurrencyWhile: async (callback) => callback(),
        },
        getEnv(),
      );
      if (typeof instance.setGameId === "function") {
        void instance.setGameId(gameId);
      }
      rooms.set(gameId, instance);
    }
    return rooms.get(gameId);
  };

  return {
    idFromName(name) {
      return { name };
    },
    get(id) {
      const gameId = typeof id === "object" && id && "name" in id ? id.name : String(id);
      const room = getRoom(gameId);
      return {
        fetch(request) {
          return room.fetch(request);
        },
      };
    },
    reset() {
      rooms.clear();
    },
  };
};
