import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { commandFingerprint } from "../../../apps/web/generated/packages/shared-types/src/sync-protocol.js";
const require = createRequire(import.meta.url),
  wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare"),
  { build } = wranglerRequire("esbuild");
const root = path.resolve(import.meta.dirname, "../../..");
const source = `import { GameRoomDO as Actual } from "./packages/api-handler/src/game-room-do.ts";
import { handleApiRequest } from "./packages/api-handler/src/index.ts";
export class GameRoomDO extends Actual {
  constructor(state, env) {
    let revoke = null;
    super(state, {
      ...env,
      DB: {
        prepare: (...a) => env.DB.prepare(...a),
        batch: async (statements) => {
          if (revoke) {
            await env.DB.prepare(
              "UPDATE account_sessions SET revoked_at=1 WHERE token_hash=?",
            )
              .bind(revoke)
              .run();
            revoke = null;
          }
          return env.DB.batch(statements);
        },
      },
    });
    this.revoke = (v) => (revoke = v);
  }
  async fetch(request) {
    if (request.headers.has("x-test-restore")) {
      this.sessions.clear();
      this.restoreSessionsFromState();
    }
    if (request.headers.has("x-test-revoke"))
      this.revoke(request.headers.get("x-test-revoke"));
    const response = await super.fetch(request);
    if (request.headers.has("x-test-restore"))
      return Response.json({
        ...(await response.json()),
        harnessSessions: [...this.sessions.values()].map(
          (s) => s.authority?.tokenHash ?? null,
        ),
        harnessSockets: this.state
          .getWebSockets()
          .map((s) => ({
            hash: s.deserializeAttachment()?.authority?.tokenHash ?? null,
            state: s.readyState,
          })),
      });
    return response;
  }
}
export class RollbackRoom extends Actual {
  constructor(state, env) {
    super(state, { ...env, AUTH_ENABLED: "false" });
  }
}
export default {
  fetch(request, env) {
    if (request.headers.has("x-test-revoke-after-read")) {
      const original = env.DB;
      env = {
        ...env,
        DB: {
          prepare(sql) {
            const statement = original.prepare(sql);
            if (!sql.includes("FROM live_games WHERE")) return statement;
            return {
              bind(...args) {
                const bound = statement.bind(...args);
                return {
                  async first() {
                    const result = await bound.first();
                    await original
                      .prepare(
                        "UPDATE account_sessions SET revoked_at=1 WHERE token_hash=?",
                      )
                      .bind(request.headers.get("x-test-revoke-after-read"))
                      .run();
                    return result;
                  },
                };
              },
            };
          },
        },
      };
    }
    if (request.headers.has("x-test-disabled"))
      env = { ...env, AUTH_ENABLED: "false", GAME_ROOMS: env.ROLLBACK_ROOMS };
    if (new URL(request.url).pathname.startsWith("/direct/"))
      return env.GAME_ROOMS.get(
        env.GAME_ROOMS.idFromName(request.headers.get("x-game-id")),
      ).fetch(new Request(request.url.replace("/direct/", "/"), request));
    return handleApiRequest(request, env);
  },
};
`;
const eventually = async (fn, attempts = 150) => {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("condition deadline");
};
test(
  "account authority persists across browsers, rejects spoofing and revocation, and protects legacy games",
  { timeout: 120000 },
  async () => {
    const bundle = await build({
      stdin: { contents: source, resolveDir: root },
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
    });
    const runtime = new Miniflare({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-03-12",
        d1Databases: ["DB"],
        durableObjects: {
          GAME_ROOMS: { className: "GameRoomDO", useSQLite: true },
          ROLLBACK_ROOMS: { className: "RollbackRoom", useSQLite: true },
        },
        bindings: {
          AUTH_ENABLED: "true",
          AUTH_ALLOWED_ORIGINS: "https://test",
        },
      }),
      sockets = [];
    try {
      const db = await runtime.getD1Database("DB");
      for (const name of (await readdir(path.join(root, "db/migrations")))
        .filter((n) => n.endsWith(".sql"))
        .sort())
        await db.exec(
          (await readFile(path.join(root, "db/migrations", name), "utf8"))
            .replace(/--[^\n]*/g, "")
            .replace(/\s+/g, " "),
        );
      const seed = async (id, n, ack = 1) => {
        const token = String(n).repeat(64),
          context = String(n + 4).repeat(64),
          hash = createHash("sha256").update(token).digest("hex"),
          now = Date.now();
        await db
          .prepare(
            "INSERT OR IGNORE INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash,recovery_hash,recovery_acknowledged) VALUES(?,?,?,?,?,?,?,?)",
          )
          .bind(id, id, id, id, now, "synthetic", "f".repeat(64), ack)
          .run();
        await db
          .prepare("INSERT INTO account_sessions VALUES(?,?,1,?,?,?,?,NULL)")
          .bind(hash, id, context, now, now, now + 86400000)
          .run();
        return { id, token, context, hash };
      };
      const a = await seed("alice", 1),
        a2 = await seed("alice", 2),
        b = await seed("bobby", 3);
      const headers = (actor) => ({
        Origin: "https://test",
        "Content-Type": "application/json",
        "X-Righelt-Auth": "1",
        "X-Righelt-Auth-Version": "1",
        ...(actor
          ? {
              Cookie: `__Host-righelt_session=${actor.token}`,
              "X-Righelt-Session": actor.context,
            }
          : {}),
      });
      const call = async (route, actor, body, extra = {}) => {
        const response = await runtime.dispatchFetch(`https://test${route}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { ...headers(actor), ...extra },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          body: await response.json(),
          headers: response.headers,
        };
      };
      const create = await call(
        "/direct/create",
        a,
        { gameId: "g", selfPlayMode: true },
        { "x-game-id": "g" },
      );
      assert.equal(create.status, 200, JSON.stringify(create.body));
      assert.equal(create.body.game.ownershipMode, "account_v1");
      assert.equal(create.body.game.inviteTokens, undefined);
      const state = () =>
        db.prepare("SELECT * FROM live_games WHERE game_id='g'").first();
      const read = await call("/api/shell/games/g?identityId=bobby", a2);
      assert.equal(read.status, 200);
      assert.ok(read.body.game.myRoles.includes("Player 1"));
      const anon = await call("/api/shell/games/g?identityId=alice", null);
      assert.equal(anon.body.game.inviteToken, null);
      assert.deepEqual(anon.body.game.legalActions, []);
      assert.equal(anon.body.game.canRecordMove, false);
      assert.equal(
        (
          await call(
            "/direct/join",
            b,
            { identityId: "alice", mode: "viewer" },
            { "x-game-id": "g" },
          )
        ).status,
        403,
      );
      for (const [extra, status] of [
        [{ "X-Righelt-Auth-Version": "" }, 426],
        [{ Origin: "https://foreign.test" }, 403],
        [{ "X-Righelt-Session": b.context }, 409],
        [{ "X-Righelt-Auth": "" }, 403],
      ]) {
        const denied = await call(
          "/direct/live",
          a,
          {},
          { "x-game-id": "g", ...extra },
        );
        assert.equal(denied.status, status);
      }
      const anonymousWrite = await call(
        "/direct/live",
        null,
        { identityId: "alice" },
        { "x-game-id": "g" },
      );
      assert.equal(anonymousWrite.status, 401);
      const guardedRoutes = [
        "join",
        "approve",
        "moves",
        "apply",
        "end-turn",
        "history",
        "live",
        "play-as-both",
        "presence",
        "revert-request",
        "revert-approve",
        "revert-reject",
        "revert-rescind",
        "reconcile",
        "legal",
        "piece-moves",
      ];
      const spoofSnapshot = async () => {
        const result = {};
        for (const table of [
          "live_games",
          "live_events",
          "live_invites",
          "live_command_receipts",
          "account_sessions",
        ])
          result[table] = (
            await db.prepare(`SELECT * FROM ${table}`).all()
          ).results;
        return result;
      };
      const beforeSpoof = await spoofSnapshot();
      for (const route of [
        ...guardedRoutes.map((name) => `/direct/${name}`),
        ...guardedRoutes.map((name) => `/api/shell/games/g/${name}`),
        "/direct/create",
        "/direct/create-from-scenario",
        "/direct/load-scenario",
        "/api/shell/games",
        "/api/shell/scenarios/import",
        "/api/shell/history/branch",
      ]) {
        const denied = await call(
          route,
          b,
          { identityId: "alice", protocolVersion: 2 },
          { "x-game-id": "g" },
        );
        assert.equal(denied.status, 403, route);
        assert.equal(denied.body.error, "identity_mismatch", route);
      }
      assert.deepEqual(
        await spoofSnapshot(),
        beforeSpoof,
        "spoofed actor never reaches writes or renews sessions",
      );
      const legacy = JSON.parse((await state()).state_json);
      legacy.id = "legacy";
      delete legacy.ownershipMode;
      await db
        .prepare(
          "INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,state_json,event_seq,gameplay_revision,ownership_mode) VALUES(?1,?2,?3,?3,?4,0,0,'legacy_guest')",
        )
        .bind(
          "legacy",
          legacy.createdAt,
          legacy.updatedAt,
          JSON.stringify(legacy),
        )
        .run();
      const old = await call("/api/shell/games/legacy?identityId=alice", a);
      assert.equal(old.body.game.canRecordMove, false);
      assert.equal(old.body.game.inviteToken, null);
      assert.equal(
        (
          await call(
            "/direct/history",
            a,
            { moveIndex: 0 },
            { "x-game-id": "legacy" },
          )
        ).body.error,
        "legacy_read_only",
      );
      const row = await state(),
        command = {
          protocolVersion: 2,
          gameId: "g",
          identityId: "alice",
          authContextId: a.context,
          clientCommandId: "v2:auth-move",
          kind: "move",
          payload: {},
          expectedState: JSON.parse(row.state_json).board.state,
          expectedGameplayRevision: row.gameplay_revision,
        };
      command.fingerprint = await commandFingerprint(command);
      const moved = await call("/direct/moves", a, command, {
        "x-game-id": "g",
      });
      assert.equal(
        moved.body.commandOutcomes?.[0]?.outcome,
        "accepted",
        JSON.stringify(moved.body),
      );
      const rollback = JSON.parse((await state()).state_json);
      rollback.id = "rollback";
      delete rollback.ownershipMode;
      await db
        .prepare(
          "INSERT INTO live_games(game_id,created_at,updated_at,latest_activity_at,state_json,event_seq,gameplay_revision,ownership_mode) VALUES(?1,?2,?3,?3,?4,0,0,'account_v1')",
        )
        .bind(
          "rollback",
          rollback.createdAt,
          rollback.updatedAt,
          JSON.stringify(rollback),
        )
        .run();
      const rollbackRead = await call(
        "/api/shell/games/rollback?identityId=alice",
        null,
        undefined,
        { "x-test-disabled": "1" },
      );
      assert.equal(rollbackRead.body.game.canRecordMove, false);
      assert.equal(rollbackRead.body.game.inviteToken, null);
      assert.equal(
        (
          await call(
            "/direct/live",
            null,
            { identityId: "alice" },
            { "x-game-id": "rollback", "x-test-disabled": "1" },
          )
        ).status,
        503,
      );
      const saved = await call(
        "/direct/history",
        a,
        { moveIndex: 0 },
        { "x-game-id": "g" },
      );
      assert.equal(saved.body.game.historyIndex, 0);
      const repeated = await call("/api/shell/games/g", a);
      assert.equal(repeated.body.game.historyIndex, 0);
      const live = await call("/direct/live", a, {}, { "x-game-id": "g" });
      assert.equal(live.body.game.historyIndex, null);
      const retired = {
        ...command,
        authContextId: a2.context,
        clientCommandId: "v2:retired",
      };
      retired.fingerprint = await commandFingerprint(retired);
      const retiredResult = await call(
        "/direct/reconcile",
        a,
        { protocolVersion: 2, commands: [retired], knownSnapshotEventSeq: 0 },
        { "x-game-id": "g" },
      );
      assert.equal(retiredResult.body.commandOutcomes?.[0]?.outcome, "unknown");
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM live_command_receipts WHERE client_command_id=?",
            )
            .bind(retired.clientCommandId)
            .first()
        ).n,
        0,
      );
      const durable = async () => ({
        game: await state(),
        events: (
          await db
            .prepare(
              "SELECT * FROM live_events WHERE game_id='g' ORDER BY event_seq",
            )
            .all()
        ).results,
        receipts: (
          await db
            .prepare(
              "SELECT * FROM live_command_receipts WHERE game_id='g' ORDER BY client_command_id",
            )
            .all()
        ).results,
        invites: (
          await db
            .prepare(
              "SELECT * FROM live_invites WHERE game_id='g' ORDER BY token",
            )
            .all()
        ).results,
      });
      const before = await durable(),
        next = {
          ...command,
          authContextId: a2.context,
          clientCommandId: "v2:revoke-at-commit",
          expectedState: JSON.parse(before.game.state_json).board.state,
          expectedGameplayRevision: before.game.gameplay_revision,
        };
      next.fingerprint = await commandFingerprint(next);
      const revoked = await call("/direct/moves", a2, next, {
        "x-game-id": "g",
        "x-test-revoke": a2.hash,
      });
      assert.ok(revoked.status >= 400);
      assert.deepEqual(
        await durable(),
        before,
        "commit-time revocation must roll back game, event, invites and receipt",
      );
      const raceActor = await seed("alice", 4);
      const admission = await runtime.dispatchFetch(
        `https://test/direct/ws?authProtocolVersion=1&sessionContext=${raceActor.context}&sessionId=race&lastEventSeq=0`,
        {
          headers: {
            ...headers(raceActor),
            upgrade: "websocket",
            "x-game-id": "g",
            "x-test-revoke": raceActor.hash,
          },
        },
      );
      assert.notEqual(admission.status, 101);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM account_session_rooms WHERE session_hash=?",
            )
            .bind(raceActor.hash)
            .first()
        ).n,
        0,
      );

      const connect = async (actor) => {
        const response = await runtime.dispatchFetch(
          `https://test/direct/ws?authProtocolVersion=1&sessionContext=${actor?.context ?? ""}&sessionId=s${sockets.length}&lastEventSeq=0`,
          {
            headers: {
              ...headers(actor),
              upgrade: "websocket",
              "x-game-id": "g",
            },
          },
        );
        assert.equal(response.status, 101);
        const socket = response.webSocket,
          messages = [];
        socket.addEventListener("message", (e) =>
          messages.push(JSON.parse(e.data)),
        );
        socket.accept();
        sockets.push(socket);
        await eventually(() => messages.length);
        return { socket, messages };
      };
      await db
        .prepare(
          "UPDATE accounts SET recovery_acknowledged=0 WHERE account_id='alice'",
        )
        .run();
      const player = await connect(a),
        spectator = await connect(null);
      assert.equal(player.messages[0].game.canRecordMove, false);
      await db
        .prepare(
          "UPDATE accounts SET recovery_acknowledged=1 WHERE account_id='alice'",
        )
        .run();
      await call(
        "/direct/join",
        b,
        { protocolVersion: 2, mode: "viewer" },
        { "x-game-id": "g" },
      );
      await eventually(() =>
        player.messages.some((m) => m.game?.canRecordMove === true),
      );
      assert.equal(spectator.messages[0].game.inviteToken, null);
      assert.deepEqual(spectator.messages[0].game.legalActions, []);
      const expiry = (
        await db
          .prepare("SELECT expires_at FROM account_sessions WHERE token_hash=?")
          .bind(a.hash)
          .first()
      ).expires_at;
      player.socket.send(
        JSON.stringify({
          type: "heartbeat",
          identityId: "alice",
          sessionId: "s0",
          lastEventSeq: 0,
        }),
      );
      await eventually(() =>
        player.messages.some((m) => m.type === "heartbeat_ack"),
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT expires_at FROM account_sessions WHERE token_hash=?",
            )
            .bind(a.hash)
            .first()
        ).expires_at,
        expiry,
      );
      let closed = false;
      player.socket.addEventListener("close", () => (closed = true));
      await db
        .prepare("UPDATE account_sessions SET revoked_at=1 WHERE token_hash=?")
        .bind(a.hash)
        .run();
      player.socket.send(
        JSON.stringify({
          type: "heartbeat",
          identityId: "alice",
          sessionId: "s0",
          lastEventSeq: 0,
        }),
      );
      await eventually(() => closed);
      await eventually(async () => {
        const game = JSON.parse((await state()).state_json);
        return (
          game.player1.connected === false && game.player1.sessionCount === 0
        );
      });
      assert.equal(
        (
          await call(
            "/direct/history",
            a,
            { moveIndex: 0 },
            { "x-game-id": "g" },
          )
        ).status,
        401,
      );
      const restoredActor = await seed("bobby", 5),
        restored = await connect(restoredActor);
      const restoredFrameCount = restored.messages.length;
      let restoredClosed = false;
      restored.socket.addEventListener("close", () => (restoredClosed = true));
      await db
        .prepare("UPDATE account_sessions SET revoked_at=1 WHERE token_hash=?")
        .bind(restoredActor.hash)
        .run();
      const recheck = await call(
        "/direct/auth-recheck",
        null,
        {},
        { "x-game-id": "g", "x-test-restore": "1" },
      );
      assert.equal(recheck.status, 200, JSON.stringify(recheck));
      assert.equal(
        recheck.body.harnessSessions.includes(restoredActor.hash),
        false,
      );
      assert.ok(
        recheck.body.harnessSockets
          .filter((s) => s.hash === restoredActor.hash)
          .every((s) => s.state >= 2),
      );
      // The pinned workerd runtime delivers HTTP-initiated close handshakes after
      // its approximately ten-second close timeout. Authorization removal above
      // is immediate; do not confuse this with deployed isolate hibernation proof.
      await eventually(() => restoredClosed, 1500);
      assert.equal(
        restored.messages.length,
        restoredFrameCount,
        "retired session receives no protected cleanup output",
      );
      const outputRace = await call(
        "/api/shell/games/g/legal",
        b,
        {},
        { "x-test-revoke-after-read": b.hash },
      );
      assert.equal(outputRace.status, 409);
      assert.equal(outputRace.body.legalActions, undefined);
    } finally {
      for (const s of sockets)
        try {
          s.close();
        } catch {}
      await runtime.dispose();
    }
  },
);
