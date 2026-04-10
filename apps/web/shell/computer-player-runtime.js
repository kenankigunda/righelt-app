import { selectMove } from "../generated/packages/computer-player/src/index.js";

const TURN_KEY_DELIMITER = "|";
const DEFAULT_SELECT_MOVE_TIMEOUT_MS = 4_000;
const COMPUTER_PLAYER_WORKER_MODULE_URL = new URL("../generated/packages/computer-player/src/index.js", import.meta.url).href;

const createRuntimeError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getControlSeat = (game) => game?.controlSeat ?? game?.currentTurn?.playerSeat ?? null;

const getSelectMoveImplementation = () =>
  typeof globalThis !== "undefined" && typeof globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__ === "function"
    ? globalThis.__RIGHELT_COMPUTER_PLAYER_SELECT_MOVE__
    : selectMove;

const getMoveCount = (game) => {
  const moveIndexes = Array.isArray(game?.currentTurn?.moveIndexes) ? game.currentTurn.moveIndexes : [];
  return moveIndexes.length;
};

export const buildComputerPlayerTurnKey = (game) => {
  if (!game?.id || !game?.currentTurn) {
    return null;
  }
  const explicitTurnKey =
    typeof game?.computerPlayer?.activeTurnKey === "string" && game.computerPlayer.activeTurnKey.trim()
      ? game.computerPlayer.activeTurnKey.trim()
      : "";
  if (explicitTurnKey) {
    return explicitTurnKey;
  }
  const controlSeat = getControlSeat(game);
  return [
    game.id,
    `turn:${game.currentTurn.index}`,
    `moves:${getMoveCount(game)}`,
    `owner:${game.currentTurn.playerSeat}`,
    `control:${controlSeat ?? "unknown"}`,
  ].join(TURN_KEY_DELIMITER);
};

export const buildComputerPlayerCommandId = (game, actionKey) => {
  const turnKey = buildComputerPlayerTurnKey(game);
  const botId = typeof game?.computerPlayer?.botId === "string" && game.computerPlayer.botId ? game.computerPlayer.botId : "unknown-bot";
  const suffix = typeof actionKey === "string" && actionKey ? actionKey : "select";
  return `bot:${game?.id ?? "unknown"}:${turnKey ?? "no-turn"}:${botId}:${suffix}`;
};

export const buildComputerPlayerSeed = (turnKey, botId) => {
  const source = `${turnKey ?? "no-turn"}:${botId ?? "unknown"}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const runComputerPlayerSelectMove = async (request) => Promise.resolve().then(() => getSelectMoveImplementation()(request));

export const createInlineComputerPlayerRuntime = () => ({
  kind: "inline",
  selectMove: (request) => runComputerPlayerSelectMove(request),
  destroy() {},
});

const buildWorkerSource = () => `
import { selectMove } from ${JSON.stringify(COMPUTER_PLAYER_WORKER_MODULE_URL)};

self.addEventListener("message", async (event) => {
  const payload = event.data ?? {};
  if (payload.type !== "selectMove" || typeof payload.requestId !== "string") {
    return;
  }
  try {
    const response = await Promise.resolve(selectMove(payload.request));
    self.postMessage({ type: "selectMove:result", requestId: payload.requestId, response });
  } catch (error) {
    self.postMessage({
      type: "selectMove:error",
      requestId: payload.requestId,
      error: {
        message: error instanceof Error ? error.message : String(error || "Unknown worker error"),
        code: error && typeof error === "object" && typeof error.code === "string" ? error.code : "computer_player_worker_error",
      },
    });
  }
});
`;

const createWorkerRecord = () => {
  if (typeof Worker !== "function" || typeof URL === "undefined" || typeof Blob === "undefined") {
    throw createRuntimeError("Computer-player workers are unavailable in this environment.", "computer_player_worker_unavailable");
  }
  const source = buildWorkerSource();
  const workerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(workerUrl, { type: "module" });
  return { worker, workerUrl };
};

export const createComputerPlayerRuntime = ({
  timeoutMs = DEFAULT_SELECT_MOVE_TIMEOUT_MS,
  createWorker = createWorkerRecord,
} = {}) => {
  if (typeof Worker !== "function") {
    return createInlineComputerPlayerRuntime();
  }

  let workerRecord = null;
  let nextRequestId = 0;
  const pendingRequests = new Map();

  const cleanupPendingRequest = (requestId) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return null;
    }
    pendingRequests.delete(requestId);
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    return pending;
  };

  const teardownWorker = () => {
    if (!workerRecord) {
      return;
    }
    const { worker, workerUrl } = workerRecord;
    workerRecord = null;
    try {
      worker.terminate();
    } catch {
      // ignore
    }
    try {
      URL.revokeObjectURL(workerUrl);
    } catch {
      // ignore
    }
    for (const requestId of pendingRequests.keys()) {
      const pending = cleanupPendingRequest(requestId);
      pending?.reject(
        createRuntimeError(
          "Computer-player worker stopped before move selection completed.",
          "computer_player_worker_terminated",
        ),
      );
    }
  };

  const ensureWorker = () => {
    if (workerRecord) {
      return workerRecord.worker;
    }
    const record = createWorker();
    const worker = record?.worker;
    if (!(worker instanceof Worker)) {
      throw createRuntimeError("Computer-player runtime did not provide a usable worker.", "computer_player_worker_invalid");
    }
    worker.addEventListener("message", (event) => {
      const payload = event.data ?? {};
      if (typeof payload.requestId !== "string") {
        return;
      }
      const pending = cleanupPendingRequest(payload.requestId);
      if (!pending) {
        return;
      }
      if (payload.type === "selectMove:result") {
        pending.resolve(payload.response);
        return;
      }
      if (payload.type === "selectMove:error") {
        pending.reject(
          createRuntimeError(
            payload.error?.message || "Computer-player worker failed to select a move.",
            payload.error?.code || "computer_player_worker_error",
          ),
        );
        return;
      }
      pending.reject(createRuntimeError("Computer-player worker returned an unknown response.", "computer_player_worker_protocol"));
    });
    worker.addEventListener("error", () => {
      teardownWorker();
    });
    workerRecord = record;
    return worker;
  };

  return {
    kind: "worker",
    selectMove(request) {
      const worker = ensureWorker();
      const requestId = `cp-${nextRequestId}`;
      nextRequestId += 1;
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cleanupPendingRequest(requestId);
          reject(
            createRuntimeError(
              `Computer-player move selection exceeded ${timeoutMs}ms.`,
              "computer_player_timeout",
            ),
          );
        }, timeoutMs);
        pendingRequests.set(requestId, { resolve, reject, timeoutId });
        worker.postMessage({
          type: "selectMove",
          requestId,
          request,
        });
      });
    },
    destroy() {
      teardownWorker();
    },
  };
};
