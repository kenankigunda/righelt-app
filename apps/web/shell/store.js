import {
  loadIdentity,
  loadShellState,
  loadTutorialCompleted,
  saveIdentity,
  saveShellState,
  saveTutorialCompleted,
} from "./persistence.js";

const MAX_HISTORY = 200;

const createId = (prefix, random) => `${prefix}-${random().toString(36).slice(2, 10)}`;

const clone = (value) => structuredClone(value);

const byLatestActivityDesc = (left, right) => {
  const leftTs = left.lastMoveAt || left.createdAt;
  const rightTs = right.lastMoveAt || right.createdAt;
  return rightTs.localeCompare(leftTs);
};

const findRoleForIdentity = (game, identityId) => {
  if (game.player1?.identityId === identityId) return "Player 1";
  if (game.player2?.identityId === identityId) return "Player 2";
  if (game.viewers.some((viewer) => viewer.identityId === identityId)) return "Viewer";
  return "Guest";
};

const ensureViewer = (game, identityId) => {
  if (game.viewers.some((viewer) => viewer.identityId === identityId)) {
    return;
  }
  game.viewers.push({ identityId, connected: true, joinedAt: new Date().toISOString() });
};

const isSeatRequestEligible = (game, seat) => {
  if (seat === "Player 2" && !game.player2) {
    return true;
  }
  if (seat === "Player 1" && !game.player1) {
    return true;
  }
  return false;
};

const getSeatForSide = (side) => (side === "P1" ? "Player 1" : "Player 2");
const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");
const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");
const getActiveTurn = (game) => game.turns[game.turns.length - 1] || null;

export const createShellStore = ({
  storage,
  now = () => new Date().toISOString(),
  random = Math.random,
  loadBoardState,
  saveWarning = () => {},
}) => {
  let identityId = loadIdentity(storage);
  if (!identityId) {
    identityId = createId("id", random);
    saveIdentity(storage, identityId);
  }

  let tutorialCompleted = loadTutorialCompleted(storage);
  const persisted = loadShellState(storage);
  let games = Array.isArray(persisted.games) ? persisted.games : [];
  let offline = false;

  const persist = () => {
    try {
      saveShellState(storage, { games });
    } catch {
      saveWarning("offline_progress_may_be_lost");
    }
  };

  const getGame = (gameId) => games.find((candidate) => candidate.id === gameId) || null;

  const createGame = async ({ playgroundMode = false, offlineLocal = false } = {}) => {
    const timestamp = now();
    const board = await loadBoardState();
    const game = {
      id: createId("game", random),
      createdAt: timestamp,
      lastMoveAt: null,
      updatedAt: timestamp,
      playgroundMode,
      offlineLocal,
      board,
      player1: { identityId, connected: true, joinedAt: timestamp },
      player2: playgroundMode ? { identityId, connected: true, joinedAt: timestamp } : null,
      viewers: [],
      pendingJoinRequests: [],
      turns: [
        {
          index: board.state.turnIndex ?? 0,
          startedAt: timestamp,
          endedAt: null,
          playerSeat: getSeatForSide(board.state.sideToMove),
          status: "active",
          moveIndexes: [],
          lastMoveAt: null,
        },
      ],
      moves: [],
      historyIndex: null,
      notifications: ["Game created", playgroundMode ? "Playground mode active" : "Invite a second player"],
    };
    games = [game, ...games].sort(byLatestActivityDesc);
    persist();
    return clone(game);
  };

  const setOffline = (value) => {
    offline = value;
  };

  const listGames = () => clone(games.filter((game) => !game.offlineLocal)).sort(byLatestActivityDesc);

  const openAsViewer = (gameId) => {
    const game = getGame(gameId);
    if (!game) return null;
    ensureViewer(game, identityId);
    game.updatedAt = now();
    persist();
    return clone(game);
  };

  const joinGame = ({ gameId, mode, inviteFromRole = null }) => {
    const game = getGame(gameId);
    if (!game) {
      return { ok: false, error: "game_not_found" };
    }

    if (offline && !game.offlineLocal) {
      return { ok: false, error: "offline_join_blocked" };
    }

    if (mode === "viewer") {
      ensureViewer(game, identityId);
      game.notifications.unshift("Viewer joined");
      game.updatedAt = now();
      persist();
      return { ok: true, role: "Viewer", game: clone(game) };
    }

    if (game.playgroundMode) {
      return { ok: false, error: "playground_player_join_disabled" };
    }

    const requestedSeat = !game.player1
      ? "Player 1"
      : !game.player2
        ? "Player 2"
        : null;

    if (!requestedSeat || !isSeatRequestEligible(game, requestedSeat)) {
      return { ok: false, error: "no_player_seat_available" };
    }

    const sharedByPlayer = inviteFromRole === "Player 1" || inviteFromRole === "Player 2";
    if (!sharedByPlayer) {
      ensureViewer(game, identityId);
      game.pendingJoinRequests.push({
        identityId,
        requestedSeat,
        requestedAt: now(),
        source: inviteFromRole ? "viewer_invite" : "home_list",
      });
      game.notifications.unshift("Player seat request pending approval");
      game.updatedAt = now();
      persist();
      return { ok: true, role: "Viewer", pendingApproval: true, game: clone(game) };
    }

    if (requestedSeat === "Player 1") {
      game.player1 = { identityId, connected: true, joinedAt: now() };
    } else {
      game.player2 = { identityId, connected: true, joinedAt: now() };
    }
    game.notifications.unshift("Player joined");
    game.updatedAt = now();
    persist();
    return { ok: true, role: requestedSeat, game: clone(game) };
  };

  const playAsBothPlayers = ({ gameId }) => {
    const game = getGame(gameId);
    if (!game) {
      return { ok: false, error: "game_not_found" };
    }
    if (game.player1?.identityId !== identityId) {
      return { ok: false, error: "not_player1" };
    }
    if (game.player2) {
      return { ok: false, error: "player2_already_joined" };
    }

    game.player2 = { identityId, connected: true, joinedAt: now() };
    game.playgroundMode = true;
    game.pendingJoinRequests = game.pendingJoinRequests.filter((request) => request.requestedSeat !== "Player 2");
    game.notifications.unshift("Play as both players enabled");
    game.updatedAt = now();
    persist();
    return { ok: true, game: clone(game) };
  };

  const approvePendingRequest = ({ gameId, requesterIdentityId }) => {
    const game = getGame(gameId);
    if (!game) return { ok: false, error: "game_not_found" };

    const requester = game.pendingJoinRequests.find((item) => item.identityId === requesterIdentityId);
    if (!requester) {
      return { ok: false, error: "request_not_found" };
    }

    game.pendingJoinRequests = game.pendingJoinRequests.filter((item) => item.identityId !== requesterIdentityId);

    if (requester.requestedSeat === "Player 1" && !game.player1) {
      game.player1 = { identityId: requester.identityId, connected: true, joinedAt: now() };
    }
    if (requester.requestedSeat === "Player 2" && !game.player2) {
      game.player2 = { identityId: requester.identityId, connected: true, joinedAt: now() };
    }

    game.notifications.unshift("Player request approved");
    game.updatedAt = now();
    persist();
    return { ok: true, game: clone(game) };
  };

  const setParticipantConnected = ({ gameId, role, connected }) => {
    const game = getGame(gameId);
    if (!game) return null;
    const entry = role === "Player 1" ? game.player1 : role === "Player 2" ? game.player2 : null;
    if (!entry) return null;
    entry.connected = connected;
    game.notifications.unshift(`Participant ${connected ? "connected" : "disconnected"}`);
    game.updatedAt = now();
    persist();
    return clone(game);
  };

  const addMove = ({ gameId, notation, snapshot }) => {
    const game = getGame(gameId);
    if (!game) return null;
    const activeTurn = getActiveTurn(game);
    if (!activeTurn) return null;

    const move = {
      index: game.moves.length,
      turnIndex: activeTurn.index,
      turnMoveIndex: activeTurn.moveIndexes.length,
      at: now(),
      notation,
      snapshot: {
        ...(snapshot || game.board.state),
        sideToMove: getSideForSeat(activeTurn.playerSeat),
        turnIndex: activeTurn.index,
      },
    };
    game.moves.push(move);
    activeTurn.moveIndexes.push(move.index);
    activeTurn.lastMoveAt = move.at;
    if (game.moves.length > MAX_HISTORY) {
      game.moves.shift();
      for (let i = 0; i < game.moves.length; i += 1) {
        game.moves[i].index = i;
      }
      game.turns.forEach((turn) => {
        turn.moveIndexes = turn.moveIndexes.map((_, index) => {
          const moveAtIndex = game.moves.find((move) => move.turnIndex === turn.index && move.turnMoveIndex === index);
          return moveAtIndex ? moveAtIndex.index : -1;
        }).filter((index) => index >= 0);
      });
    }

    game.board.state = structuredClone(move.snapshot);
    game.lastMoveAt = move.at;
    game.updatedAt = move.at;
    game.notifications.unshift(`Move recorded in turn ${activeTurn.index + 1}`);
    persist();
    return clone(game);
  };

  const endTurn = ({ gameId }) => {
    const game = getGame(gameId);
    if (!game) return null;
    const activeTurn = getActiveTurn(game);
    if (!activeTurn || activeTurn.moveIndexes.length === 0) {
      return { ok: false, error: "turn_has_no_moves" };
    }

    const endedAt = now();
    activeTurn.endedAt = endedAt;
    activeTurn.status = "complete";

    const nextSeat = getNextSeat(activeTurn.playerSeat);
    game.turns.push({
      index: activeTurn.index + 1,
      startedAt: endedAt,
      endedAt: null,
      playerSeat: nextSeat,
      status: "active",
      moveIndexes: [],
      lastMoveAt: null,
    });
    game.board.state = {
      ...game.board.state,
      sideToMove: getSideForSeat(nextSeat),
      turnIndex: activeTurn.index + 1,
    };
    game.updatedAt = endedAt;
    game.notifications.unshift(`Turn ${activeTurn.index + 1} ended. ${nextSeat} to play`);
    persist();
    return clone(game);
  };

  const selectHistoryMove = ({ gameId, moveIndex }) => {
    const game = getGame(gameId);
    if (!game) return null;
    if (moveIndex < 0 || moveIndex >= game.moves.length) {
      return null;
    }
    game.historyIndex = moveIndex;
    game.notifications.unshift("Viewing history (not live)");
    game.updatedAt = now();
    persist();
    return clone(game);
  };

  const returnToLive = ({ gameId }) => {
    const game = getGame(gameId);
    if (!game) return null;
    game.historyIndex = null;
    game.updatedAt = now();
    persist();
    return clone(game);
  };

  const goOnlineGame = ({ gameId, confirmed }) => {
    const game = getGame(gameId);
    if (!game) return { ok: false, error: "game_not_found" };
    if (!confirmed) return { ok: false, error: "confirmation_required" };
    game.offlineLocal = false;
    game.updatedAt = now();
    game.notifications.unshift("Game moved online");
    persist();
    return { ok: true, game: clone(game) };
  };

  const markTutorialCompleted = () => {
    tutorialCompleted = true;
    saveTutorialCompleted(storage, true);
  };

  const getTutorialCompleted = () => tutorialCompleted;

  const getGameViewModel = (gameId) => {
    const game = getGame(gameId);
    if (!game) return null;

    const role = findRoleForIdentity(game, identityId);
    return {
      ...clone(game),
      myRole: role,
      inHistoryMode: typeof game.historyIndex === "number",
      currentSnapshot:
        typeof game.historyIndex === "number" && game.moves[game.historyIndex]
          ? game.moves[game.historyIndex].snapshot
          : game.board.state,
      currentTurn: clone(getActiveTurn(game)),
      canJoinAsPlayer:
        role !== "Player 1" && role !== "Player 2" && !game.playgroundMode && (!game.player1 || !game.player2),
      canPlayAsBothPlayers: role === "Player 1" && !game.player2,
      canInvite: !offline && !game.offlineLocal,
      showOfflineState: offline || game.offlineLocal,
      showJoinActions: !offline && !game.offlineLocal,
      canEndTurn:
        (role === "Player 1" || role === "Player 2") &&
        typeof game.historyIndex !== "number" &&
        getActiveTurn(game)?.playerSeat === role &&
        getActiveTurn(game)?.moveIndexes.length > 0,
    };
  };

  const getIdentityId = () => identityId;

  return {
    createGame,
    joinGame,
    playAsBothPlayers,
    openAsViewer,
    approvePendingRequest,
    addMove,
    endTurn,
    selectHistoryMove,
    returnToLive,
    setParticipantConnected,
    goOnlineGame,
    setOffline,
    listGames,
    getGameViewModel,
    getTutorialCompleted,
    markTutorialCompleted,
    getIdentityId,
  };
};
