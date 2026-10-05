import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createInitialGame } from "../src/shell-live-core.ts";
import { persistGameState } from "../src/shell-live-db.ts";
const require = createRequire(import.meta.url),
  wrangler = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wrangler("miniflare"),
  { build } = wrangler("esbuild");
const root = path.resolve(import.meta.dirname, "../../..");
test(
  "real D1 cutover is monotonic, blocks legacy writers and constrains maintenance canary games",
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      stdin: {
        contents: `import {handleApiRequest,GameRoomDO as Base} from './packages/api-handler/src/index.ts'; export class GameRoomDO extends Base {constructor(state,env){let pause=false,activate=false;super(state,{...env,DB:{prepare:(...args)=>env.DB.prepare(...args),batch:async statements=>{if(activate){activate=false;await env.DB.prepare("UPDATE account_cutover SET activated_at=1,maintenance=1,canary_account_id='canary'").run();}if(pause){pause=false;await env.DB.prepare('UPDATE account_cutover SET maintenance=1').run();}return env.DB.batch(statements);}}});this.pauseNext=()=>pause=true;this.activateNext=()=>activate=true;} async fetch(request){if(request.headers.has('x-activate-at-commit'))this.activateNext();if(request.headers.has('x-pause-at-commit'))this.pauseNext();return super.fetch(request);}} export class GuestRoom extends GameRoomDO {constructor(state,env){super(state,{...env,AUTH_ENABLED:'false'});}} export default {fetch(r,e){return handleApiRequest(r,{...e,AUTH_ENABLED:r.headers.has('x-disabled')?'false':'true',GAME_ROOMS:r.headers.has('x-disabled')?e.GUEST_ROOMS:e.GAME_ROOMS});}}`,
        resolveDir: root,
      },
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
        GUEST_ROOMS: { className: "GuestRoom", useSQLite: true },
      },
      bindings: { AUTH_ENABLED: "true", AUTH_ALLOWED_ORIGINS: "https://test" },
    });
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
      async function seed(id, n) {
        const token = String(n).repeat(64),
          context = String(n + 4).repeat(64),
          hash = createHash("sha256").update(token).digest("hex"),
          now = Date.now();
        await db
          .prepare(
            "INSERT INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash) VALUES(?,?,?,?,?,?)",
          )
          .bind(id, id, id, id, now, "synthetic")
          .run();
        await db
          .prepare("INSERT INTO account_sessions VALUES(?,?,1,?,?,?,?,NULL)")
          .bind(hash, id, context, now, now, now + 86400000)
          .run();
        return { id, token, context, hash };
      }
      const canary = await seed("canary", 1),
        ordinary = await seed("ordinary", 2);
      async function call(route, actor, body, extra = {}) {
        const r = await runtime.dispatchFetch("https://test" + route, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Origin: "https://test",
            "Content-Type": "application/json",
            "X-Righelt-Auth": "1",
            "X-Righelt-Auth-Version": "2",
            ...(actor
              ? {
                  Cookie: `__Host-righelt_session=${actor.token}`,
                  "X-Righelt-Session": actor.context,
                }
              : {}),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: r.status, body: await r.json(), headers: r.headers };
      }
      const create = async (actor, selfPlayMode = true) =>
        call("/api/shell/games", actor, { selfPlayMode });
      const legacyGame = createInitialGame({
        gameId: "legacy",
        identityId: "legacy-player",
        selfPlayMode: true,
      });
      await persistGameState({ DB: db }, legacyGame, 1, null);
      const legacy = { body: { game: legacyGame } };
      const normal = await create(ordinary);
      assert.equal(normal.status, 200);
      const upgrade = await runtime.dispatchFetch(
        "https://test/api/shell/games/legacy/ws?identityId=legacy-player&protocolVersion=2&sessionId=legacy-session",
        {
          headers: {
            Upgrade: "websocket",
            Origin: "https://test",
            "x-disabled": "1",
          },
        },
      );
      assert.equal(upgrade.status, 101);
      const legacySocket = upgrade.webSocket;
      legacySocket.accept();
      await db.prepare("UPDATE account_cutover SET maintenance=1").run();
      await assert.rejects(
        db
          .prepare(
            "UPDATE live_games SET updated_at=updated_at WHERE game_id=?",
          )
          .bind(legacyGame.id)
          .run(),
        /account_cutover_write_denied/,
      );
      assert.equal((await create(canary)).status, 503);
      await assert.rejects(
        db.prepare("UPDATE account_cutover SET activated_at=1").run(),
        /account_cutover_immutable/,
      );
      await db.prepare("UPDATE account_cutover SET maintenance=0").run();
      const guestBefore = await db
        .prepare("SELECT state_json,event_seq FROM live_games WHERE game_id=?")
        .bind(legacyGame.id)
        .first();
      const guestHeld = await call(
        "/api/shell/games/legacy/live",
        null,
        { identityId: "legacy-player" },
        { "x-disabled": "1", "x-activate-at-commit": "1" },
      );
      assert.ok(guestHeld.status >= 400);
      assert.deepEqual(
        await db
          .prepare(
            "SELECT state_json,event_seq FROM live_games WHERE game_id=?",
          )
          .bind(legacyGame.id)
          .first(),
        guestBefore,
      );
      const closed = new Promise((resolve) =>
        legacySocket.addEventListener("close", resolve, { once: true }),
      );
      const afterActivation = [];
      legacySocket.addEventListener("message", (event) =>
        afterActivation.push(JSON.parse(event.data)),
      );
      legacySocket.send(
        JSON.stringify({
          type: "heartbeat",
          identityId: "legacy-player",
          sessionId: "legacy-session",
          lastEventSeq: 0,
        }),
      );
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(Error("legacy socket not retired")),
            15000,
          );
          timer.unref();
        }),
      ]);
      assert.equal(
        afterActivation.some((frame) => frame.type === "heartbeat_ack"),
        false,
      );
      for (const sql of [
        "DELETE FROM account_cutover",
        "UPDATE account_cutover SET activated_at=NULL",
        "UPDATE account_cutover SET canary_account_id='ordinary'",
      ])
        await assert.rejects(
          db.prepare(sql).run(),
          /account_cutover_immutable/,
        );
      const bootstrap = await call("/api/shell/bootstrap", null, undefined, {
        "x-disabled": "1",
      });
      assert.equal(bootstrap.status, 200);
      assert.equal(bootstrap.body.accountsRequired, true);
      assert.equal(bootstrap.body.accountsAvailable, false);
      assert.equal(bootstrap.body.maintenance, true);
      assert.equal(bootstrap.headers.get("cache-control"), "no-store");
      assert.equal((await create(ordinary)).status, 503);
      const canaryGame = await create(canary);
      assert.equal(canaryGame.status, 200);
      assert.equal(canaryGame.body.game.ownershipMode, "account_v1");
      assert.equal(
        (
          await db
            .prepare(
              "SELECT has_smoke_identity FROM live_games WHERE game_id=?",
            )
            .bind(canaryGame.body.game.id)
            .first()
        ).has_smoke_identity,
        1,
      );
      assert.ok((await create(canary, false)).status >= 400);
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) n FROM account_game_write_permits")
            .first()
        ).n,
        0,
      );
      for (const game of [
        legacy.body.game,
        normal.body.game,
        canaryGame.body.game,
      ])
        await assert.rejects(
          db
            .prepare(
              "UPDATE live_games SET updated_at=updated_at+1 WHERE game_id=?",
            )
            .bind(game.id)
            .run(),
          /account_cutover_write_denied/,
        );
      const legacyView = await call(
        "/api/shell/games/" + legacy.body.game.id,
        null,
      );
      assert.equal(legacyView.status, 200);
      assert.equal(legacyView.body.game.ownershipMode, "legacy_guest");
      assert.equal(legacyView.body.game.canRecordMove, false);
      const disabledView = await call(
        "/api/shell/games/" + normal.body.game.id,
        ordinary,
        undefined,
        { "x-disabled": "1" },
      );
      assert.equal(disabledView.status, 200);
      assert.equal(disabledView.body.game.canRecordMove, false);
      assert.equal(disabledView.body.game.inviteTokens, undefined);
      assert.equal(
        (
          await call(
            "/api/shell/games",
            canary,
            { selfPlayMode: true },
            { "x-disabled": "1" },
          )
        ).status,
        503,
      );
      const publicProfile = await call(
        "/api/profiles/canary",
        null,
        undefined,
        { "x-disabled": "1" },
      );
      assert.equal(publicProfile.status, 200);
      assert.deepEqual(Object.keys(publicProfile.body).sort(), [
        "displayName",
        "joinedMonth",
        "username",
      ]);
      await db.exec("UPDATE account_cutover SET maintenance=0");
      assert.equal((await create(ordinary)).status, 200);
      const before = await db
        .prepare("SELECT state_json,event_seq FROM live_games WHERE game_id=?")
        .bind(normal.body.game.id)
        .first();
      const eventsBefore = (
        await db
          .prepare("SELECT count(*) n FROM live_events WHERE game_id=?")
          .bind(normal.body.game.id)
          .first()
      ).n;
      const interrupted = await call(
        "/api/shell/games/" + normal.body.game.id + "/live",
        ordinary,
        {},
        { "x-pause-at-commit": "1" },
      );
      assert.ok(interrupted.status >= 400);
      assert.deepEqual(
        await db
          .prepare(
            "SELECT state_json,event_seq FROM live_games WHERE game_id=?",
          )
          .bind(normal.body.game.id)
          .first(),
        before,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) n FROM live_events WHERE game_id=?")
            .bind(normal.body.game.id)
            .first()
        ).n,
        eventsBefore,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*) n FROM account_game_write_permits")
            .first()
        ).n,
        0,
      );
      await db.exec("UPDATE account_cutover SET maintenance=0");
      // Even an old writer that knows an account-owned ID cannot write without an atomic permit.
      await assert.rejects(
        db
          .prepare("DELETE FROM live_invites WHERE game_id=?")
          .bind(normal.body.game.id)
          .run(),
        /account_cutover_write_denied/,
      );
      await assert.rejects(
        db
          .prepare(
            "UPDATE live_games SET updated_at=updated_at+1 WHERE game_id=?",
          )
          .bind(legacy.body.game.id)
          .run(),
        /account_cutover_write_denied/,
      );
      await db.exec("DROP TABLE account_cutover");
      assert.equal((await call("/api/shell/bootstrap", null)).status, 503);
    } finally {
      await runtime.dispose();
    }
  },
);
