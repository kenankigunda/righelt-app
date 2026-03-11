import type { ServerEvent } from "../../shared-types/src/events";
import type { JoinRequest, LiveGame } from "./shell-live-core";

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

export const loadGameProjection = async (env: LiveGameEnv, gameId: string): Promise<{ game: LiveGame; eventSeq: number } | null> => {
  const row = await env.DB.prepare(
    `SELECT state_json, event_seq FROM ${LIVE_GAMES_TABLE} WHERE game_id = ?1`,
  )
    .bind(gameId)
    .first<{ state_json: string; event_seq: number }>();
  if (!row?.state_json) {
    return null;
  }
  return {
    game: JSON.parse(row.state_json) as LiveGame,
    eventSeq: Number(row.event_seq || 0),
  };
};

export const listVisibleGameProjections = async (env: LiveGameEnv): Promise<LiveGame[]> => {
  const result = await env.DB.prepare(
    `SELECT state_json FROM ${LIVE_GAMES_TABLE}
     WHERE offline_local = 0
     ORDER BY latest_activity_at DESC, created_at DESC`,
  ).all<{ state_json: string }>();
  return (result.results ?? []).map((row) => JSON.parse(row.state_json) as LiveGame);
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
