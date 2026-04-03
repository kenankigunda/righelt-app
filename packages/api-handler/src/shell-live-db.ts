import type { ServerEvent } from "../../shared-types/src/events";
import {
  asAction,
  asGameState,
  createInviteToken,
  nextMoveId,
  now,
  type JoinRequest,
  type LiveGame,
  type Participant,
  type ScenarioSavedSelection,
  type StaticGameCard,
  type Viewer,
  toStaticGameCard,
} from "./shell-live-core";

const LIVE_GAMES_TABLE = "live_games";
const LIVE_INVITES_TABLE = "live_invites";
const LIVE_EVENTS_TABLE = "live_events";

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

type RepairLogPayload = {
  event: "live_game_shape_repaired";
  gameId: string;
  context: PersistedGameLoadContext;
  mismatches: PersistedGameMismatch[];
  mismatchCount?: number;
  condensed?: boolean;
};
type InvalidLogPayload = {
  event: "live_game_shape_invalid";
  gameId: string;
  context: PersistedGameLoadContext;
  mismatches: PersistedGameMismatch[];
  mismatchCount?: number;
  condensed?: boolean;
};

export type PersistedGameLoadContext = "single" | "list";

export type PersistedGameProjection =
  | { kind: "ok"; game: LiveGame; eventSeq: number }
  | { kind: "invalid"; gameId: string; eventSeq: number; mismatches: PersistedGameMismatch[] };

export type PersistedStaticGameCardProjection =
  | { kind: "ok"; game: StaticGameCard; eventSeq: number }
  | { kind: "invalid"; gameId: string; eventSeq: number; mismatches: PersistedGameMismatch[] };

type PersistedGameRow = {
  game_id: string;
  created_at: string;
  updated_at: string;
  state_json: string;
  event_seq: number;
};

export type HomeSectionKey = "my" | "other" | "smoke";

type HomeSectionCountRow = {
  total_games: number;
};

type HomeSectionPageParams = {
  identityId: string;
  section: HomeSectionKey;
  page: number;
  pageSize: number;
  debug: boolean;
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

const getProcessEnvFlag = (key: string) => {
  const processLike = (globalThis as { process?: { env?: Record<string, unknown> } }).process;
  const raw = processLike?.env?.[key];
  return raw == null ? "" : String(raw).toLowerCase();
};

const isVerboseRepairLoggingEnabled = () => {
  const processEnvFlag = getProcessEnvFlag("RIGHELT_VERBOSE_REPAIR_LOGS");
  const globalFlag =
    typeof globalThis !== "undefined" && (globalThis as { __RIGHELT_VERBOSE_REPAIR_LOGS?: unknown }).__RIGHELT_VERBOSE_REPAIR_LOGS
      ? String((globalThis as { __RIGHELT_VERBOSE_REPAIR_LOGS?: unknown }).__RIGHELT_VERBOSE_REPAIR_LOGS).toLowerCase()
      : "";
  const value = processEnvFlag || globalFlag;
  return value === "1" || value === "true" || value === "yes" || value === "on" || value === "verbose";
};

const condenseRepairMismatches = (mismatches: PersistedGameMismatch[]): PersistedGameMismatch[] => {
  const generatedMoveIdCount = mismatches.filter(
    (entry) => entry.field.startsWith("moves[") && entry.field.endsWith("].moveId") && entry.repair === "generated_move_id",
  ).length;
  const derivedDisplayMoveNumberCount = mismatches.filter(
    (entry) =>
      entry.field.startsWith("moves[") &&
      entry.field.endsWith("].displayMoveNumber") &&
      entry.repair === "derived_from_active_history",
  ).length;
  const shouldCondense = generatedMoveIdCount + derivedDisplayMoveNumberCount >= 8;
  if (!shouldCondense) {
    return mismatches;
  }
  const condensed = mismatches.filter(
    (entry) =>
      !(
        (entry.field.startsWith("moves[") && entry.field.endsWith("].moveId") && entry.repair === "generated_move_id") ||
        (entry.field.startsWith("moves[") &&
          entry.field.endsWith("].displayMoveNumber") &&
          entry.repair === "derived_from_active_history")
      ),
  );
  if (generatedMoveIdCount > 0) {
    condensed.push({
      field: "moves[*].moveId",
      expected: "non-empty string",
      actualType: "summary",
      actualSummary: `${generatedMoveIdCount} move entries missing moveId`,
      repair: "generated_move_id",
    });
  }
  if (derivedDisplayMoveNumberCount > 0) {
    condensed.push({
      field: "moves[*].displayMoveNumber",
      expected: "finite number",
      actualType: "summary",
      actualSummary: `${derivedDisplayMoveNumberCount} move entries missing displayMoveNumber`,
      repair: "derived_from_active_history",
    });
  }
  return condensed;
};

const buildShapeLogPayload = ({
  event,
  gameId,
  context,
  mismatches,
}: {
  event: "live_game_shape_repaired" | "live_game_shape_invalid";
  gameId: string;
  context: PersistedGameLoadContext;
  mismatches: PersistedGameMismatch[];
}): RepairLogPayload | InvalidLogPayload => {
  const verbose = isVerboseRepairLoggingEnabled();
  const loggedMismatches = verbose ? mismatches : condenseRepairMismatches(mismatches);
  const payload: RepairLogPayload | InvalidLogPayload =
    event === "live_game_shape_repaired"
      ? {
          event,
          gameId,
          context,
          mismatches: loggedMismatches,
        }
      : {
          event,
          gameId,
          context,
          mismatches: loggedMismatches,
        };
  if (!verbose && loggedMismatches.length !== mismatches.length) {
    payload.condensed = true;
    payload.mismatchCount = mismatches.length;
  }
  return payload;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeScenarioSavedSelection = (
  value: unknown,
  mismatches: PersistedGameMismatch[],
): ScenarioSavedSelection | null => {
  if (value == null) {
    return null;
  }
  if (!isRecord(value)) {
    recordMismatch(mismatches, "pendingScenarioSelection", "scenario saved selection", value, "defaulted_to_null");
    return null;
  }
  const source = isRecord(value.source) && typeof value.source.row === "number" && typeof value.source.col === "number"
    ? { row: value.source.row, col: value.source.col }
    : null;
  const target =
    value.target == null
      ? null
      : isRecord(value.target) && typeof value.target.row === "number" && typeof value.target.col === "number"
        ? { row: value.target.row, col: value.target.col }
        : null;
  if (
    !source ||
    (value.target != null && !target) ||
    (value.actorSide !== "P1" && value.actorSide !== "P2") ||
    typeof value.turnIndex !== "number"
  ) {
    recordMismatch(mismatches, "pendingScenarioSelection", "scenario saved selection", value, "defaulted_to_null");
    return null;
  }
  return {
    source,
    target,
    actorSide: value.actorSide,
    turnIndex: value.turnIndex,
  };
};

const normalizeParticipant = (
  value: unknown,
  field: string,
  mismatches: PersistedGameMismatch[],
): Participant | null => {
  if (value == null) {
    return null;
  }
  if (!isRecord(value) || typeof value.identityId !== "string" || value.identityId.trim().length === 0) {
    recordMismatch(mismatches, field, "participant", value, "defaulted_to_null");
    return null;
  }
  const identityId = value.identityId.trim();
  const joinedAt = typeof value.joinedAt === "string" && value.joinedAt ? value.joinedAt : now();
  if (!(typeof value.joinedAt === "string" && value.joinedAt)) {
    recordMismatch(mismatches, `${field}.joinedAt`, "non-empty string", value.joinedAt, "defaulted_to_now");
  }
  let lastHeartbeatAt = typeof value.lastHeartbeatAt === "string" && value.lastHeartbeatAt ? value.lastHeartbeatAt : joinedAt;
  if (typeof value.lastHeartbeatAt !== "string" || !value.lastHeartbeatAt) {
    if (typeof value.lastSeenAt === "string" && value.lastSeenAt) {
      lastHeartbeatAt = value.lastSeenAt;
      recordMismatch(mismatches, `${field}.lastHeartbeatAt`, "non-empty string", value.lastHeartbeatAt, "copied_from_lastSeenAt");
    } else {
      recordMismatch(mismatches, `${field}.lastHeartbeatAt`, "non-empty string", value.lastHeartbeatAt, "defaulted_to_joinedAt");
    }
  }
  const sessionCount = typeof value.sessionCount === "number" && Number.isFinite(value.sessionCount) ? value.sessionCount : 0;
  if (!(typeof value.sessionCount === "number" && Number.isFinite(value.sessionCount))) {
    recordMismatch(mismatches, `${field}.sessionCount`, "finite number", value.sessionCount, "defaulted_to_zero");
  }
  const connected = typeof value.connected === "boolean" ? value.connected : sessionCount > 0;
  if (typeof value.connected !== "boolean") {
    recordMismatch(mismatches, `${field}.connected`, "boolean", value.connected, "derived_from_sessionCount");
  }
  return {
    identityId,
    joinedAt,
    lastHeartbeatAt,
    sessionCount,
    connected,
  };
};

const normalizeViewerList = (value: unknown, mismatches: PersistedGameMismatch[]): Viewer[] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, "viewers", "viewer[]", value, "defaulted_to_empty_array");
    return [];
  }
  return value.flatMap((entry, index) => {
    const participant = normalizeParticipant(entry, `viewers[${index}]`, mismatches);
    if (!participant) {
      recordMismatch(mismatches, `viewers[${index}]`, "viewer", entry, "dropped_invalid_record");
      return [];
    }
    return [participant];
  });
};

const normalizeJoinRequests = (value: unknown, mismatches: PersistedGameMismatch[]): JoinRequest[] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, "pendingJoinRequests", "join_request[]", value, "defaulted_to_empty_array");
    return [];
  }
  return value.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.identityId !== "string" || (entry.requestedSeat !== "Player 1" && entry.requestedSeat !== "Player 2")) {
      recordMismatch(mismatches, `pendingJoinRequests[${index}]`, "join_request", entry, "dropped_invalid_record");
      return [];
    }
    const requestedAt = typeof entry.requestedAt === "string" && entry.requestedAt ? entry.requestedAt : now();
    if (!(typeof entry.requestedAt === "string" && entry.requestedAt)) {
      recordMismatch(mismatches, `pendingJoinRequests[${index}].requestedAt`, "non-empty string", entry.requestedAt, "defaulted_to_now");
    }
    const source = entry.source === "viewer_invite" || entry.source === "home_list" ? entry.source : "home_list";
    if (entry.source !== "viewer_invite" && entry.source !== "home_list") {
      recordMismatch(mismatches, `pendingJoinRequests[${index}].source`, "\"viewer_invite\" | \"home_list\"", entry.source, "defaulted_to_home_list");
    }
    const status = entry.status === "pending" || entry.status === "accepted" || entry.status === "rejected" ? entry.status : undefined;
    if (typeof entry.status !== "undefined" && typeof status === "undefined") {
      recordMismatch(mismatches, `pendingJoinRequests[${index}].status`, "\"pending\" | \"accepted\" | \"rejected\"", entry.status, "dropped_invalid_value");
    }
    return [{
      identityId: entry.identityId.trim(),
      requestedSeat: entry.requestedSeat,
      requestedAt,
      source,
      status,
      resolvedAt: typeof entry.resolvedAt === "string" || entry.resolvedAt === null ? entry.resolvedAt : null,
      resolvedBy: typeof entry.resolvedBy === "string" || entry.resolvedBy === null ? entry.resolvedBy : null,
    }];
  });
};

const normalizeInviteTokens = (value: unknown, mismatches: PersistedGameMismatch[]) => {
  const fallback = {
    viewer: createInviteToken(),
    player1: createInviteToken(),
    player2: createInviteToken(),
  };
  if (!isRecord(value)) {
    recordMismatch(mismatches, "inviteTokens", "{ viewer, player1, player2 }", value, "generated_missing_tokens");
    return fallback;
  }
  return {
    viewer: typeof value.viewer === "string" && value.viewer ? value.viewer : (recordMismatch(
      mismatches,
      "inviteTokens.viewer",
      "non-empty string",
      value.viewer,
      "generated_token",
    ), fallback.viewer),
    player1: typeof value.player1 === "string" && value.player1 ? value.player1 : (recordMismatch(
      mismatches,
      "inviteTokens.player1",
      "non-empty string",
      value.player1,
      "generated_token",
    ), fallback.player1),
    player2: typeof value.player2 === "string" && value.player2 ? value.player2 : (recordMismatch(
      mismatches,
      "inviteTokens.player2",
      "non-empty string",
      value.player2,
      "generated_token",
    ), fallback.player2),
  };
};

const normalizeHistoryIndexByIdentity = (value: unknown, mismatches: PersistedGameMismatch[]) => {
  if (!isRecord(value)) {
    recordMismatch(mismatches, "historyIndexByIdentity", "record<string, number>", value, "defaulted_to_empty_object");
    return {} as Record<string, number>;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([identityId, indexValue]) => {
      if (typeof indexValue === "number" && Number.isInteger(indexValue) && indexValue >= 0) {
        return [[identityId, indexValue]];
      }
      recordMismatch(
        mismatches,
        `historyIndexByIdentity.${identityId}`,
        "non-negative integer",
        indexValue,
        "dropped_invalid_entry",
      );
      return [];
    }),
  );
};

const normalizeMoves = (value: unknown, mismatches: PersistedGameMismatch[]): LiveGame["moves"] => {
  if (!Array.isArray(value)) {
    recordMismatch(mismatches, "moves", "move[]", value, "defaulted_to_empty_array");
    return [];
  }
  let activeMoveCounter = 0;
  return value
    .filter((entry) => Boolean(entry) && typeof entry === "object")
    .map((entry, index) => {
      const move = entry as Record<string, unknown>;
      const undone = move.undone === true;
      if (!undone) {
        activeMoveCounter += 1;
      }
      const next = {
        ...(entry as LiveGame["moves"][number]),
        moveId: typeof move.moveId === "string" && move.moveId.length > 0 ? move.moveId : nextMoveId(),
        index: typeof move.index === "number" && Number.isFinite(move.index) ? move.index : index,
        displayMoveNumber:
          typeof move.displayMoveNumber === "number" && Number.isFinite(move.displayMoveNumber)
            ? move.displayMoveNumber
            : activeMoveCounter,
      } satisfies LiveGame["moves"][number];
      if (typeof move.moveId !== "string" || move.moveId.length === 0) {
        recordMismatch(mismatches, `moves[${index}].moveId`, "non-empty string", move.moveId, "generated_move_id");
      }
      if (typeof move.displayMoveNumber !== "number" || !Number.isFinite(move.displayMoveNumber)) {
        recordMismatch(
          mismatches,
          `moves[${index}].displayMoveNumber`,
          "finite number",
          move.displayMoveNumber,
          "derived_from_active_history",
        );
      }
      return next;
    });
};

const normalizePersistedGame = (
  row: PersistedGameRow,
  context: PersistedGameLoadContext,
): PersistedGameProjection => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state_json);
  } catch (error) {
    const mismatches: PersistedGameMismatch[] = [];
    recordMismatch(
      mismatches,
      "state_json",
      "valid JSON object",
      error instanceof Error ? error.message : error,
      "rejected_invalid_projection",
    );
    console.error(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches })),
    );
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const mismatches: PersistedGameMismatch[] = [];
  if (!isRecord(parsed)) {
    recordMismatch(mismatches, "game", "object", parsed, "rejected_invalid_projection");
    console.error(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches })),
    );
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const board = isRecord(parsed.board) ? parsed.board : null;
  if (!board) {
    recordMismatch(mismatches, "board", "{ state: GameState }", parsed.board, "rejected_invalid_projection");
  }
  const boardState = asGameState(board?.state);
  if (!boardState) {
    recordMismatch(mismatches, "board.state", "GameState", board?.state, "rejected_invalid_projection");
  }
  if (!board || !boardState) {
    console.error(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches })),
    );
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const moves = normalizeMoves(parsed.moves, mismatches);
  const turns = Array.isArray(parsed.turns) ? (parsed.turns as LiveGame["turns"]) : (recordMismatch(
    mismatches,
    "turns",
    "turn[]",
    parsed.turns,
    "defaulted_to_empty_array",
  ), []);
  const notifications = Array.isArray(parsed.notifications) ? parsed.notifications.filter((entry) => typeof entry === "string") : (recordMismatch(
    mismatches,
    "notifications",
    "string[]",
    parsed.notifications,
    "defaulted_to_empty_array",
  ), []);
  const initialSelectionAction = typeof parsed.initialSelectionAction === "undefined" || parsed.initialSelectionAction === null
    ? null
    : asAction(parsed.initialSelectionAction) ?? (recordMismatch(
      mismatches,
      "initialSelectionAction",
      "Action",
      parsed.initialSelectionAction,
      "defaulted_to_null",
    ), null);
  if (Array.isArray(parsed.notifications) && notifications.length !== parsed.notifications.length) {
    recordMismatch(mismatches, "notifications", "string[]", parsed.notifications, "dropped_non_string_entries");
  }

  const game: LiveGame = {
    id: typeof parsed.id === "string" && parsed.id ? parsed.id : row.game_id,
    createdAt: typeof parsed.createdAt === "string" && parsed.createdAt ? parsed.createdAt : row.created_at || row.updated_at || now(),
    lastMoveAt: typeof parsed.lastMoveAt === "string" ? parsed.lastMoveAt : null,
    updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : row.updated_at || row.created_at || now(),
    selfPlayMode: parsed.selfPlayMode === true || parsed.playgroundMode === true,
    board: { state: boardState },
    player1: normalizeParticipant(parsed.player1, "player1", mismatches),
    player2: normalizeParticipant(parsed.player2, "player2", mismatches),
    viewers: normalizeViewerList(parsed.viewers, mismatches),
    pendingJoinRequests: normalizeJoinRequests(parsed.pendingJoinRequests, mismatches),
    pendingRevertRequest:
      parsed.pendingRevertRequest && typeof parsed.pendingRevertRequest === "object"
        ? (parsed.pendingRevertRequest as LiveGame["pendingRevertRequest"])
        : null,
    turns,
    moves,
    historyIndexByIdentity: normalizeHistoryIndexByIdentity(parsed.historyIndexByIdentity, mismatches),
    pendingScenarioSelection: normalizeScenarioSavedSelection(parsed.pendingScenarioSelection, mismatches),
    notifications,
    initialSelectionAction,
    inviteTokens: normalizeInviteTokens(parsed.inviteTokens, mismatches),
  };

  if (typeof parsed.id !== "string" || !parsed.id) {
    recordMismatch(mismatches, "id", "non-empty string", parsed.id, "defaulted_from_row_game_id");
  }
  if (typeof parsed.createdAt !== "string" || !parsed.createdAt) {
    recordMismatch(mismatches, "createdAt", "non-empty string", parsed.createdAt, "defaulted_from_row_timestamp");
  }
  if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) {
    recordMismatch(mismatches, "updatedAt", "non-empty string", parsed.updatedAt, "defaulted_from_row_timestamp");
  }
  if (typeof parsed.selfPlayMode !== "boolean" && typeof parsed.playgroundMode !== "boolean") {
    recordMismatch(mismatches, "selfPlayMode", "boolean", parsed.selfPlayMode, "defaulted_to_false");
  }

  if (mismatches.length > 0) {
    console.warn(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_repaired", gameId: game.id, context, mismatches })),
    );
  }
  return { kind: "ok", game, eventSeq: Number(row.event_seq || 0) };
};

const normalizePersistedStaticGameCard = (
  row: PersistedGameRow,
  identityId: string,
  context: PersistedGameLoadContext,
): { projection: PersistedStaticGameCardProjection; parseMs: number; cardModelMs: number } => {
  const parseStart = Date.now();
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state_json);
  } catch (error) {
    const mismatches: PersistedGameMismatch[] = [];
    recordMismatch(
      mismatches,
      "state_json",
      "valid JSON object",
      error instanceof Error ? error.message : error,
      "rejected_invalid_projection",
    );
    console.error(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches })),
    );
    return {
      projection: { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches },
      parseMs: Date.now() - parseStart,
      cardModelMs: 0,
    };
  }

  const mismatches: PersistedGameMismatch[] = [];
  if (!isRecord(parsed)) {
    recordMismatch(mismatches, "game", "object", parsed, "rejected_invalid_projection");
    console.error(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches })),
    );
    return {
      projection: { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches },
      parseMs: Date.now() - parseStart,
      cardModelMs: 0,
    };
  }

  const board = isRecord(parsed.board) ? parsed.board : null;
  const boardState = asGameState(board?.state);
  if (!board || !boardState) {
    recordMismatch(mismatches, "board.state", "GameState", board?.state, "rejected_invalid_projection");
    console.error(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches })),
    );
    return {
      projection: { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches },
      parseMs: Date.now() - parseStart,
      cardModelMs: 0,
    };
  }

  const moves = Array.isArray(parsed.moves) ? parsed.moves : [];
  const parseMs = Date.now() - parseStart;
  const cardStart = Date.now();
  const game = toStaticGameCard(
    {
      id: typeof parsed.id === "string" && parsed.id ? parsed.id : row.game_id,
      createdAt: typeof parsed.createdAt === "string" && parsed.createdAt ? parsed.createdAt : row.created_at || row.updated_at || now(),
      lastMoveAt: typeof parsed.lastMoveAt === "string" ? parsed.lastMoveAt : null,
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : row.updated_at || row.created_at || now(),
      selfPlayMode: parsed.selfPlayMode === true || parsed.playgroundMode === true,
      board: { state: boardState },
      player1: normalizeParticipant(parsed.player1, "player1", mismatches),
      player2: normalizeParticipant(parsed.player2, "player2", mismatches),
      viewers: normalizeViewerList(parsed.viewers, mismatches),
      pendingJoinRequests: normalizeJoinRequests(parsed.pendingJoinRequests, mismatches),
      pendingScenarioSelection: normalizeScenarioSavedSelection(parsed.pendingScenarioSelection, mismatches),
      moveCount: moves.length,
      previewSnapshot: boardState,
    },
    identityId,
  );

  if (mismatches.length > 0) {
    console.warn(
      JSON.stringify(buildShapeLogPayload({ event: "live_game_shape_repaired", gameId: game.id, context, mismatches })),
    );
  }
  return {
    projection: { kind: "ok", game, eventSeq: Number(row.event_seq || 0) },
    parseMs,
    cardModelMs: Date.now() - cardStart,
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
  return normalizePersistedGame(row, "single");
};

const getHomeSectionWhereClause = ({ identityId, section, debug }: Omit<HomeSectionPageParams, "page" | "pageSize">) => {
  if (section === "smoke") {
    return {
      sql: "WHERE has_smoke_identity = 1",
      params: [] as unknown[],
    };
  }

  const playerMatchSql = "(COALESCE(player1_identity_id, '') = ?1 OR COALESCE(player2_identity_id, '') = ?1)";
  const sectionSql = section === "my" ? playerMatchSql : `NOT ${playerMatchSql}`;
  const smokeSql = debug ? "AND has_smoke_identity = 0" : "AND has_smoke_identity = 0";
  return {
    sql: `WHERE ${sectionSql} ${smokeSql}`,
    params: [identityId] as unknown[],
  };
};

export const countHomeSectionGames = async (
  env: LiveGameEnv,
  { identityId, section, debug }: Omit<HomeSectionPageParams, "page" | "pageSize">,
): Promise<number> => {
  if (section === "smoke" && !debug) {
    return 0;
  }
  const where = getHomeSectionWhereClause({ identityId, section, debug });
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total_games FROM ${LIVE_GAMES_TABLE} ${where.sql}`)
    .bind(...where.params)
    .first<HomeSectionCountRow>();
  return Number(row?.total_games ?? 0);
};

export const listHomeSectionGameProjectionPage = async (
  env: LiveGameEnv,
  { identityId, section, page, pageSize, debug }: HomeSectionPageParams,
): Promise<LiveGame[]> => {
  if (section === "smoke" && !debug) {
    return [];
  }
  const where = getHomeSectionWhereClause({ identityId, section, debug });
  const offset = page * pageSize;
  const result = await env.DB.prepare(
    `SELECT game_id, created_at, updated_at, state_json, event_seq FROM ${LIVE_GAMES_TABLE}
     ${where.sql}
     ORDER BY latest_activity_at DESC, created_at DESC
     LIMIT ?${where.params.length + 1}
     OFFSET ?${where.params.length + 2}`,
  )
    .bind(...where.params, pageSize, offset)
    .all<PersistedGameRow>();
  return (result.results ?? []).flatMap((row) => {
    const projection = normalizePersistedGame(row, "list");
    return projection.kind === "ok" ? [projection.game] : [];
  });
};

export const listHomeSectionStaticGameCardPage = async (
  env: LiveGameEnv,
  { identityId, section, page, pageSize, debug }: HomeSectionPageParams,
): Promise<{ games: StaticGameCard[]; parseMs: number; cardModelMs: number }> => {
  if (section === "smoke" && !debug) {
    return { games: [], parseMs: 0, cardModelMs: 0 };
  }
  const where = getHomeSectionWhereClause({ identityId, section, debug });
  const offset = page * pageSize;
  const result = await env.DB.prepare(
    `SELECT game_id, created_at, updated_at, state_json, event_seq FROM ${LIVE_GAMES_TABLE}
     ${where.sql}
     ORDER BY latest_activity_at DESC, created_at DESC
     LIMIT ?${where.params.length + 1}
     OFFSET ?${where.params.length + 2}`,
  )
    .bind(...where.params, pageSize, offset)
    .all<PersistedGameRow>();
  let parseMs = 0;
  let cardModelMs = 0;
  const games = (result.results ?? []).flatMap((row) => {
    const normalized = normalizePersistedStaticGameCard(row, identityId, "list");
    parseMs += normalized.parseMs;
    cardModelMs += normalized.cardModelMs;
    if (normalized.projection.kind !== "ok") {
      return [];
    }
    return [normalized.projection.game];
  });
  return { games, parseMs, cardModelMs };
};

const hasSmokeIdentity = (game: LiveGame) =>
  game.player1?.identityId === "smoke-player" ||
  game.player2?.identityId === "smoke-player" ||
  game.viewers.some((viewer) => viewer.identityId === "smoke-player") ||
  game.pendingJoinRequests.some((request) => request.identityId === "smoke-player");

export const saveProjection = async (
  env: LiveGameEnv,
  game: LiveGame,
  eventSeq: number,
) => {
  await env.DB.prepare(
    `INSERT INTO ${LIVE_GAMES_TABLE} (
       game_id,
       created_at,
       updated_at,
       latest_activity_at,
       player1_identity_id,
       player2_identity_id,
       has_smoke_identity,
       state_json,
       event_seq
     )
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(game_id) DO UPDATE SET
       updated_at = excluded.updated_at,
       latest_activity_at = excluded.latest_activity_at,
       player1_identity_id = excluded.player1_identity_id,
       player2_identity_id = excluded.player2_identity_id,
       has_smoke_identity = excluded.has_smoke_identity,
       state_json = excluded.state_json,
       event_seq = excluded.event_seq`,
  )
    .bind(
      game.id,
      game.createdAt,
      game.updatedAt,
      game.lastMoveAt || game.updatedAt || game.createdAt,
      game.player1?.identityId ?? null,
      game.player2?.identityId ?? null,
      hasSmokeIdentity(game) ? 1 : 0,
      JSON.stringify(game),
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
  await env.DB.prepare(
    `INSERT INTO ${LIVE_EVENTS_TABLE}
       (game_id, event_seq, payload_json)
     VALUES (?1, ?2, ?3)`,
  )
    .bind(
      gameId,
      event.eventSeq,
      JSON.stringify(event),
    )
    .run();
};

export const loadEventsAfter = async (env: LiveGameEnv, gameId: string, lastEventSeq: number): Promise<ServerEvent[]> => {
  const result = await env.DB.prepare(
    `SELECT payload_json FROM ${LIVE_EVENTS_TABLE}
     WHERE game_id = ?1 AND event_seq > ?2
     ORDER BY event_seq ASC`,
  )
    .bind(gameId, lastEventSeq)
    .all<{ payload_json: string }>();
  return (result.results ?? []).map((row) => JSON.parse(row.payload_json) as ServerEvent);
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
