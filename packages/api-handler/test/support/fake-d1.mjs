const normalizeQuery = (query) => String(query).replace(/\s+/g, " ").trim();

export const createFakeD1 = () => {
  const shellGames = new Map();
  const shellInvites = new Map();
  const shellEvents = new Map();
  const nextGameReadOverrideById = new Map();
  let selectGameByIdCount = 0;
  let selectPagedGameIdsCount = 0;
  let countPagedGamesCount = 0;
  const writes = [];

  const summarizeState = (state) => {
    const player1IdentityId = typeof state?.player1?.identityId === "string" && state.player1.identityId ? state.player1.identityId : null;
    const player2IdentityId = typeof state?.player2?.identityId === "string" && state.player2.identityId ? state.player2.identityId : null;
    const hasSmokePlayer = Boolean(
      player1IdentityId === "smoke-player" ||
        player2IdentityId === "smoke-player" ||
        (Array.isArray(state?.viewers) && state.viewers.some((viewer) => viewer?.identityId === "smoke-player")) ||
        (Array.isArray(state?.pendingJoinRequests) &&
          state.pendingJoinRequests.some((request) => request?.identityId === "smoke-player")),
    );
    return {
      player1_identity_id: player1IdentityId,
      player2_identity_id: player2IdentityId,
      has_smoke_player: hasSmokePlayer ? 1 : 0,
    };
  };

  const getRowSummary = (row) => {
    const parsed = typeof row.state_json === "string" ? JSON.parse(row.state_json) : {};
    const fallback = summarizeState(parsed);
    return {
      player1_identity_id: row.player1_identity_id ?? fallback.player1_identity_id,
      player2_identity_id: row.player2_identity_id ?? fallback.player2_identity_id,
      has_smoke_player: row.has_smoke_player ?? fallback.has_smoke_player,
    };
  };

  const getPagedSectionConfig = (normalized, params) => {
    if (normalized.includes("WHERE 1 = 0")) {
      return { identityId: null, includeMine: null, includeSmoke: null, alwaysEmpty: true };
    }
    if (!normalized.includes("OR COALESCE(player2_identity_id")) {
      return { identityId: null, includeMine: null, includeSmoke: true, alwaysEmpty: false };
    }
    const identityId = params[0];
    const includeMine = normalized.includes(") = 0 AND") ? false : true;
    const includeSmoke = normalized.includes("AND 1 = 1") ? null : false;
    return { identityId, includeMine, includeSmoke, alwaysEmpty: false };
  };

  const filterPagedRows = ({ identityId, includeMine, includeSmoke }) =>
    [...shellGames.values()]
      .filter((row) => row.offline_local === 0)
      .filter((row) => {
        const summary = getRowSummary(row);
        const isMine = summary.player1_identity_id === identityId || summary.player2_identity_id === identityId;
        const isSmoke = summary.has_smoke_player === 1;
        if (includeMine === true && !isMine) {
          return false;
        }
        if (includeMine === false && isMine) {
          return false;
        }
        if (includeSmoke === true) {
          return isSmoke;
        }
        if (includeSmoke === false && isSmoke) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (left.latest_activity_at !== right.latest_activity_at) {
          return right.latest_activity_at.localeCompare(left.latest_activity_at);
        }
        return right.created_at.localeCompare(left.created_at);
      });

  const prepare = (query) => {
    const normalized = normalizeQuery(query);
    let params = [];

    const statement = {
      bind(...values) {
        params = values;
        return statement;
      },
      async run() {
        writes.push({ query: normalized, params: [...params] });

        if (normalized.includes("INSERT INTO live_games")) {
          const [gameId, createdAt, updatedAt, latestActivityAt, offlineLocal, player1IdentityId, player2IdentityId, hasSmokePlayer, stateJson, eventSeq = 0] =
            params;
          shellGames.set(gameId, {
            game_id: gameId,
            created_at: createdAt,
            updated_at: updatedAt,
            latest_activity_at: latestActivityAt,
            offline_local: offlineLocal,
            player1_identity_id: player1IdentityId,
            player2_identity_id: player2IdentityId,
            has_smoke_player: hasSmokePlayer,
            state_json: stateJson,
            event_seq: eventSeq,
          });
          return { success: true };
        }

        if (normalized.includes("INSERT INTO live_invites")) {
          const [token, gameId, sharedByRole] = params;
          shellInvites.set(token, {
            token,
            game_id: gameId,
            shared_by_role: sharedByRole,
          });
          return { success: true };
        }

        if (normalized.includes("INSERT INTO live_events")) {
          const [gameId, eventSeq, payloadJson] = params;
          const current = shellEvents.get(gameId) ?? [];
          current.push({
            game_id: gameId,
            event_seq: eventSeq,
            payload_json: payloadJson,
          });
          current.sort((left, right) => left.event_seq - right.event_seq);
          shellEvents.set(gameId, current);
          return { success: true };
        }

        throw new Error(`Unsupported run query: ${normalized}`);
      },
      async first() {
        if (normalized.includes("SELECT COUNT(*) AS total_games FROM live_games")) {
          countPagedGamesCount += 1;
          const config = getPagedSectionConfig(normalized, params);
          if (config.alwaysEmpty) {
            return { total_games: 0 };
          }
          const rows = filterPagedRows(config);
          return { total_games: rows.length };
        }

        if (
          normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq FROM live_games WHERE game_id = ?1") ||
          normalized.includes("SELECT state_json, event_seq FROM live_games WHERE game_id = ?1")
        ) {
          selectGameByIdCount += 1;
          const gameId = params[0];
          const override = nextGameReadOverrideById.get(gameId);
          if (override) {
            nextGameReadOverrideById.delete(gameId);
            const row = shellGames.get(gameId);
            return row
              ? {
                  game_id: row.game_id,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                  state_json: JSON.stringify(override),
                  event_seq: row.event_seq ?? 0,
                }
              : null;
          }
          const row = shellGames.get(gameId);
          return row
            ? {
                game_id: row.game_id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                state_json: row.state_json,
                event_seq: row.event_seq ?? 0,
              }
            : null;
        }

        if (normalized.includes("SELECT game_id, shared_by_role FROM live_invites WHERE token = ?1")) {
          const row = shellInvites.get(params[0]);
          return row ? { game_id: row.game_id, shared_by_role: row.shared_by_role } : null;
        }

        throw new Error(`Unsupported first query: ${normalized}`);
      },
      async all() {
        if (
          (normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq FROM live_games") ||
            normalized.includes("SELECT state_json FROM live_games")) &&
          normalized.includes("WHERE offline_local = 0")
        ) {
          const results = [...shellGames.values()]
            .filter((row) => row.offline_local === 0)
            .sort((left, right) => {
              if (left.latest_activity_at !== right.latest_activity_at) {
                return right.latest_activity_at.localeCompare(left.latest_activity_at);
              }
              return right.created_at.localeCompare(left.created_at);
            })
            .map((row) => ({
              game_id: row.game_id,
              created_at: row.created_at,
              updated_at: row.updated_at,
              state_json: row.state_json,
              event_seq: row.event_seq ?? 0,
            }));
          return { results };
        }

        if (normalized.includes("SELECT game_id FROM live_games")) {
          selectPagedGameIdsCount += 1;
          const config = getPagedSectionConfig(normalized, params);
          const limit = Number(params[params.length - 2]);
          const offset = Number(params[params.length - 1]);
          const rows = config.alwaysEmpty ? [] : filterPagedRows(config);
          return {
            results: rows.slice(offset, offset + limit).map((row) => ({
              game_id: row.game_id,
            })),
          };
        }

        if (normalized.includes("SELECT payload_json FROM live_events")) {
          const [gameId, lastEventSeq] = params;
          const results = (shellEvents.get(gameId) ?? [])
            .filter((row) => row.event_seq > lastEventSeq)
            .sort((left, right) => left.event_seq - right.event_seq)
            .map((row) => ({ payload_json: row.payload_json }));
          return { results };
        }

        throw new Error(`Unsupported all query: ${normalized}`);
      },
    };

    return statement;
  };

  return {
    prepare,
    reset() {
      shellGames.clear();
      shellInvites.clear();
      shellEvents.clear();
      nextGameReadOverrideById.clear();
      selectGameByIdCount = 0;
      selectPagedGameIdsCount = 0;
      countPagedGamesCount = 0;
      writes.length = 0;
    },
    overwriteGameState(gameId, update) {
      const row = shellGames.get(gameId);
      if (!row || typeof row.state_json !== "string") {
        return false;
      }
      const parsed = JSON.parse(row.state_json);
      const next = update(parsed);
      const summary = summarizeState(next);
      row.state_json = JSON.stringify(next);
      row.updated_at = next.updatedAt || row.updated_at;
      row.latest_activity_at = next.lastMoveAt || next.updatedAt || next.createdAt || row.latest_activity_at;
      row.event_seq = next.eventSeq || row.event_seq || 0;
      row.player1_identity_id = summary.player1_identity_id;
      row.player2_identity_id = summary.player2_identity_id;
      row.has_smoke_player = summary.has_smoke_player;
      shellGames.set(gameId, row);
      return true;
    },
    overwriteGameRow(gameId, update) {
      const row = shellGames.get(gameId);
      if (!row) {
        return false;
      }
      shellGames.set(gameId, update(structuredClone(row)));
      return true;
    },
    setNextGameReadOverride(gameId, state) {
      nextGameReadOverrideById.set(gameId, structuredClone(state));
    },
    getGameState(gameId) {
      const row = shellGames.get(gameId);
      if (!row || typeof row.state_json !== "string") {
        return null;
      }
      return JSON.parse(row.state_json);
    },
    getEvents(gameId) {
      return structuredClone(shellEvents.get(gameId) ?? []);
    },
    getWrites() {
      return structuredClone(writes);
    },
    getStats() {
      return {
        selectGameByIdCount,
        selectPagedGameIdsCount,
        countPagedGamesCount,
      };
    },
  };
};
