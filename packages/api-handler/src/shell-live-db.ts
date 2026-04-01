import type {
  EventAppendedEvent,
  JoinRequestCreatedEvent,
  JoinRequestResolvedEvent,
  PresenceChangedEvent,
  ServerEvent,
} from "../../shared-types/src/events";
import { applyAction } from "../../game-engine/src/apply";
import { resolveToStability } from "../../game-engine/src/resolve";
import type { Action, GameState } from "../../game-engine/src/types";
import {
  asAction,
  asGameState,
  createInviteToken,
  getNextSeat,
  getSeatForSide,
  getSideForSeat,
  now,
  type JoinRequest,
  type LiveGame,
  type Participant,
  type RevertRequest,
  type ScenarioSavedSelection,
  type TurnEntry,
  type Viewer,
} from "./shell-live-core";

const LIVE_GAMES_TABLE = "live_games";
const LIVE_INVITES_TABLE = "live_invites";
const LIVE_EVENTS_TABLE = "live_events";
const PERSISTED_GAME_FORMAT_VERSION = 1;
const MAX_PERSISTED_NOTIFICATIONS = 50;

type D1RunResult = {
  success: boolean;
  meta?: {
    last_row_id?: number;
  };
};

type D1Result<T> = {
  results?: T[];
};

export type D1Statement = {
  bind: (...args: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  run: () => Promise<D1RunResult>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1Statement;
};

export type LiveGameEnv = {
  DB: D1DatabaseLike;
};

export type PersistedGameMismatch = {
  field: string;
  expected: string;
  actualType: string;
  actualSummary: string;
  repair: string;
};

export type PersistedGameLoadContext = "single" | "list" | "event";

export type PersistedGameProjection =
  | { kind: "ok"; game: LiveGame; eventSeq: number }
  | { kind: "invalid"; gameId: string; eventSeq: number; mismatches: PersistedGameMismatch[] };

type PersistedGameRow = {
  game_id: string;
  created_at: string;
  updated_at: string;
  state_json: string;
  event_seq: number;
};

type PersistedInviteRow = {
  token: string;
  shared_by_role: "Viewer" | "Player 1" | "Player 2";
};

type PersistedEventRow = {
  payload_json: string;
};

type PersistedParticipant = {
  identityId: string;
  connected: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
  sessionCount: number;
};

type PersistedMoveEntry = {
  moveId: string;
  index: number;
  turnIndex: number;
  turnMoveIndex: number;
  displayMoveNumber: number;
  actorSide: "P1" | "P2";
  at: string;
  notation: string;
  action: Action;
  clientCommandId?: string | null;
  undone?: boolean;
  undoneAt?: string | null;
  undoneByIdentityId?: string | null;
};

type PersistedLiveGame = {
  formatVersion: number;
  id: string;
  createdAt: string;
  updatedAt: string;
  lastMoveAt: string | null;
  playgroundMode: boolean;
  offlineLocal: boolean;
  initialState: GameState;
  currentState: GameState;
  player1: PersistedParticipant | null;
  player2: PersistedParticipant | null;
  viewers: PersistedParticipant[];
  pendingJoinRequests: JoinRequest[];
  pendingRevertRequest: RevertRequest | null;
  turns: TurnEntry[];
  moves: PersistedMoveEntry[];
  historyIndexByIdentity: Record<string, number>;
  pendingScenarioSelection: ScenarioSavedSelection | null;
  notifications: string[];
  initialSelectionAction?: Action | null;
};

type PersistedEventBase = {
  type: ServerEvent["type"];
  eventSeq: number;
};

type PersistedEventAppended = PersistedEventBase & {
  type: "event_appended";
  reason: string;
  clientCommandId?: string | null;
  game: PersistedLiveGame;
};

type PersistedPresenceChanged = PersistedEventBase & {
  type: "presence_changed";
  identityId: string;
  role: "Player 1" | "Player 2" | "Viewer";
  roles?: Array<"Player 1" | "Player 2" | "Viewer">;
  connected: boolean;
  game: PersistedLiveGame;
};

type PersistedJoinRequestCreated = PersistedEventBase & {
  type: "join_request_created";
  requesterIdentityId: string;
  requestedSeat: "Player 1" | "Player 2";
  game: PersistedLiveGame;
};

type PersistedJoinRequestResolved = PersistedEventBase & {
  type: "join_request_resolved";
  requesterIdentityId: string;
  accepted: boolean;
  seat: "Player 1" | "Player 2" | null;
  game: PersistedLiveGame;
};

type PersistedServerEvent =
  | PersistedEventAppended
  | PersistedPresenceChanged
  | PersistedJoinRequestCreated
  | PersistedJoinRequestResolved;

type ShapeLogPayload = {
  event: "live_game_shape_invalid";
  gameId: string;
  context: PersistedGameLoadContext;
  mismatches: PersistedGameMismatch[];
};

const getActualType = (value: unknown) => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
};

const getActualSummary = (value: unknown) => {
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object(keys=${keys.slice(0, 5).join(",")}${keys.length > 5 ? ",..." : ""})`;
  }
  if (typeof value === "string") {
    return value.length > 48 ? `${value.slice(0, 48)}...` : value;
  }
  return String(value);
};

const recordMismatch = (
  mismatches: PersistedGameMismatch[],
  field: string,
  expected: string,
  actual: unknown,
  repair: string,
) => {
  mismatches.push({
    field,
    expected,
    actualType: getActualType(actual),
    actualSummary: getActualSummary(actual),
    repair,
  });
};

const buildShapeLogPayload = ({
  gameId,
  context,
  mismatches,
}: {
  gameId: string;
  context: PersistedGameLoadContext;
  mismatches: PersistedGameMismatch[];
}): ShapeLogPayload => ({
  event: "live_game_shape_invalid",
  gameId,
  context,
  mismatches,
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

const toMinimalState = (state: GameState): GameState => resolveToStability(clone(state), { artifactMode: "minimal" });
const toHydratedState = (state: GameState): GameState => resolveToStability(clone(state), { artifactMode: "full" });

const toPersistedParticipant = (participant: Participant | null): PersistedParticipant | null =>
  participant
    ? {
        identityId: participant.identityId,
        connected: participant.connected,
        joinedAt: participant.joinedAt,
        lastHeartbeatAt: participant.lastHeartbeatAt,
        sessionCount: participant.sessionCount,
      }
    : null;

const fromPersistedParticipant = (value: unknown, field: string, mismatches: PersistedGameMismatch[]): Participant | null => {
  if (value == null) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.identityId !== "string" ||
    typeof value.connected !== "boolean" ||
    typeof value.joinedAt !== "string" ||
    typeof value.lastHeartbeatAt !== "string" ||
    typeof value.sessionCount !== "number"
  ) {
    recordMismatch(mismatches, field, "persisted participant", value, "rejected_invalid_projection");
    return null;
  }
  return {
    identityId: value.identityId,
    connected: value.connected,
    joinedAt: value.joinedAt,
    lastHeartbeatAt: value.lastHeartbeatAt,
    sessionCount: value.sessionCount,
  };
};

const fromPersistedParticipants = (value: unknown, field: string, mismatches: PersistedGameMismatch[]): Viewer[] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, field, "participant[]", value, "rejected_invalid_projection");
    return [];
  }
  return value.flatMap((entry, index) => {
    const participant = fromPersistedParticipant(entry, `${field}[${index}]`, mismatches);
    return participant ? [participant] : [];
  });
};

const fromPersistedJoinRequests = (value: unknown, mismatches: PersistedGameMismatch[]): JoinRequest[] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, "pendingJoinRequests", "join_request[]", value, "rejected_invalid_projection");
    return [];
  }
  return value.flatMap((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.identityId !== "string" ||
      (entry.requestedSeat !== "Player 1" && entry.requestedSeat !== "Player 2") ||
      typeof entry.requestedAt !== "string" ||
      (entry.source !== "viewer_invite" && entry.source !== "home_list")
    ) {
      recordMismatch(mismatches, `pendingJoinRequests[${index}]`, "join_request", entry, "rejected_invalid_projection");
      return [];
    }
    return [{
      identityId: entry.identityId,
      requestedSeat: entry.requestedSeat,
      requestedAt: entry.requestedAt,
      source: entry.source,
      status:
        entry.status === "pending" || entry.status === "accepted" || entry.status === "rejected"
          ? entry.status
          : undefined,
      resolvedAt: typeof entry.resolvedAt === "string" || entry.resolvedAt === null ? entry.resolvedAt : null,
      resolvedBy: typeof entry.resolvedBy === "string" || entry.resolvedBy === null ? entry.resolvedBy : null,
    }];
  });
};

const fromPersistedTurns = (value: unknown, mismatches: PersistedGameMismatch[]): TurnEntry[] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, "turns", "turn[]", value, "rejected_invalid_projection");
    return [];
  }
  return value.flatMap((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.index !== "number" ||
      typeof entry.startedAt !== "string" ||
      (typeof entry.endedAt !== "string" && entry.endedAt !== null) ||
      (entry.playerSeat !== "Player 1" && entry.playerSeat !== "Player 2") ||
      (entry.status !== "active" && entry.status !== "complete") ||
      !Array.isArray(entry.moveIndexes) ||
      (typeof entry.lastMoveAt !== "string" && entry.lastMoveAt !== null)
    ) {
      recordMismatch(mismatches, `turns[${index}]`, "turn", entry, "rejected_invalid_projection");
      return [];
    }
    return [{
      index: entry.index,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      playerSeat: entry.playerSeat,
      status: entry.status,
      moveIndexes: entry.moveIndexes.filter((moveIndex) => typeof moveIndex === "number"),
      lastMoveAt: entry.lastMoveAt,
    }];
  });
};

const toPersistedMove = (move: LiveGame["moves"][number]): PersistedMoveEntry => ({
  moveId: move.moveId,
  index: move.index,
  turnIndex: move.turnIndex,
  turnMoveIndex: move.turnMoveIndex,
  displayMoveNumber: move.displayMoveNumber,
  actorSide: move.actorSide,
  at: move.at,
  notation: move.notation,
  action: clone(move.action),
  clientCommandId: move.clientCommandId ?? null,
  undone: move.undone === true,
  undoneAt: move.undoneAt ?? null,
  undoneByIdentityId: move.undoneByIdentityId ?? null,
});

const fromPersistedMoveEntries = (value: unknown, mismatches: PersistedGameMismatch[]): PersistedMoveEntry[] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, "moves", "persisted_move[]", value, "rejected_invalid_projection");
    return [];
  }
  return value.flatMap((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.moveId !== "string" ||
      typeof entry.index !== "number" ||
      typeof entry.turnIndex !== "number" ||
      typeof entry.turnMoveIndex !== "number" ||
      typeof entry.displayMoveNumber !== "number" ||
      (entry.actorSide !== "P1" && entry.actorSide !== "P2") ||
      typeof entry.at !== "string" ||
      typeof entry.notation !== "string"
    ) {
      recordMismatch(mismatches, `moves[${index}]`, "persisted move", entry, "rejected_invalid_projection");
      return [];
    }
    const action = asAction(entry.action);
    if (!action) {
      recordMismatch(mismatches, `moves[${index}].action`, "Action", entry.action, "rejected_invalid_projection");
      return [];
    }
    return [{
      moveId: entry.moveId,
      index: entry.index,
      turnIndex: entry.turnIndex,
      turnMoveIndex: entry.turnMoveIndex,
      displayMoveNumber: entry.displayMoveNumber,
      actorSide: entry.actorSide,
      at: entry.at,
      notation: entry.notation,
      action,
      clientCommandId: typeof entry.clientCommandId === "string" || entry.clientCommandId === null ? entry.clientCommandId : null,
      undone: entry.undone === true,
      undoneAt: typeof entry.undoneAt === "string" || entry.undoneAt === null ? entry.undoneAt : null,
      undoneByIdentityId:
        typeof entry.undoneByIdentityId === "string" || entry.undoneByIdentityId === null ? entry.undoneByIdentityId : null,
    }];
  });
};

const getControlSeatForTurn = (state: GameState, turnOwnerSeat: "Player 1" | "Player 2") => {
  const continuation = state?.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};

const inferTurnOwnerSeat = (selectionSnapshot: GameState): "Player 1" | "Player 2" => {
  const controlSeat = getSeatForSide(selectionSnapshot.sideToMove);
  const continuation = selectionSnapshot?.continuation;
  if (continuation?.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(controlSeat);
  }
  return controlSeat;
};

const rehydrateMoveHistory = (persistedMoves: PersistedMoveEntry[], initialState: GameState): LiveGame["moves"] => {
  let replayState = toHydratedState(initialState);
  const turnOwnerSeatByIndex = new Map<number, "Player 1" | "Player 2">();

  return persistedMoves.map((move) => {
    const selectionSnapshot = clone(replayState);
    const turnOwnerSeat = turnOwnerSeatByIndex.get(move.turnIndex) ?? inferTurnOwnerSeat(selectionSnapshot);
    turnOwnerSeatByIndex.set(move.turnIndex, turnOwnerSeat);

    const applied = resolveToStability(applyAction(clone(selectionSnapshot), clone(move.action)).state, { artifactMode: "full" });
    applied.sideToMove = getSideForSeat(getControlSeatForTurn(applied, turnOwnerSeat));
    applied.turnIndex = move.turnIndex;

    const snapshot = clone(applied);
    if (snapshot.continuation == null) {
      const nextSeat = getNextSeat(turnOwnerSeat);
      snapshot.sideToMove = getSideForSeat(nextSeat);
      snapshot.turnIndex = move.turnIndex + 1;
    }
    replayState = clone(snapshot);

    return {
      ...move,
      action: clone(move.action),
      clientCommandId: move.clientCommandId ?? null,
      undone: move.undone === true,
      undoneAt: move.undoneAt ?? null,
      undoneByIdentityId: move.undoneByIdentityId ?? null,
      selectionSnapshot,
      snapshot,
    };
  });
};

const serializeGame = (game: LiveGame): PersistedLiveGame => ({
  formatVersion: PERSISTED_GAME_FORMAT_VERSION,
  id: game.id,
  createdAt: game.createdAt,
  updatedAt: game.updatedAt,
  lastMoveAt: game.lastMoveAt ?? null,
  playgroundMode: game.playgroundMode === true,
  offlineLocal: game.offlineLocal === true,
  initialState: toMinimalState(game.moves[0]?.selectionSnapshot ?? game.board.state),
  currentState: toMinimalState(game.board.state),
  player1: toPersistedParticipant(game.player1),
  player2: toPersistedParticipant(game.player2),
  viewers: game.viewers.map((viewer) => toPersistedParticipant(viewer)).filter(Boolean) as PersistedParticipant[],
  pendingJoinRequests: clone(game.pendingJoinRequests),
  pendingRevertRequest: clone(game.pendingRevertRequest),
  turns: clone(game.turns),
  moves: game.moves.map((move) => toPersistedMove(move)),
  historyIndexByIdentity: clone(game.historyIndexByIdentity ?? {}),
  pendingScenarioSelection: clone(game.pendingScenarioSelection),
  notifications: (Array.isArray(game.notifications) ? game.notifications : [])
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, MAX_PERSISTED_NOTIFICATIONS),
  initialSelectionAction: game.initialSelectionAction ? clone(game.initialSelectionAction) : null,
});

const deserializeGame = ({
  serialized,
  row,
  context,
  inviteTokens,
}: {
  serialized: string;
  row: Pick<PersistedGameRow, "game_id" | "created_at" | "updated_at" | "event_seq">;
  context: PersistedGameLoadContext;
  inviteTokens: { viewer: string; player1: string; player2: string };
}): PersistedGameProjection => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    const mismatches: PersistedGameMismatch[] = [];
    recordMismatch(
      mismatches,
      "state_json",
      "valid compact JSON object",
      error instanceof Error ? error.message : error,
      "rejected_invalid_projection",
    );
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  if (!isRecord(parsed)) {
    const mismatches: PersistedGameMismatch[] = [];
    recordMismatch(mismatches, "game", "compact persisted game object", parsed, "rejected_invalid_projection");
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const mismatches: PersistedGameMismatch[] = [];
  if (parsed.formatVersion !== PERSISTED_GAME_FORMAT_VERSION) {
    recordMismatch(
      mismatches,
      "formatVersion",
      String(PERSISTED_GAME_FORMAT_VERSION),
      parsed.formatVersion,
      "rejected_invalid_projection",
    );
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const initialState = asGameState(parsed.initialState);
  const currentState = asGameState(parsed.currentState);
  if (!initialState || !currentState) {
    if (!initialState) {
      recordMismatch(mismatches, "initialState", "GameState", parsed.initialState, "rejected_invalid_projection");
    }
    if (!currentState) {
      recordMismatch(mismatches, "currentState", "GameState", parsed.currentState, "rejected_invalid_projection");
    }
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const persistedMoves = fromPersistedMoveEntries(parsed.moves, mismatches);
  if (mismatches.length > 0) {
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const hydratedInitialState = toHydratedState(initialState);
  const hydratedCurrentState = toHydratedState(currentState);
  let moves: LiveGame["moves"];
  try {
    moves = rehydrateMoveHistory(persistedMoves, hydratedInitialState);
  } catch (error) {
    recordMismatch(
      mismatches,
      "moves",
      "replayable compact move history",
      error instanceof Error ? error.message : error,
      "rejected_invalid_projection",
    );
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }
  const hasUndoneMoves = persistedMoves.some((move) => move.undone === true);
  const replayedCurrentState = moves.at(-1)?.snapshot ?? hydratedInitialState;
  const boardState =
    moves.length > 0 && !hasUndoneMoves
      ? replayedCurrentState
      : hydratedCurrentState;

  const game: LiveGame = {
    id: typeof parsed.id === "string" && parsed.id ? parsed.id : row.game_id,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : row.created_at || now(),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : row.updated_at || now(),
    lastMoveAt: typeof parsed.lastMoveAt === "string" ? parsed.lastMoveAt : null,
    playgroundMode: parsed.playgroundMode === true,
    offlineLocal: parsed.offlineLocal === true,
    board: { state: boardState },
    player1: fromPersistedParticipant(parsed.player1, "player1", mismatches),
    player2: fromPersistedParticipant(parsed.player2, "player2", mismatches),
    viewers: fromPersistedParticipants(parsed.viewers, "viewers", mismatches),
    pendingJoinRequests: fromPersistedJoinRequests(parsed.pendingJoinRequests, mismatches),
    pendingRevertRequest: (parsed.pendingRevertRequest as RevertRequest | null) ?? null,
    turns: fromPersistedTurns(parsed.turns, mismatches),
    moves,
    historyIndexByIdentity: isRecord(parsed.historyIndexByIdentity)
      ? Object.entries(parsed.historyIndexByIdentity).reduce<Record<string, number>>((acc, [identityId, value]) => {
          if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
            acc[identityId] = value;
          }
          return acc;
        }, {})
      : {},
    pendingScenarioSelection:
      parsed.pendingScenarioSelection == null || isRecord(parsed.pendingScenarioSelection)
        ? (parsed.pendingScenarioSelection as ScenarioSavedSelection | null)
        : null,
    notifications: Array.isArray(parsed.notifications)
      ? parsed.notifications.filter((entry): entry is string => typeof entry === "string")
      : [],
    initialSelectionAction: parsed.initialSelectionAction == null ? null : asAction(parsed.initialSelectionAction),
    inviteTokens,
  };

  if (mismatches.length > 0) {
    console.error(JSON.stringify(buildShapeLogPayload({ gameId: row.game_id, context, mismatches })));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  return { kind: "ok", game, eventSeq: Number(row.event_seq || 0) };
};

const serializeEvent = (event: ServerEvent & { eventSeq: number }): PersistedServerEvent | null => {
  if (!("game" in event)) {
    return null;
  }
  if (event.type === "event_appended") {
    return {
      type: event.type,
      eventSeq: event.eventSeq,
      reason: event.reason,
      clientCommandId: event.clientCommandId ?? null,
      game: serializeGame(event.game as LiveGame),
    } satisfies PersistedEventAppended;
  }
  if (event.type === "presence_changed") {
    return {
      type: event.type,
      eventSeq: event.eventSeq,
      identityId: event.identityId,
      role: event.role,
      roles: event.roles,
      connected: event.connected,
      game: serializeGame(event.game as LiveGame),
    } satisfies PersistedPresenceChanged;
  }
  if (event.type === "join_request_created") {
    return {
      type: event.type,
      eventSeq: event.eventSeq,
      requesterIdentityId: event.requesterIdentityId,
      requestedSeat: event.requestedSeat,
      game: serializeGame(event.game as LiveGame),
    } satisfies PersistedJoinRequestCreated;
  }
  if (event.type === "join_request_resolved") {
    return {
      type: event.type,
      eventSeq: event.eventSeq,
      requesterIdentityId: event.requesterIdentityId,
      accepted: event.accepted,
      seat: event.seat,
      game: serializeGame(event.game as LiveGame),
    } satisfies PersistedJoinRequestResolved;
  }
  return null;
};

const deserializeEvent = async (
  env: LiveGameEnv,
  gameId: string,
  payloadJson: string,
): Promise<ServerEvent | null> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string" || typeof parsed.eventSeq !== "number" || !isRecord(parsed.game)) {
    return null;
  }
  const inviteTokens = await loadInviteTokens(env, gameId);
  const projection = deserializeGame({
    serialized: JSON.stringify(parsed.game),
    row: { game_id: gameId, created_at: "", updated_at: "", event_seq: parsed.eventSeq },
    context: "event",
    inviteTokens,
  });
  if (projection.kind !== "ok") {
    return null;
  }

  if (parsed.type === "event_appended" && typeof parsed.reason === "string") {
    return {
      type: "event_appended",
      eventSeq: parsed.eventSeq,
      reason: parsed.reason,
      clientCommandId: typeof parsed.clientCommandId === "string" || parsed.clientCommandId === null ? parsed.clientCommandId : null,
      game: projection.game,
    } satisfies EventAppendedEvent;
  }
  if (
    parsed.type === "presence_changed" &&
    typeof parsed.identityId === "string" &&
    (parsed.role === "Player 1" || parsed.role === "Player 2" || parsed.role === "Viewer") &&
    typeof parsed.connected === "boolean"
  ) {
    return {
      type: "presence_changed",
      eventSeq: parsed.eventSeq,
      identityId: parsed.identityId,
      role: parsed.role,
      roles: Array.isArray(parsed.roles)
        ? parsed.roles.filter((role): role is "Player 1" | "Player 2" | "Viewer" => role === "Player 1" || role === "Player 2" || role === "Viewer")
        : undefined,
      connected: parsed.connected,
      game: projection.game,
    } satisfies PresenceChangedEvent;
  }
  if (
    parsed.type === "join_request_created" &&
    typeof parsed.requesterIdentityId === "string" &&
    (parsed.requestedSeat === "Player 1" || parsed.requestedSeat === "Player 2")
  ) {
    return {
      type: "join_request_created",
      eventSeq: parsed.eventSeq,
      requesterIdentityId: parsed.requesterIdentityId,
      requestedSeat: parsed.requestedSeat,
      game: projection.game,
    } satisfies JoinRequestCreatedEvent;
  }
  if (
    parsed.type === "join_request_resolved" &&
    typeof parsed.requesterIdentityId === "string" &&
    typeof parsed.accepted === "boolean" &&
    (parsed.seat === "Player 1" || parsed.seat === "Player 2" || parsed.seat === null)
  ) {
    return {
      type: "join_request_resolved",
      eventSeq: parsed.eventSeq,
      requesterIdentityId: parsed.requesterIdentityId,
      accepted: parsed.accepted,
      seat: parsed.seat,
      game: projection.game,
    } satisfies JoinRequestResolvedEvent;
  }
  return null;
};

const loadInviteTokens = async (
  env: LiveGameEnv,
  gameId: string,
): Promise<{ viewer: string; player1: string; player2: string }> => {
  const result = await env.DB.prepare(
    `SELECT token, shared_by_role FROM ${LIVE_INVITES_TABLE} WHERE game_id = ?1`,
  )
    .bind(gameId)
    .all<PersistedInviteRow>();

  const tokens = {
    viewer: "",
    player1: "",
    player2: "",
  };
  for (const row of result.results ?? []) {
    if (row.shared_by_role === "Viewer") {
      tokens.viewer = row.token;
    } else if (row.shared_by_role === "Player 1") {
      tokens.player1 = row.token;
    } else if (row.shared_by_role === "Player 2") {
      tokens.player2 = row.token;
    }
  }
  return {
    viewer: tokens.viewer || createInviteToken(),
    player1: tokens.player1 || createInviteToken(),
    player2: tokens.player2 || createInviteToken(),
  };
};

export const loadGameProjection = async (env: LiveGameEnv, gameId: string): Promise<PersistedGameProjection | null> => {
  const row = await env.DB.prepare(
    `SELECT game_id, created_at, updated_at, state_json, event_seq FROM ${LIVE_GAMES_TABLE} WHERE game_id = ?1`,
  )
    .bind(gameId)
    .first<PersistedGameRow>();
  if (!row?.state_json) {
    return null;
  }
  const inviteTokens = await loadInviteTokens(env, gameId);
  return deserializeGame({ serialized: row.state_json, row, context: "single", inviteTokens });
};

export const listVisibleGameProjections = async (env: LiveGameEnv): Promise<LiveGame[]> => {
  const result = await env.DB.prepare(
    `SELECT game_id, created_at, updated_at, state_json, event_seq FROM ${LIVE_GAMES_TABLE}
     WHERE offline_local = 0
     ORDER BY latest_activity_at DESC, created_at DESC`,
  ).all<PersistedGameRow>();

  const projections = await Promise.all(
    (result.results ?? []).map(async (row) => {
      const inviteTokens = await loadInviteTokens(env, row.game_id);
      return deserializeGame({ serialized: row.state_json, row, context: "list", inviteTokens });
    }),
  );
  return projections.flatMap((projection) => (projection.kind === "ok" ? [projection.game] : []));
};

export const saveProjection = async (
  env: LiveGameEnv,
  game: LiveGame,
  eventSeq: number,
) => {
  await env.DB.prepare(
    `INSERT INTO ${LIVE_GAMES_TABLE} (game_id, created_at, updated_at, latest_activity_at, offline_local, state_json, event_seq)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(game_id) DO UPDATE SET
       updated_at = excluded.updated_at,
       latest_activity_at = excluded.latest_activity_at,
       offline_local = excluded.offline_local,
       state_json = excluded.state_json,
       event_seq = excluded.event_seq`,
  )
    .bind(
      game.id,
      game.createdAt,
      game.updatedAt,
      game.lastMoveAt || game.updatedAt || game.createdAt,
      game.offlineLocal ? 1 : 0,
      JSON.stringify(serializeGame(game)),
      eventSeq,
    )
    .run();
};

export const saveInviteTokens = async (env: LiveGameEnv, game: LiveGame) => {
  const entries = [
    [game.inviteTokens.viewer, "Viewer"],
    [game.inviteTokens.player1, "Player 1"],
    [game.inviteTokens.player2, "Player 2"],
  ] as const;
  await Promise.all(
    entries.map(([token, sharedByRole]) =>
      env.DB.prepare(
        `INSERT INTO ${LIVE_INVITES_TABLE} (token, game_id, shared_by_role)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(token) DO UPDATE SET
           game_id = excluded.game_id,
           shared_by_role = excluded.shared_by_role`,
      )
        .bind(token, game.id, sharedByRole)
        .run(),
    ),
  );
};

export const resolveInvite = async (
  env: LiveGameEnv,
  token: string,
): Promise<{ gameId: string; sharedByRole: "Viewer" | "Player 1" | "Player 2" } | null> => {
  const row = await env.DB.prepare(
    `SELECT game_id, shared_by_role FROM ${LIVE_INVITES_TABLE} WHERE token = ?1`,
  )
    .bind(token)
    .first<{ game_id: string; shared_by_role: "Viewer" | "Player 1" | "Player 2" }>();
  if (!row?.game_id || !row.shared_by_role) {
    return null;
  }
  return {
    gameId: row.game_id,
    sharedByRole: row.shared_by_role,
  };
};

export const appendEvent = async (env: LiveGameEnv, gameId: string, event: ServerEvent & { eventSeq: number }) => {
  const serialized = serializeEvent(event);
  if (!serialized) {
    return;
  }
  await env.DB.prepare(
    `INSERT INTO ${LIVE_EVENTS_TABLE}
       (game_id, event_seq, payload_json)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(gameId, event.eventSeq, JSON.stringify(serialized))
    .run();
};

export const loadEventsAfter = async (env: LiveGameEnv, gameId: string, lastEventSeq: number): Promise<ServerEvent[]> => {
  const result = await env.DB.prepare(
    `SELECT payload_json FROM ${LIVE_EVENTS_TABLE}
     WHERE game_id = ?1 AND event_seq > ?2
     ORDER BY event_seq ASC`,
  )
    .bind(gameId, lastEventSeq)
    .all<PersistedEventRow>();

  const events = await Promise.all(
    (result.results ?? []).map((row) => deserializeEvent(env, gameId, row.payload_json)),
  );
  return events.filter((event): event is ServerEvent => Boolean(event));
};

export const persistGameState = async (
  env: LiveGameEnv,
  game: LiveGame,
  eventSeq: number,
  event?: (ServerEvent & { eventSeq: number }) | null,
) => {
  await saveProjection(env, game, eventSeq);
  await saveInviteTokens(env, game);
  if (event) {
    await appendEvent(env, game.id, event);
  }
};
