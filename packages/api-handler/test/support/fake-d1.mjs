const normalizeQuery = (query) => String(query).replace(/\s+/g, " ").trim();

export const createFakeD1 = () => {
  const shellGames = new Map();
  const shellInvites = new Map();
  let selectGameByIdCount = 0;

  const prepare = (query) => {
    const normalized = normalizeQuery(query);
    let params = [];

    const statement = {
      bind(...values) {
        params = values;
        return statement;
      },
      async run() {
        if (normalized === "INSERT INTO milestone_actions (message) VALUES (?1)") {
          return { success: true, meta: { last_row_id: 1 } };
        }

        if (normalized.includes("INSERT INTO shell_live_games")) {
          const [gameId, createdAt, updatedAt, latestActivityAt, offlineLocal, stateJson] = params;
          shellGames.set(gameId, {
            game_id: gameId,
            created_at: createdAt,
            updated_at: updatedAt,
            latest_activity_at: latestActivityAt,
            offline_local: offlineLocal,
            state_json: stateJson,
          });
          return { success: true };
        }

        if (normalized.includes("INSERT INTO shell_live_invites")) {
          const [token, gameId, sharedByRole, createdAt] = params;
          shellInvites.set(token, {
            token,
            game_id: gameId,
            shared_by_role: sharedByRole,
            created_at: createdAt,
          });
          return { success: true };
        }

        throw new Error(`Unsupported run query: ${normalized}`);
      },
      async first() {
        if (normalized.includes("SELECT state_json FROM shell_live_games WHERE game_id = ?1")) {
          selectGameByIdCount += 1;
          const row = shellGames.get(params[0]);
          return row ? { state_json: row.state_json } : null;
        }

        if (normalized.includes("SELECT game_id, shared_by_role FROM shell_live_invites WHERE token = ?1")) {
          const row = shellInvites.get(params[0]);
          return row ? { game_id: row.game_id, shared_by_role: row.shared_by_role } : null;
        }

        throw new Error(`Unsupported first query: ${normalized}`);
      },
      async all() {
        if (
          normalized.includes("SELECT state_json FROM shell_live_games") &&
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
            .map((row) => ({ state_json: row.state_json }));
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
      selectGameByIdCount = 0;
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
      shellGames.set(gameId, row);
      return true;
    },
    getStats() {
      return {
        selectGameByIdCount,
      };
    },
  };
};
