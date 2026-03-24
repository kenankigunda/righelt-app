import { GameRoomDO } from "../../src/index.ts";

export const createFakeGameRooms = (getEnv) => {
  const rooms = new Map();

  const createRoomRecord = (gameId) => {
    const record = {
      alarmAt: null,
      autoResponse: null,
      instance: null,
      sockets: [],
      state: null,
    };
    record.state = {
      id: { name: gameId, toString: () => gameId },
      blockConcurrencyWhile: async (callback) => callback(),
      acceptWebSocket(socket) {
        if (!record.sockets.includes(socket)) {
          record.sockets.push(socket);
        }
        socket.__runtime = record.instance;
      },
      getWebSockets() {
        return [...record.sockets];
      },
      setWebSocketAutoResponse(pair) {
        record.autoResponse = pair;
      },
      storage: {
        setAlarm(scheduledTime) {
          record.alarmAt = scheduledTime instanceof Date ? scheduledTime.getTime() : Number(scheduledTime);
        },
        deleteAlarm() {
          record.alarmAt = null;
        },
      },
    };
    return record;
  };

  const instantiateRoom = (gameId) => {
    const record = rooms.get(gameId) ?? createRoomRecord(gameId);
    const instance = new GameRoomDO(record.state, getEnv());
    if (typeof instance.setGameId === "function") {
      void instance.setGameId(gameId);
    }
    record.instance = instance;
    for (const socket of record.sockets) {
      socket.__runtime = instance;
    }
    rooms.set(gameId, record);
    return instance;
  };

  const getRoom = (gameId) => {
    const record = rooms.get(gameId);
    if (record?.instance) {
      return record.instance;
    }
    return instantiateRoom(gameId);
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
    fireAlarm(gameId) {
      const room = getRoom(gameId);
      return room.alarm();
    },
    getAlarm(gameId) {
      return rooms.get(gameId)?.alarmAt ?? null;
    },
    restart(gameId) {
      return instantiateRoom(gameId);
    },
    reset() {
      rooms.clear();
    },
  };
};
