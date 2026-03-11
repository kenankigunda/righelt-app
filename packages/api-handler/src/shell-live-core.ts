import { applyAction } from "../../game-engine/src/apply";
import { listLegalActions, validateAction } from "../../game-engine/src/legal";
import { resolveToStability } from "../../game-engine/src/resolve";
import { createInitialState } from "../../game-engine/src/state";
import type { Action, GameState } from "../../game-engine/src/types";

export const MAX_HISTORY = 200;
const BOARD_SIZE = 10;

export type Participant = {
  identityId: string;
  connected: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
  sessionCount: number;
};

export type Viewer = Participant;

export type JoinRequest = {
  identityId: string;
  requestedSeat: "Player 1" | "Player 2";
  requestedAt: string;
  source: "viewer_invite" | "home_list";
  status?: "pending" | "accepted" | "rejected";
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

export type MoveEntry = {
  index: number;
  turnIndex: number;
  turnMoveIndex: number;
  actorSide: "P1" | "P2";
  at: string;
  notation: string;
  action: Action;
  selectionSnapshot: GameState;
  snapshot: GameState;
};

export type TurnEntry = {
  index: number;
  startedAt: string;
  endedAt: string | null;
  playerSeat: "Player 1" | "Player 2";
  status: "active" | "complete";
  moveIndexes: number[];
  lastMoveAt: string | null;
};

export type ShellGame = {
  id: string;
  createdAt: string;
  lastMoveAt: string | null;
  updatedAt: string;
  playgroundMode: boolean;
  offlineLocal: boolean;
  board: {
    state: GameState;
  };
  player1: Participant | null;
  player2: Participant | null;
  viewers: Viewer[];
  pendingJoinRequests: JoinRequest[];
  turns: TurnEntry[];
  moves: MoveEntry[];
  historyIndexByIdentity: Record<string, number>;
  notifications: string[];
  inviteTokens: {
    viewer: string;
    player1: string;
    player2: string;
  };
};

export type RemovedPieceNotice = {
  pieceId: string;
  position: { row: number; col: number };
  reason: "loss_of_supply" | "no_retreat";
  message: string;
};

export type PieceMovePreview = Action & {
  legal: boolean;
  blockedReason?: "SUPPLY_DESTINATION_UNSUPPLIED" | "PUSH_STRENGTH_TOO_WEAK";
};

export const clone = <T>(value: T): T => structuredClone(value);
export const now = () => new Date(Date.now()).toISOString();

export const createInviteToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

export const nextGameId = () => `game-${createInviteToken()}`;

export const getSeatForSide = (side: GameState["sideToMove"]): "Player 1" | "Player 2" => (side === "P1" ? "Player 1" : "Player 2");
export const getNextSeat = (seat: "Player 1" | "Player 2"): "Player 1" | "Player 2" => (seat === "Player 1" ? "Player 2" : "Player 1");
export const getSideForSeat = (seat: "Player 1" | "Player 2"): GameState["sideToMove"] => (seat === "Player 1" ? "P1" : "P2");
export const getSideToMoveSeat = (game: ShellGame): "Player 1" | "Player 2" =>
  game.board.state.sideToMove === "P1" ? "Player 1" : "Player 2";
export const getActiveTurn = (game: ShellGame): TurnEntry | null => game.turns[game.turns.length - 1] ?? null;

export const asIdentity = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
export const asGameState = (value: unknown): GameState | null =>
  value && typeof value === "object" ? (value as GameState) : null;
export const asAction = (value: unknown): Action | null =>
  value && typeof value === "object" && typeof (value as Action).type === "string" ? (value as Action) : null;

export const addNotification = (game: ShellGame, message: string) => {
  game.notifications.unshift(message);
  if (game.notifications.length > 50) {
    game.notifications = game.notifications.slice(0, 50);
  }
};

export const createInitialGame = ({
  gameId,
  identityId,
  playgroundMode,
  offlineLocal,
}: {
  gameId: string;
  identityId: string;
  playgroundMode: boolean;
  offlineLocal: boolean;
}): ShellGame => {
  const initial = resolveToStability(createInitialState(), { artifactMode: "full" });
  const createdAt = now();
  return {
    id: gameId,
    createdAt,
    lastMoveAt: null,
    updatedAt: createdAt,
    playgroundMode,
    offlineLocal,
    board: { state: initial },
    player1: {
      identityId,
      connected: true,
      joinedAt: createdAt,
      lastHeartbeatAt: createdAt,
      sessionCount: 0,
    },
    player2: playgroundMode
      ? {
          identityId,
          connected: true,
          joinedAt: createdAt,
          lastHeartbeatAt: createdAt,
          sessionCount: 0,
        }
      : null,
    viewers: [],
    pendingJoinRequests: [],
    turns: [
      {
        index: initial.turnIndex ?? 0,
        startedAt: createdAt,
        endedAt: null,
        playerSeat: getSeatForSide(initial.sideToMove),
        status: "active",
        moveIndexes: [],
        lastMoveAt: null,
      },
    ],
    moves: [],
    historyIndexByIdentity: {},
    notifications: ["Game created", playgroundMode ? "Playground mode active" : "Invite a second player"],
    inviteTokens: {
      viewer: createInviteToken(),
      player1: createInviteToken(),
      player2: createInviteToken(),
    },
  };
};

export const findRoleForIdentity = (game: ShellGame, identityId: string): "Player 1" | "Player 2" | "Viewer" | "Guest" => {
  if (game.player1?.identityId === identityId) return "Player 1";
  if (game.player2?.identityId === identityId) return "Player 2";
  if (game.viewers.some((viewer) => viewer.identityId === identityId)) return "Viewer";
  return "Guest";
};

export const getSeatIdentity = (game: ShellGame, seat: "Player 1" | "Player 2"): string | null =>
  seat === "Player 1" ? game.player1?.identityId ?? null : game.player2?.identityId ?? null;

export const getApproverIdentityForSeat = (game: ShellGame, seat: "Player 1" | "Player 2"): string | null =>
  seat === "Player 1" ? game.player2?.identityId ?? null : game.player1?.identityId ?? null;

export const getControlSeatForTurn = (
  state: GameState,
  turnOwnerSeat: "Player 1" | "Player 2",
): "Player 1" | "Player 2" => {
  const continuation = state.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};

export const ensureViewer = (game: ShellGame, identityId: string, sessionCount = 0) => {
  const existing = game.viewers.find((viewer) => viewer.identityId === identityId);
  if (existing) {
    existing.connected = sessionCount > 0 || existing.connected;
    if (sessionCount > 0) {
      existing.sessionCount = sessionCount;
      existing.lastHeartbeatAt = now();
    }
    return false;
  }
  const joinedAt = now();
  game.viewers.push({
    identityId,
    connected: sessionCount > 0,
    joinedAt,
    lastHeartbeatAt: joinedAt,
    sessionCount,
  });
  return true;
};

export const removeViewer = (game: ShellGame, identityId: string) => {
  game.viewers = game.viewers.filter((viewer) => viewer.identityId !== identityId);
};

export const promoteIdentityToSeat = (
  game: ShellGame,
  seat: "Player 1" | "Player 2",
  identityId: string,
  sessionCount = 0,
) => {
  const existingViewer = game.viewers.find((viewer) => viewer.identityId === identityId) ?? null;
  const joinedAt = existingViewer?.joinedAt ?? now();
  const lastHeartbeatAt = existingViewer?.lastHeartbeatAt ?? joinedAt;
  removeViewer(game, identityId);
  const participant: Participant = {
    identityId,
    connected: sessionCount > 0,
    joinedAt,
    lastHeartbeatAt,
    sessionCount,
  };
  if (seat === "Player 1") {
    game.player1 = participant;
  } else {
    game.player2 = participant;
  }
};

export const dismissCompetingJoinRequests = (game: ShellGame, acceptedIdentityId: string) => {
  game.pendingJoinRequests = game.pendingJoinRequests.filter((request) => request.identityId === acceptedIdentityId);
};

const canOperateOfflinePlaygroundTurn = (game: ShellGame, identityId: string) =>
  game.offlineLocal &&
  game.playgroundMode &&
  game.player1?.identityId === identityId &&
  game.player2?.identityId === identityId;

const getJoinAsPlayerDisabledReason = (game: ShellGame, offline: boolean, myRole: string) => {
  if (myRole === "Player 1" || myRole === "Player 2") {
    return "You are already joined as a player.";
  }
  if (offline || game.offlineLocal) {
    return "Remote joining is unavailable while offline.";
  }
  if (game.playgroundMode) {
    return "Playground mode does not accept remote player joins.";
  }
  if (game.player1 && game.player2) {
    return "Game already has the maximum number of players.";
  }
  return null;
};

const getJoinAsViewerDisabledReason = (game: ShellGame, offline: boolean, myRole: string) => {
  if (myRole === "Viewer") {
    return "You are already joined as a viewer.";
  }
  if (myRole === "Player 1" || myRole === "Player 2") {
    return "You are already in this game.";
  }
  if (offline || game.offlineLocal) {
    return "Remote joining is unavailable while offline.";
  }
  return null;
};

export const withViewModel = (game: ShellGame, identityId: string, offline = false) => {
  const myRole = findRoleForIdentity(game, identityId);
  const historyIndex = typeof game.historyIndexByIdentity[identityId] === "number" ? game.historyIndexByIdentity[identityId] : null;
  const inHistoryMode = typeof historyIndex === "number";
  const currentSnapshot =
    typeof historyIndex === "number" && game.moves[historyIndex]
      ? game.moves[historyIndex].selectionSnapshot
      : game.board.state;
  const historySelectionAction =
    typeof historyIndex === "number" && game.moves[historyIndex]
      ? clone(game.moves[historyIndex].action)
      : null;
  const activeTurn = getActiveTurn(game);
  const turnOwnerSeat = activeTurn?.playerSeat ?? getSideToMoveSeat(game);
  const controlSeat = getControlSeatForTurn(game.board.state, turnOwnerSeat);
  const sideToMoveIdentity = getSeatIdentity(game, controlSeat);
  const turnOwnerIdentity = getSeatIdentity(game, turnOwnerSeat);
  const isPlayer = myRole === "Player 1" || myRole === "Player 2";
  const legalNow = listLegalActions(game.board.state);
  const offlineTurnControlAllowed = !offline || canOperateOfflinePlaygroundTurn(game, identityId);
  const approvableRequesterIds = game.pendingJoinRequests
    .filter((request) => getApproverIdentityForSeat(game, request.requestedSeat) === identityId)
    .map((request) => request.identityId);
  const myPendingJoinRequest = game.pendingJoinRequests.find((request) => request.identityId === identityId) ?? null;
  const joinAsPlayerDisabledReason = getJoinAsPlayerDisabledReason(game, offline, myRole);
  const joinAsViewerDisabledReason = getJoinAsViewerDisabledReason(game, offline, myRole);

  return {
    ...clone(game),
    historyIndexByIdentity: undefined,
    historyIndex,
    myRole,
    inHistoryMode,
    currentSnapshot,
    canJoinAsPlayer: !joinAsPlayerDisabledReason,
    canJoinAsViewer: !joinAsViewerDisabledReason,
    canPlayAsBothPlayers: myRole === "Player 1" && !game.player2,
    joinAsPlayerDisabledReason,
    joinAsViewerDisabledReason,
    canInvite: !offline && !game.offlineLocal,
    inviteToken:
      myRole === "Player 1"
        ? game.inviteTokens.player1
        : myRole === "Player 2"
          ? game.inviteTokens.player2
          : game.inviteTokens.viewer,
    showOfflineState: offline || game.offlineLocal,
    showJoinActions: !offline && !game.offlineLocal,
    canRecordMove: isPlayer && !inHistoryMode && sideToMoveIdentity === identityId && legalNow.length > 0,
    legalActions: legalNow,
    canEndTurn:
      offlineTurnControlAllowed &&
      isPlayer &&
      !inHistoryMode &&
      turnOwnerIdentity === identityId &&
      Boolean(activeTurn && activeTurn.moveIndexes.length > 0),
    currentTurn: activeTurn ? clone(activeTurn) : null,
    historySelectionAction,
    turnOwnerSeat,
    controlSeat,
    control: controlSeat === turnOwnerSeat ? "turn-owner" : "opponent",
    pendingPlayerRequestSeat: myPendingJoinRequest?.requestedSeat ?? null,
    approvableRequesterIds,
  };
};

const formatCoordinate = (coord: { row: number; col: number } | null | undefined) =>
  coord ? `(${coord.row},${coord.col})` : "(?,?)";

const defaultNotationForAction = (action: Action) => {
  if (action.type === "pass") {
    return "PASS";
  }
  return `${action.type.toUpperCase()} ${formatCoordinate(action.from)} -> ${formatCoordinate(action.to)}`;
};

const collectRemovedPieceNotices = (
  before: GameState,
  afterApply: GameState,
  afterStability: GameState,
  action: Action,
): RemovedPieceNotice[] => {
  const afterApplyIds = new Set(afterApply.pieces.map((piece) => piece.id));
  const afterStableIds = new Set(afterStability.pieces.map((piece) => piece.id));
  const notices: RemovedPieceNotice[] = [];

  for (const piece of before.pieces) {
    if (!afterApplyIds.has(piece.id)) {
      const reason =
        piece.pushed || action.type === "push" || action.type === "retreat"
          ? "no_retreat"
          : "loss_of_supply";
      notices.push({
        pieceId: piece.id,
        position: { ...piece.position },
        reason,
        message:
          reason === "no_retreat"
            ? `Piece at (${piece.position.row}, ${piece.position.col}) destroyed because it could not retreat`
            : `Piece at (${piece.position.row}, ${piece.position.col}) destroyed due to loss of supply`,
      });
    }
  }

  for (const piece of afterApply.pieces) {
    if (!afterStableIds.has(piece.id)) {
      notices.push({
        pieceId: piece.id,
        position: { ...piece.position },
        reason: "loss_of_supply",
        message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed due to loss of supply`,
      });
    }
  }

  return notices;
};

const renumberHistory = (game: ShellGame) => {
  game.moves.forEach((move, index) => {
    move.index = index;
  });
  game.turns.forEach((turn) => {
    turn.moveIndexes = turn.moveIndexes
      .map((_, turnMoveIndex) =>
        game.moves.find((move) => move.turnIndex === turn.index && move.turnMoveIndex === turnMoveIndex)?.index ?? -1,
      )
      .filter((index) => index >= 0);
  });
};

const pickLegalAction = (state: GameState): Action | null => {
  const legal = listLegalActions(state);
  if (legal.length === 0) {
    return null;
  }
  return legal[0] as Action;
};

export const applyServerAction = (game: ShellGame, action: Action, notation?: string) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false as const, error: "turn_not_initialized" };
  }
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const validation = validateAction(stable, action);
  if (!validation.ok) {
    return { ok: false as const, error: validation.code || "invalid_action", validation, state: stable };
  }
  const applied = applyAction(stable, action);
  const next = resolveToStability(applied.state, { artifactMode: "full" });
  const removedPieces = collectRemovedPieceNotices(stable, applied.state, next, action);
  next.sideToMove = getSideForSeat(getControlSeatForTurn(next, activeTurn.playerSeat));
  next.turnIndex = activeTurn.index;

  const move: MoveEntry = {
    index: game.moves.length,
    turnIndex: activeTurn.index,
    turnMoveIndex: activeTurn.moveIndexes.length,
    actorSide: stable.sideToMove,
    at: now(),
    notation: notation || defaultNotationForAction(action),
    action: clone(action),
    selectionSnapshot: stable,
    snapshot: next,
  };
  game.moves.push(move);
  activeTurn.moveIndexes.push(move.index);
  activeTurn.lastMoveAt = move.at;
  if (game.moves.length > MAX_HISTORY) {
    game.moves.shift();
    renumberHistory(game);
  }
  game.board.state = next;
  game.lastMoveAt = move.at;
  game.updatedAt = move.at;
  addNotification(game, `Move recorded in turn ${activeTurn.index + 1}`);
  return { ok: true as const, move, state: next, removedPieces };
};

export const applyServerMove = (game: ShellGame, notation?: string) => {
  const stable = resolveToStability(game.board.state, { artifactMode: "full" });
  const action = pickLegalAction(stable);
  if (!action) {
    return { ok: false as const, error: "no_legal_actions" };
  }
  return applyServerAction(game, action, notation);
};

export const endServerTurn = (game: ShellGame) => {
  const activeTurn = getActiveTurn(game);
  if (!activeTurn) {
    return { ok: false as const, error: "turn_not_initialized" };
  }
  if (activeTurn.moveIndexes.length === 0) {
    return { ok: false as const, error: "turn_has_no_moves" };
  }
  const endedAt = now();
  activeTurn.endedAt = endedAt;
  activeTurn.status = "complete";
  const nextSeat = getNextSeat(activeTurn.playerSeat);
  const nextTurn: TurnEntry = {
    index: activeTurn.index + 1,
    startedAt: endedAt,
    endedAt: null,
    playerSeat: nextSeat,
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
  game.turns.push(nextTurn);
  game.board.state = resolveToStability(
    {
      ...game.board.state,
      sideToMove: getSideForSeat(nextSeat),
      turnIndex: nextTurn.index,
      continuation: null,
      pieces: game.board.state.pieces.map((piece) => ({
        ...piece,
        shifted: false,
        pushed: false,
      })),
    },
    { artifactMode: "full" },
  );
  game.updatedAt = endedAt;
  addNotification(game, `Turn ${activeTurn.index + 1} ended. ${nextSeat} to play`);
  return { ok: true as const, turn: clone(nextTurn) };
};

export const enumeratePieceActions = (state: GameState, pieceId: string): Action[] => {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return [];
  }
  const candidates: Action[] = [];
  const withTargets = ["move", "project", "rush", "push", "follow", "retreat"] as const;
  for (const type of withTargets) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const action: Action = {
          type,
          actorId: piece.id,
          from: { row: piece.position.row, col: piece.position.col },
          to: { row, col },
        };
        const validation = validateAction(state, action);
        if (validation.ok) {
          candidates.push(action);
        }
      }
    }
  }
  return candidates.sort(compareActions);
};

const compareActions = (left: Action, right: Action): number => {
  if (left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }
  if (!left.to && !right.to) {
    return 0;
  }
  if (!left.to) {
    return -1;
  }
  if (!right.to) {
    return 1;
  }
  if (left.to.row !== right.to.row) {
    return left.to.row - right.to.row;
  }
  return left.to.col - right.to.col;
};

const compareActionPreviews = (left: PieceMovePreview, right: PieceMovePreview): number => {
  const actionOrder = compareActions(left, right);
  if (actionOrder !== 0) {
    return actionOrder;
  }
  if (left.legal !== right.legal) {
    return left.legal ? -1 : 1;
  }
  return (left.blockedReason ?? "").localeCompare(right.blockedReason ?? "");
};

export const enumeratePieceActionPreviews = (state: GameState, pieceId: string): PieceMovePreview[] => {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece) {
    return [];
  }
  const previews: PieceMovePreview[] = [];
  const withTargets = ["move", "project", "rush", "push", "follow", "retreat"] as const;
  for (const type of withTargets) {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const action: Action = {
          type,
          actorId: piece.id,
          from: { row: piece.position.row, col: piece.position.col },
          to: { row, col },
        };
        const validation = validateAction(state, action);
        if (validation.ok) {
          previews.push({ ...action, legal: true });
          continue;
        }
        if (
          validation.code === "SUPPLY_DESTINATION_UNSUPPLIED" ||
          validation.code === "PUSH_STRENGTH_TOO_WEAK"
        ) {
          previews.push({ ...action, legal: false, blockedReason: validation.code });
        }
      }
    }
  }
  return previews.sort(compareActionPreviews);
};
