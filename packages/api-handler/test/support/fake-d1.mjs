const normalizeQuery = (query) => String(query).replace(/\s+/g, " ").trim();

export const createFakeD1 = () => {
  const shellGames = new Map();
  const shellInvites = new Map();
  const shellEvents = new Map();
  const nextGameReadOverrideById = new Map();
  let selectGameByIdCount = 0;
  const writes = [];

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
          const [gameId, createdAt, updatedAt, latestActivityAt, offlineLocal, stateJson, eventSeq = 0] = params;
          shellGames.set(gameId, {
            game_id: gameId,
            created_at: createdAt,
            updated_at: updatedAt,
            latest_activity_at: latestActivityAt,
            offline_local: offlineLocal,
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
      writes.length = 0;
    },
    overwriteGameState(gameId, update) {
      const row = shellGames.get(gameId);
      if (!row || typeof row.state_json !== "string") {
        return false;
      }
      const parsed = JSON.parse(row.state_json);
      const next = update(parsed);
      row.state_json = JSON.stringify(next);
      row.updated_at = next.updatedAt || row.updated_at;
      row.latest_activity_at = next.lastMoveAt || next.updatedAt || next.createdAt || row.latest_activity_at;
      row.event_seq = next.eventSeq || row.event_seq || 0;
      shellGames.set(gameId, row);
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
      };
    },
  };
};
