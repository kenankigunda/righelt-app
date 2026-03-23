import type { Action } from "../../game-engine/src/types";
import type { ServerEvent } from "../../shared-types/src/events";
import {
  asGameState,
  createInviteToken,
  now,
  type JoinRequest,
  type LiveCommandReceipt,
  type LiveCommandTimelineEntry,
  type LiveGame,
  type Participant,
  type Viewer,
} from "./shell-live-core";

const LIVE_GAMES_TABLE = "live_games";
const LIVE_INVITES_TABLE = "live_invites";
const LIVE_EVENTS_TABLE = "live_events";
const LIVE_PARTICIPANTS_TABLE = "live_participants";
const LIVE_JOIN_REQUESTS_TABLE = "live_join_requests";

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

export type PersistedGameLoadContext = "single" | "list";

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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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

const normalizeRecentCommandReceipts = (value: unknown, mismatches: PersistedGameMismatch[]) => {
  if (!isRecord(value)) {
    if (typeof value !== "undefined") {
      recordMismatch(mismatches, "recentCommandReceipts", "record<string, receipt>", value, "defaulted_to_empty_object");
    }
    return {} as Record<string, LiveCommandReceipt>;
  }
  const entries: Array<[string, LiveCommandReceipt]> = [];
  for (const [clientCommandId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      recordMismatch(mismatches, `recentCommandReceipts.${clientCommandId}`, "receipt", entry, "dropped_invalid_record");
      continue;
    }
    const commandType = entry.commandType === "apply" || entry.commandType === "end-turn" ? entry.commandType : null;
    const delivery = entry.delivery === "new" || entry.delivery === "replayed" ? entry.delivery : "new";
    const status =
      entry.status === "applied" ||
      entry.status === "rejected" ||
      entry.status === "invalid_request" ||
      entry.status === "not_authorized" ||
      entry.status === "conflict" ||
      entry.status === "server_error"
        ? entry.status
        : null;
    if (!commandType || !status || typeof entry.requestId !== "string" || !entry.requestId || typeof entry.resolvedAt !== "string") {
      recordMismatch(mismatches, `recentCommandReceipts.${clientCommandId}`, "valid receipt", entry, "dropped_invalid_record");
      continue;
    }
    const response = isRecord(entry.response) ? entry.response : { ok: false, error: "invalid_receipt_response" };
    entries.push([
      clientCommandId,
      {
        clientCommandId,
        commandType,
        requestId: entry.requestId,
        httpStatus: typeof entry.httpStatus === "number" && Number.isFinite(entry.httpStatus) ? entry.httpStatus : 200,
        delivery,
        status,
        eventSeq: typeof entry.eventSeq === "number" && Number.isFinite(entry.eventSeq) ? entry.eventSeq : 0,
        resolvedAt: entry.resolvedAt,
        response: {
          ok: response.ok === true,
          accepted: typeof response.accepted === "boolean" ? response.accepted : undefined,
          error: typeof response.error === "string" ? response.error : undefined,
          errorCategory:
            response.errorCategory === "validation" ||
            response.errorCategory === "authorization" ||
            response.errorCategory === "conflict" ||
            response.errorCategory === "transport" ||
            response.errorCategory === "server"
              ? response.errorCategory
              : undefined,
          validation: isRecord(response.validation) ? response.validation : null,
          move: isRecord(response.move) ? (response.move as LiveCommandReceipt["response"]["move"]) : null,
          turn: isRecord(response.turn) ? (response.turn as LiveCommandReceipt["response"]["turn"]) : null,
          state: asGameState(response.state),
          legalActions: Array.isArray(response.legalActions) ? (response.legalActions as Action[]) : null,
          removedPieces: Array.isArray(response.removedPieces)
            ? (response.removedPieces as LiveCommandReceipt["response"]["removedPieces"])
            : null,
          game: isRecord(response.game) ? response.game : null,
          eventSeq: typeof response.eventSeq === "number" && Number.isFinite(response.eventSeq) ? response.eventSeq : undefined,
        },
      },
    ]);
  }
  return Object.fromEntries(entries);
};

const normalizeRecentCommandOrder = (
  value: unknown,
  receipts: Record<string, LiveCommandReceipt>,
  mismatches: PersistedGameMismatch[],
) => {
  if (!Array.isArray(value)) {
    if (typeof value !== "undefined") {
      recordMismatch(mismatches, "recentCommandOrder", "string[]", value, "defaulted_from_receipts");
    }
    return Object.keys(receipts);
  }
  const order = value.filter((entry) => typeof entry === "string" && receipts[entry]);
  if (order.length !== value.length) {
    recordMismatch(mismatches, "recentCommandOrder", "string[]", value, "dropped_invalid_entries");
  }
  const missing = Object.keys(receipts).filter((clientCommandId) => !order.includes(clientCommandId));
  return [...order, ...missing];
};

const normalizeCommandTimeline = (value: unknown, mismatches: PersistedGameMismatch[]) => {
  if (!Array.isArray(value)) {
    if (typeof value !== "undefined") {
      recordMismatch(mismatches, "commandTimeline", "timeline_entry[]", value, "defaulted_to_empty_array");
    }
    return [] as LiveCommandTimelineEntry[];
  }
  return value.flatMap((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.clientCommandId !== "string" ||
      typeof entry.commandType !== "string" ||
      typeof entry.requestId !== "string" ||
      typeof entry.event !== "string" ||
      typeof entry.outcome !== "string" ||
      typeof entry.at !== "string"
    ) {
      recordMismatch(mismatches, `commandTimeline.${index}`, "timeline_entry", entry, "dropped_invalid_record");
      return [];
    }
    return [{
      clientCommandId: entry.clientCommandId,
      commandType: entry.commandType === "end-turn" ? "end-turn" : "apply",
      requestId: entry.requestId,
      event: entry.event,
      outcome: entry.outcome,
      reason: typeof entry.reason === "string" ? entry.reason : null,
      validationCode: typeof entry.validationCode === "string" ? entry.validationCode : null,
      eventSeq: typeof entry.eventSeq === "number" && Number.isFinite(entry.eventSeq) ? entry.eventSeq : 0,
      at: entry.at,
    } satisfies LiveCommandTimelineEntry];
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
    console.error(JSON.stringify({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches }));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const mismatches: PersistedGameMismatch[] = [];
  if (!isRecord(parsed)) {
    recordMismatch(mismatches, "game", "object", parsed, "rejected_invalid_projection");
    console.error(JSON.stringify({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches }));
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
    console.error(JSON.stringify({ event: "live_game_shape_invalid", gameId: row.game_id, context, mismatches }));
    return { kind: "invalid", gameId: row.game_id, eventSeq: Number(row.event_seq || 0), mismatches };
  }

  const moves = Array.isArray(parsed.moves) ? (parsed.moves as LiveGame["moves"]) : (recordMismatch(
    mismatches,
    "moves",
    "move[]",
    parsed.moves,
    "defaulted_to_empty_array",
  ), []);
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
  if (Array.isArray(parsed.notifications) && notifications.length !== parsed.notifications.length) {
    recordMismatch(mismatches, "notifications", "string[]", parsed.notifications, "dropped_non_string_entries");
  }
  const recentCommandReceipts = normalizeRecentCommandReceipts(parsed.recentCommandReceipts, mismatches);
  const recentCommandOrder = normalizeRecentCommandOrder(parsed.recentCommandOrder, recentCommandReceipts, mismatches);
  const commandTimeline = normalizeCommandTimeline(parsed.commandTimeline, mismatches);

  const game: LiveGame = {
    id: typeof parsed.id === "string" && parsed.id ? parsed.id : row.game_id,
    createdAt: typeof parsed.createdAt === "string" && parsed.createdAt ? parsed.createdAt : row.created_at || row.updated_at || now(),
    lastMoveAt: typeof parsed.lastMoveAt === "string" ? parsed.lastMoveAt : null,
    updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : row.updated_at || row.created_at || now(),
    playgroundMode: parsed.playgroundMode === true,
    offlineLocal: parsed.offlineLocal === true,
    board: { state: boardState },
    player1: normalizeParticipant(parsed.player1, "player1", mismatches),
    player2: normalizeParticipant(parsed.player2, "player2", mismatches),
    viewers: normalizeViewerList(parsed.viewers, mismatches),
    pendingJoinRequests: normalizeJoinRequests(parsed.pendingJoinRequests, mismatches),
    turns,
    moves,
    historyIndexByIdentity: normalizeHistoryIndexByIdentity(parsed.historyIndexByIdentity, mismatches),
    notifications,
    inviteTokens: normalizeInviteTokens(parsed.inviteTokens, mismatches),
    recentCommandReceipts,
    recentCommandOrder,
    commandTimeline,
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
  if (typeof parsed.playgroundMode !== "boolean") {
    recordMismatch(mismatches, "playgroundMode", "boolean", parsed.playgroundMode, "defaulted_to_false");
  }
  if (typeof parsed.offlineLocal !== "boolean") {
    recordMismatch(mismatches, "offlineLocal", "boolean", parsed.offlineLocal, "defaulted_to_false");
  }

  if (mismatches.length > 0) {
    console.warn(JSON.stringify({ event: "live_game_shape_repaired", gameId: game.id, context, mismatches }));
  }
  return { kind: "ok", game, eventSeq: Number(row.event_seq || 0) };
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

export const listVisibleGameProjections = async (env: LiveGameEnv): Promise<LiveGame[]> => {
  const result = await env.DB.prepare(
    `SELECT game_id, created_at, updated_at, state_json, event_seq FROM ${LIVE_GAMES_TABLE}
     WHERE offline_local = 0
     ORDER BY latest_activity_at DESC, created_at DESC`,
  ).all<PersistedGameRow>();
  return (result.results ?? []).flatMap((row) => {
    const projection = normalizePersistedGame(row, "list");
    return projection.kind === "ok" ? [projection.game] : [];
  });
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
        `INSERT INTO ${LIVE_INVITES_TABLE} (token, game_id, shared_by_role, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(token) DO UPDATE SET
           game_id = excluded.game_id,
           shared_by_role = excluded.shared_by_role,
           created_at = excluded.created_at`,
      )
        .bind(token, game.id, sharedByRole, game.createdAt)
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

export const replaceParticipants = async (env: LiveGameEnv, game: LiveGame) => {
  await env.DB.prepare(`DELETE FROM ${LIVE_PARTICIPANTS_TABLE} WHERE game_id = ?1`).bind(game.id).run();
  const participants = [
    game.player1 ? { role: "Player 1", participant: game.player1 } : null,
    game.player2 ? { role: "Player 2", participant: game.player2 } : null,
    ...game.viewers.map((participant) => ({ role: "Viewer" as const, participant })),
  ].filter(Boolean) as Array<{ role: "Player 1" | "Player 2" | "Viewer"; participant: LiveGame["player1"] & { identityId: string } }>;

  await Promise.all(
    participants.map(({ role, participant }) =>
      env.DB.prepare(
        `INSERT INTO ${LIVE_PARTICIPANTS_TABLE}
           (game_id, identity_id, role, joined_at, last_heartbeat_at, connected, session_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
        .bind(
          game.id,
          participant.identityId,
          role,
          participant.joinedAt,
          participant.lastHeartbeatAt,
          participant.connected ? 1 : 0,
          participant.sessionCount,
        )
        .run(),
    ),
  );
};

export const replaceJoinRequests = async (env: LiveGameEnv, game: LiveGame) => {
  await env.DB.prepare(`DELETE FROM ${LIVE_JOIN_REQUESTS_TABLE} WHERE game_id = ?1`).bind(game.id).run();
  await Promise.all(
    game.pendingJoinRequests.map((request: JoinRequest) =>
      env.DB.prepare(
        `INSERT INTO ${LIVE_JOIN_REQUESTS_TABLE}
           (game_id, requester_identity_id, requested_seat, source, status, requested_at, resolved_at, resolved_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(
          game.id,
          request.identityId,
          request.requestedSeat,
          request.source,
          request.status ?? "pending",
          request.requestedAt,
          request.resolvedAt ?? null,
          request.resolvedBy ?? null,
        )
        .run(),
    ),
  );
};

export const appendEvent = async (env: LiveGameEnv, gameId: string, event: ServerEvent & { eventSeq: number }) => {
  await env.DB.prepare(
    `INSERT INTO ${LIVE_EVENTS_TABLE}
       (game_id, event_seq, event_type, actor_identity_id, created_at, payload_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(
      gameId,
      event.eventSeq,
      event.type,
      "identityId" in event ? event.identityId : "requesterIdentityId" in event ? event.requesterIdentityId : null,
      new Date().toISOString(),
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
  await replaceParticipants(env, game);
  await replaceJoinRequests(env, game);
  if (event) {
    await appendEvent(env, game.id, event);
  }
};
