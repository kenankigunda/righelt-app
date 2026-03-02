import { loadIdentity, saveIdentity } from "./persistence.js";

const clone = (value) => structuredClone(value);

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

  const withOfflineQuery = (path) => `${path}${path.includes("?") ? "&" : "?"}offline=${offline ? "1" : "0"}`;

  const syncCacheFromList = (nextGames) => {
    games = clone(nextGames);
    gameById = new Map(games.map((game) => [game.id, game]));
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

  const refreshGames = async () => {
    const response = await fetcher(withOfflineQuery(`/api/shell/games?identityId=${encodeURIComponent(identityId)}`), {
      method: "GET",
      cache: "no-store",
    });
    const body = await mustOk(response);
    syncCacheFromList(Array.isArray(body.games) ? body.games : []);
    return listGames();
  };

  const loadGame = async (gameId, { openAsViewer = false } = {}) => {
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
    const response = await fetcher(withOfflineQuery(`/api/shell/games/${encodeURIComponent(gameId)}/moves`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identityId, notation }),
    });
    const body = await mustOk(response);
    return { ...body, game: upsertGame(body.game) };
  };

  const endTurn = async ({ gameId }) => {
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

  const listGames = () => clone(games);
  const getGameViewModel = (gameId) => {
    const game = gameById.get(gameId);
    return game ? clone(game) : null;
  };

  const setOffline = (value) => {
    offline = value;
  };

  const getIdentityId = () => identityId;

  return {
    refreshGames,
    loadGame,
    resolveInvite,
    createGame,
    joinGame,
    approvePendingRequest,
    addMove,
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
