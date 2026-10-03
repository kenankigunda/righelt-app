const normalizeQuery = (query) => String(query).replace(/\s+/g, " ").trim();

export const createFakeD1 = () => {
  const shellGames = new Map();
  const shellInvites = new Map();
  const shellEvents = new Map();
  const receipts = new Map();
  const tombstones = new Map();
  const executors = new WeakMap();
  let batchFailureIndex = null;
  let loseBatchResponse = false;
  const nextGameReadOverrideById = new Map();
  let selectGameByIdCount = 0;
  const writes = [];
  const reads = [];

  const hasSmokeIdentity = (game) =>
    game?.player1?.identityId === "smoke-player" ||
    game?.player2?.identityId === "smoke-player" ||
    (Array.isArray(game?.viewers) && game.viewers.some((viewer) => viewer?.identityId === "smoke-player")) ||
    (Array.isArray(game?.pendingJoinRequests) &&
      game.pendingJoinRequests.some((request) => request?.identityId === "smoke-player"));

  const toStoredRow = ({ gameId, createdAt, updatedAt, latestActivityAt, player1IdentityId, player2IdentityId, hasSmoke, stateJson, eventSeq }) => {
    const parsed = typeof stateJson === "string" ? JSON.parse(stateJson) : null;
    return {
      game_id: gameId,
      created_at: createdAt,
      updated_at: updatedAt,
      latest_activity_at: latestActivityAt,
      player1_identity_id: player1IdentityId ?? parsed?.player1?.identityId ?? null,
      player2_identity_id: player2IdentityId ?? parsed?.player2?.identityId ?? null,
      has_smoke_identity: typeof hasSmoke === "number" ? hasSmoke : hasSmokeIdentity(parsed) ? 1 : 0,
      state_json: stateJson,
      event_seq: eventSeq,
    };
  };

  const sortRows = (rows) =>
    rows.sort((left, right) => {
      if (left.latest_activity_at !== right.latest_activity_at) {
        return right.latest_activity_at.localeCompare(left.latest_activity_at);
      }
      return right.created_at.localeCompare(left.created_at);
    });

  const filterRowsForHomeQuery = (normalized, params) => {
    const rows = [...shellGames.values()];
    if (normalized.includes("WHERE has_smoke_identity = 1")) {
      return rows.filter((row) => row.has_smoke_identity === 1);
    }
    if (normalized.includes("WHERE (COALESCE(player1_identity_id, '') = ?1 OR COALESCE(player2_identity_id, '') = ?1)")) {
      const identityId = params[0];
      return rows.filter(
        (row) =>
          row.has_smoke_identity === 0 &&
          (row.player1_identity_id === identityId || row.player2_identity_id === identityId),
      );
    }
    if (normalized.includes("WHERE NOT (COALESCE(player1_identity_id, '') = ?1 OR COALESCE(player2_identity_id, '') = ?1)")) {
      const identityId = params[0];
      return rows.filter(
        (row) =>
          row.has_smoke_identity === 0 &&
          row.player1_identity_id !== identityId &&
          row.player2_identity_id !== identityId,
      );
    }
    return rows;
  };

  const prepare = (query) => {
    const normalized = normalizeQuery(query);
    let params = [];

    const statement = {
      bind(...values) {
        params = values;
        return statement;
      },
      executeRun() {
        writes.push({ query: normalized, params: [...params] });

        if (normalized.includes("INSERT INTO live_games")) {
          const [gameId, createdAt, updatedAt, latestActivityAt, player1IdentityId, player2IdentityId, hasSmoke, stateJson, eventSeq = 0, gameplayRevision = 0, commitBaseEventSeq = null] =
            params;
          const old = shellGames.get(gameId);
          if (!old && commitBaseEventSeq !== null && commitBaseEventSeq !== 0) throw new Error("missing_game_revision");
          if (old && commitBaseEventSeq !== null && (commitBaseEventSeq !== old.event_seq || eventSeq <= old.event_seq || gameplayRevision < (old.gameplay_revision ?? 0))) throw new Error("stale_game_revision");
          shellGames.set(
            gameId,
            toStoredRow({
              gameId,
              createdAt,
              updatedAt,
              latestActivityAt,
              player1IdentityId,
              player2IdentityId,
              hasSmoke,
              stateJson,
              eventSeq,
            }),
          );
          Object.assign(shellGames.get(gameId), { gameplay_revision: gameplayRevision, commit_base_event_seq: commitBaseEventSeq });
          return { success: true };
        }

        if (normalized.includes("INSERT INTO live_command_receipts")) {
          const [gameId, commandId, actor, fingerprint, outcome, reason, eventSeq, gameplayRevision, resultJson = null] = params;
          const key = JSON.stringify([gameId, commandId]);
          if (receipts.has(key)) throw new Error("UNIQUE constraint failed: live_command_receipts");
          if (!["accepted", "rejected"].includes(outcome)) throw new Error("CHECK constraint failed: outcome");
          receipts.set(key, { game_id: gameId, client_command_id: commandId, actor_identity_id: actor, fingerprint, outcome, reason, event_seq: eventSeq, gameplay_revision: gameplayRevision, result_json: resultJson });
          return { success: true };
        }
        if (normalized.includes("INSERT INTO live_legacy_command_tombstones")) {
          const [gameId, commandId, evidenceJson] = params;
          const key = JSON.stringify([gameId, commandId]);
          if (tombstones.has(key)) throw new Error("UNIQUE constraint failed: live_legacy_command_tombstones");
          tombstones.set(key, { game_id: gameId, client_command_id: commandId, evidence_json: evidenceJson });
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
          if (current.some((row) => row.event_seq === eventSeq)) throw new Error("UNIQUE constraint failed: live_events");
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
      async run() { return statement.executeRun(); },
      async first() {
        reads.push({ query: normalized, params: [...params] });
        if (normalized.includes("FROM live_command_receipts")) return structuredClone(receipts.get(JSON.stringify(params.slice(0, 2))) ?? null);
        if (normalized.includes("FROM live_legacy_command_tombstones")) return structuredClone(tombstones.get(JSON.stringify(params.slice(0, 2))) ?? null);

        if (
          normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq FROM live_games WHERE game_id = ?1") ||
          normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq, gameplay_revision FROM live_games WHERE game_id = ?1") ||
          normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq, gameplay_revision, ownership_mode FROM live_games WHERE game_id = ?1") ||
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
                  gameplay_revision: row.gameplay_revision ?? 0,
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
                gameplay_revision: row.gameplay_revision ?? 0,
              }
            : null;
        }

        if (normalized.includes("SELECT game_id, shared_by_role FROM live_invites WHERE token = ?1")) {
          const row = shellInvites.get(params[0]);
          return row ? { game_id: row.game_id, shared_by_role: row.shared_by_role } : null;
        }

        if (normalized.includes("SELECT COUNT(*) AS total_games FROM live_games")) {
          return { total_games: filterRowsForHomeQuery(normalized, params).length };
        }

        throw new Error(`Unsupported first query: ${normalized}`);
      },
      async all() {
        reads.push({ query: normalized, params: [...params] });

        if (normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq FROM live_games") || normalized.includes("SELECT game_id, created_at, updated_at, state_json, event_seq, gameplay_revision FROM live_games")) {
          const rows = sortRows(filterRowsForHomeQuery(normalized, params));
          const limitIndex = normalized.includes("LIMIT ?") ? params.length - 2 : null;
          const offsetIndex = normalized.includes("OFFSET ?") ? params.length - 1 : null;
          const limit = limitIndex === null ? rows.length : Number(params[limitIndex]);
          const offset = offsetIndex === null ? 0 : Number(params[offsetIndex]);
          const results = rows
            .slice(offset, offset + limit)
            .map((row) => ({
              game_id: row.game_id,
              created_at: row.created_at,
              updated_at: row.updated_at,
              state_json: row.state_json,
              event_seq: row.event_seq ?? 0,
              gameplay_revision: row.gameplay_revision ?? 0,
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

    executors.set(statement, () => statement.executeRun());
    return statement;
  };

  return {
    prepare,
    async batch(statements) {
      // Execute synchronously so reads cannot observe intermediate statements.
      const tables = [shellGames, shellInvites, shellEvents, receipts, tombstones];
      const snapshots = tables.map((table) => structuredClone(table));
      const failAt = batchFailureIndex;
      batchFailureIndex = null;
      let results;
      try {
        results = statements.map((statement, index) => {
          if (index === failAt) throw new Error(`Injected batch failure at statement ${index}`);
          const execute = executors.get(statement);
          if (!execute) throw new Error("Statement belongs to another database");
          return execute();
        });
      } catch (error) {
        tables.forEach((table, index) => { table.clear(); for (const [key, value] of snapshots[index]) table.set(key, value); });
        throw error;
      }
      if (loseBatchResponse) { loseBatchResponse = false; throw new Error("Lost batch response after commit"); }
      return results;
    },
    failNextBatchAt(index) { batchFailureIndex = index; },
    loseNextBatchResponse() { loseBatchResponse = true; },
    getReceipt(gameId, commandId) { return structuredClone(receipts.get(JSON.stringify([gameId, commandId])) ?? null); },
    getTombstone(gameId, commandId) { return structuredClone(tombstones.get(JSON.stringify([gameId, commandId])) ?? null); },
    getInvite(token) { return structuredClone(shellInvites.get(token) ?? null); },
    reset() {
      shellGames.clear();
      shellInvites.clear();
      shellEvents.clear();
      receipts.clear();
      tombstones.clear();
      batchFailureIndex = null;
      loseBatchResponse = false;
      nextGameReadOverrideById.clear();
      selectGameByIdCount = 0;
      writes.length = 0;
      reads.length = 0;
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
      row.player1_identity_id = next.player1?.identityId ?? null;
      row.player2_identity_id = next.player2?.identityId ?? null;
      row.has_smoke_identity = hasSmokeIdentity(next) ? 1 : 0;
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
    getReads() {
      return structuredClone(reads);
    },
    getStats() {
      return {
        selectGameByIdCount,
      };
    },
  };
};
