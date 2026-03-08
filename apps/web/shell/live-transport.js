import { loadIdentity, saveIdentity } from "./persistence.js";

const clone = (value) => structuredClone(value);
const MAX_HISTORY = 200;
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getActiveTurn = (game) => game.turns?.[game.turns.length - 1] ?? null;
const getSideToMoveSeat = (game) => (game.board?.state?.sideToMove === "P1" ? "Player 1" : "Player 2");
const getControlSeatForTurn = (state, turnOwnerSeat) => {
  const continuation = state?.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push") {
    if (continuation.phase === "retreat") {
      return getNextSeat(turnOwnerSeat);
    }
    return turnOwnerSeat;
  }
  if (continuation.type === "rush") {
    return turnOwnerSeat;
  }
  return turnOwnerSeat;
};
const renumberHistory = (game) => {
  game.moves.forEach((move, index) => {
    move.index = index;
  });
  game.turns.forEach((turn) => {
    turn.moveIndexes = turn.moveIndexes
      .map((_, turnMoveIndex) => game.moves.find((move) => move.turnIndex === turn.index && move.turnMoveIndex === turnMoveIndex)?.index ?? -1)
      .filter((index) => index >= 0);
  });
};

const createIdentity = (random = Math.random) => `id-${random().toString(36).slice(2, 10)}`;

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

const mustOk = async (response) => {
  const body = await readJson(response);
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error || `HTTP_${response.status}`);
    error.code = body.error || `HTTP_${response.status}`;
    throw error;
  }
  return body;
};

export const createLiveTransportStore = ({ storage, fetcher = fetch, random = Math.random }) => {
  let identityId = loadIdentity(storage);
  if (!identityId) {
    identityId = createIdentity(random);
    saveIdentity(storage, identityId);
  }

  let offline = false;
  let games = [];
  let gameById = new Map();
  const offlinePendingByGameId = new Map();

  const withOfflineQuery = (path) => `${path}${path.includes("?") ? "&" : "?"}offline=${offline ? "1" : "0"}`;

  const syncCacheFromList = (nextGames) => {
    games = clone(nextGames);
    gameById = new Map(games.map((game) => [game.id, game]));
  };

  const applyClientOfflineViewState = (game) => {
    const next = clone(game);
    if (!offline) {
      return next;
    }
    next.showOfflineState = true;
    next.canInvite = false;
    next.showJoinActions = false;
    const activeTurn = getActiveTurn(next);
    const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(next);
    const turnOwnerIdentity = turnOwnerSeat === "Player 1" ? next.player1?.identityId ?? null : next.player2?.identityId ?? null;
    const dualSeatOfflinePlayground =
      next.offlineLocal &&
      next.playgroundMode &&
      next.player1?.identityId === identityId &&
      next.player2?.identityId === identityId;
    next.canEndTurn =
      Boolean(dualSeatOfflinePlayground) &&
      next.myRole !== "Viewer" &&
      next.myRole !== "Guest" &&
      !next.inHistoryMode &&
      turnOwnerIdentity === identityId &&
      Boolean(getActiveTurn(next)?.moveIndexes?.length);
    return next;
  };

  const upsertGame = (game) => {
    const next = clone(game);
    gameById.set(next.id, next);
    const current = games.filter((entry) => entry.id !== next.id);
    if (!next.offlineLocal) {
      current.push(next);
    }
    current.sort((left, right) => {
      const leftTs = left.lastMoveAt || left.createdAt;
      const rightTs = right.lastMoveAt || right.createdAt;
      return rightTs.localeCompare(leftTs);
    });
    games = current;
    return next;
  };

  const queueOfflineMutation = (gameId, mutation) => {
    const current = offlinePendingByGameId.get(gameId) ?? [];
    current.push(mutation);
    offlinePendingByGameId.set(gameId, current);
  };

  const computeOfflineMoveState = async (state) => {
    const legalResponse = await fetcher("/api/engine/playground/legal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    const legalBody = await mustOk(legalResponse);
    const action = Array.isArray(legalBody.legalActions) && legalBody.legalActions.length > 0 ? legalBody.legalActions[0] : null;
    if (!action) {
      throw new Error("no_legal_actions");
    }

    const applyResponse = await fetcher("/api/engine/playground/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: legalBody.state, action }),
    });
    const applyBody = await mustOk(applyResponse);
    if (applyBody.accepted !== true || !applyBody.state) {
      throw new Error(applyBody.validation?.code || "offline_apply_failed");
    }
    return {
      action,
      state: applyBody.state,
    };
  };

  const applyOfflineMove = async (game, notation) => {
    const activeTurn = getActiveTurn(game);
    if (!activeTurn) {
      throw new Error("turn_not_initialized");
    }
    const computed = await computeOfflineMoveState(game.board.state);
    const next = computed.state;
    next.sideToMove = getSideForSeat(getControlSeatForTurn(next, activeTurn.playerSeat));
    next.turnIndex = activeTurn.index;

    const at = new Date().toISOString();
    const move = {
      index: game.moves.length,
      turnIndex: activeTurn.index,
      turnMoveIndex: activeTurn.moveIndexes.length,
      at,
      notation: notation || String(computed.action.type || "MOVE").toUpperCase(),
      snapshot: next,
    };
    game.moves.push(move);
    activeTurn.moveIndexes.push(move.index);
    activeTurn.lastMoveAt = at;
    if (game.moves.length > MAX_HISTORY) {
      game.moves.shift();
      renumberHistory(game);
    }
    game.board.state = next;
    game.lastMoveAt = at;
    game.updatedAt = at;
    game.notifications = [`Offline move recorded`, ...(game.notifications ?? [])].slice(0, 50);
    return move;
  };

  const applyOfflineEndTurn = (game) => {
    const activeTurn = getActiveTurn(game);
    if (!activeTurn || activeTurn.moveIndexes.length === 0) {
      throw new Error("turn_has_no_moves");
    }
    const endedAt = new Date().toISOString();
    activeTurn.endedAt = endedAt;
    activeTurn.status = "complete";
    const nextSeat = getNextSeat(activeTurn.playerSeat);
    const nextTurn = {
      index: activeTurn.index + 1,
      startedAt: endedAt,
      endedAt: null,
      playerSeat: nextSeat,
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    };
    game.turns.push(nextTurn);
    game.board.state = {
      ...game.board.state,
      sideToMove: getSideForSeat(nextSeat),
      turnIndex: nextTurn.index,
    };
    game.updatedAt = endedAt;
    game.notifications = [`Offline turn ended`, ...(game.notifications ?? [])].slice(0, 50);
    return nextTurn;
  };

  const flushOfflineQueue = async () => {
    const entries = [...offlinePendingByGameId.entries()];
    offlinePendingByGameId.clear();
    for (const [gameId, mutations] of entries) {
      for (const mutation of mutations) {
        if (mutation.type === "move") {
          const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/moves`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identityId, notation: mutation.notation }),
          });
          const body = await mustOk(response);
          upsertGame(body.game);
          continue;
        }
        if (mutation.type === "end-turn") {
          const response = await fetcher(`/api/shell/games/${encodeURIComponent(gameId)}/end-turn`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identityId }),
          });
          const body = await mustOk(response);
          upsertGame(body.game);
        }
      }
      await loadGame(gameId);
    }
  };

  const refreshGames = async () => {
    if (offline) {
      return listGames();
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games?identityId=${encodeURIComponent(identityId)}`), {
      method: "GET",
      cache: "no-store",
    });
    const body = await mustOk(response);
    syncCacheFromList(Array.isArray(body.games) ? body.games : []);
    return listGames();
  };

  const loadGame = async (gameId, { openAsViewer = false } = {}) => {
    if (offline) {
      return getGameViewModel(gameId);
    }
    const response = await fetcher(
      withOfflineQuery(
        `/api/shell/games/${encodeURIComponent(gameId)}?identityId=${encodeURIComponent(identityId)}${
          openAsViewer ? "&openAsViewer=1" : ""
        }`,
      ),
      {
        method: "GET",
        cache: "no-store",
      },
    );
    const body = await mustOk(response);
    return upsertGame(body.game);
  };

  const createGame = async ({ playgroundMode = false, offlineLocal = false } = {}) => {
    const response = await fetcher(withOfflineQuery("/api/shell/games"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, playgroundMode, offlineLocal }),
    });
    const body = await mustOk(response);
    return upsertGame(body.game);
  };

  const resolveInvite = async (inviteToken) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/invites/${encodeURIComponent(inviteToken)}`), {
      method: "GET",
      cache: "no-store",
    });
    return mustOk(response);
  };

  const joinGame = async ({ gameId, mode, inviteFromRole = null, inviteToken = null }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/join`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, mode, inviteFromRole, inviteToken }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const playAsBothPlayers = async ({ gameId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/play-as-both`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const approvePendingRequest = async ({ gameId, requesterIdentityId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/approve`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, requesterIdentityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const addMove = async ({ gameId, notation }) => {
    if (offline) {
      const game = getGameViewModel(gameId);
      if (!game) {
        throw new Error("game_not_found");
      }
      const next = clone(game);
      await applyOfflineMove(next, notation);
      queueOfflineMutation(gameId, { type: "move", notation });
      return { ok: true, game: upsertGame(next) };
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/moves`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, notation }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const loadGameLegalActions = async ({ gameId, state }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/legal`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, state }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGame(body.game);
    }
    return body;
  };

  const loadGamePieceMoves = async ({ gameId, state, pieceId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/piece-moves`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, state, pieceId }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGame(body.game);
    }
    return body;
  };

  const applyGameAction = async ({ gameId, state, action }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/apply`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, state, action }),
    });
    const body = await mustOk(response);
    if (body.game) {
      upsertGame(body.game);
    }
    return body;
  };

  const endTurn = async ({ gameId }) => {
    if (offline) {
      const game = getGameViewModel(gameId);
      if (!game) {
        throw new Error("game_not_found");
      }
      const next = clone(game);
      const turn = applyOfflineEndTurn(next);
      queueOfflineMutation(gameId, { type: "end-turn" });
      return { ok: true, turn, game: upsertGame(next) };
    }
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/end-turn`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const selectHistoryMove = async ({ gameId, moveIndex }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/history`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, moveIndex }),
    });
    const body = await mustOk(response);
    return upsertGame(body.game);
  };

  const returnToLive = async ({ gameId }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/live`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId }),
    });
    const body = await mustOk(response);
    return upsertGame(body.game);
  };

  const setParticipantConnected = async ({ gameId, role, connected }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/presence`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, role, connected }),
    });
    const body = await mustOk(response);
    return upsertGame(body.game);
  };

  const goOnlineGame = async ({ gameId, confirmed }) => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/go-online`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, confirmed }),
    });
    const body = await mustOk(response);
    return upsertGame(body.game);
  };

  const listGames = () => games.map((game) => applyClientOfflineViewState(game));
  const getGameViewModel = (gameId) => {
    const game = gameById.get(gameId);
    return game ? applyClientOfflineViewState(game) : null;
  };

  const setOffline = (value) => {
    const previous = offline;
    offline = value;
    if (previous && !offline) {
      return flushOfflineQueue();
    }
    return Promise.resolve();
  };

  const getIdentityId = () => identityId;

  return {
    refreshGames,
    loadGame,
    resolveInvite,
    createGame,
    joinGame,
    playAsBothPlayers,
    approvePendingRequest,
    addMove,
    loadGameLegalActions,
    loadGamePieceMoves,
    applyGameAction,
    endTurn,
    selectHistoryMove,
    returnToLive,
    setParticipantConnected,
    goOnlineGame,
    listGames,
    getGameViewModel,
    setOffline,
    getIdentityId,
  };
};
