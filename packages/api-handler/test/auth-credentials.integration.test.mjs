import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { handleAuthRequest } from "../src/auth-handler.ts";
import { hashPassword, verifyPassword } from "../../../apps/auth-hash/hash.mjs";
import { tokenHash } from "../src/auth-security.ts";
import { DB_NOW } from "../src/auth-controls.ts";
const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler/package.json"))(
  "miniflare",
);
const origin = "https://righelt.test",
  password = "synthetic-password-123",
  newPassword = "new-synthetic-password-456";
async function fixture() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: { DB: "credentials" },
  });
  const db = await mf.getD1Database("DB");
  const migrations = new URL("../../../db/migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync(new URL(file, migrations), "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\s+/g, " "),
    );
  const env = {
    DB: db,
    AUTH_ENABLED: "true",
    AUTH_ALLOWED_ORIGINS: origin,
    AUTH_HMAC_SECRET: "a".repeat(64),
    TURNSTILE_SECRET: "test-only",
    HASH_SERVICE: {
      async fetch(request) {
        const input = await request.json();
        return Response.json(
          input.operation === "hash"
            ? { encoded: hashPassword(input.password) }
            : { verified: verifyPassword(input.password, input.encoded) },
        );
      },
    },
  };
  let nextIp = 1;
  class Browser {
    cookies = new Map();
    context = null;
    ip = `192.0.2.${nextIp++}`;
    async call(path, body = {}, options = {}) {
      const headers = {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Righelt-Auth": "1",
        "CF-Connecting-IP": this.ip,
        ...(this.context ? { "X-Righelt-Session": this.context } : {}),
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...options.headers,
      };
      const response = await handleAuthRequest(
        new Request(origin + path, {
          method: options.method ?? "POST",
          headers,
          ...(options.method === "GET" ? {} : { body: JSON.stringify(body) }),
        }),
        options.env ?? env,
        options.services,
      );
      const data = await response.json();
      if (!options.discardResponse) {
        for (const cookie of response.headers.getSetCookie()) {
          const [kv] = cookie.split(";"),
            [name, value] = kv.split("=");
          if (value) this.cookies.set(name, value);
          else this.cookies.delete(name);
        }
        if (data.authenticated === true) this.context = data.contextId;
        if (data.authenticated === false) this.context = null;
      }
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      return { response, data, status: response.status };
    }
    session() {
      return this.call("/api/auth/session", {}, { method: "GET" });
    }
    register(username = "Kenan") {
      return this.call("/api/auth/register", { username, password });
    }
    login(username = "Kenan", pass = password) {
      return this.call("/api/auth/login", { username, password: pass });
    }
  }
  return { mf, db, env, Browser, close: () => mf.dispose() };
}
test("configured origins, request protections, expiry and session-context mismatch fail closed", async () => {
  const f = await fixture();
  try {
    const b = new f.Browser();
    assert.equal(
      (
        await b.call(
          "/api/auth/register",
          { username: "Kenan", password },
          { env: { ...f.env, AUTH_ENABLED: undefined } },
        )
      ).status,
      503,
    );
    for (const headers of [
      { Origin: "https://evil.test" },
      { Origin: "null" },
      { Origin: "" },
      { "X-Righelt-Auth": "0" },
      { "Content-Type": "application/jsonp" },
    ])
      assert.equal(
        (
          await b.call(
            "/api/auth/register",
            { username: "Kenan", password },
            { headers },
          )
        ).status,
        403,
      );
    assert.equal((await b.register()).status, 200);
    assert.equal(
      (
        await b.call(
          "/api/auth/activity",
          {},
          { headers: { "X-Righelt-Session": "other" } },
        )
      ).status,
      409,
    );
    await f.db
      .prepare(`UPDATE account_sessions SET expires_at=${DB_NOW}`)
      .run();
    assert.equal((await b.call("/api/auth/activity")).status, 401);
    assert.equal((await b.session()).data.authenticated, false);
    assert.equal((await b.call("/api/auth/logout")).status, 200);
  } finally {
    await f.close();
  }
});
test("persistent failed-login challenge and hard limits run before hashing; hostname/action are checked", async () => {
  const f = await fixture();
  try {
    const browser = new f.Browser();
    await browser.register();
    await browser.call("/api/auth/logout");
    const goodChallenge = {
      turnstileFetch: async () =>
        Response.json({
          success: true,
          hostname: "righelt.test",
          action: "login",
        }),
    };
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await browser.login("Kenan", "wrong-password-123")).status,
        401,
      );
    const required = await browser.login("Kenan", "wrong-password-123");
    assert.equal(required.status, 403);
    assert.equal(required.data.challengeRequired, true);
    assert.equal(
      (
        await browser.call(
          "/api/auth/login",
          { username: "Kenan", password, challengeToken: "synthetic-token" },
          {
            services: {
              turnstileFetch: async () =>
                Response.json({
                  success: true,
                  hostname: "evil.test",
                  action: "login",
                }),
            },
          },
        )
      ).status,
      403,
    );
    for (let i = 0; i < 5; i++)
      await browser.call(
        "/api/auth/login",
        {
          username: "Kenan",
          password: "wrong-password-123",
          challengeToken: "synthetic-token",
        },
        { services: goodChallenge },
      );
    const limited = await browser.call(
      "/api/auth/login",
      { username: "Kenan", password, challengeToken: "synthetic-token" },
      { services: goodChallenge },
    );
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.response.headers.get("Retry-After")) > 0);
    const keys = (
      await f.db.prepare("SELECT bucket_key FROM account_rate_limits").all()
    ).results
      .map((r) => r.bucket_key)
      .join(" ");
    assert.ok(!keys.includes(browser.ip));
    await f.db
      .prepare(`UPDATE account_rate_limits SET expires_at=${DB_NOW}-1`)
      .run();
    assert.equal((await browser.login()).status, 200);
  } finally {
    await f.close();
  }
});
test("expired counters are deleted in bounded batches and fresh attempts remain usable", async () => {
  const f = await fixture();
  try {
    await f.db
      .prepare(
        `WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<105) INSERT INTO account_rate_limits(bucket_key,attempts,failures,expires_at) SELECT 'expired-'||value,1,0,${DB_NOW}-1 FROM n`,
      )
      .run();
    const b = new f.Browser();
    assert.equal((await b.login("MissingUser")).status, 401);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM account_rate_limits WHERE bucket_key LIKE 'expired-%'",
          )
          .first()
      ).n,
      5,
    );
    assert.equal((await b.login("MissingUser")).status, 401);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM account_rate_limits WHERE bucket_key LIKE 'expired-%'",
          )
          .first()
      ).n,
      0,
    );
  } finally {
    await f.close();
  }
});

test("account settings are guarded, public profile is minimal, and tutorial progress survives replay", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    await a.register("ProfileUser");
    await b.login("ProfileUser");
    const before = (await a.session()).data;
    const update = await a.call(
      "/api/account",
      {
        displayName: "Cafe\u0301 👋",
        preferences: { view: "explanatory", tutorial: "completed" },
      },
      { method: "PATCH" },
    );
    assert.equal(update.status, 200);
    assert.equal(update.data.contextId, before.contextId);
    assert.equal(update.data.account.displayName, "Café 👋");
    assert.deepEqual((await b.session()).data.account.preferences, {
      view: "explanatory",
      tutorial: "completed",
    });
    await a.call(
      "/api/account",
      { preferences: { tutorial: "skipped" } },
      { method: "PATCH" },
    );
    assert.equal(
      (await a.session()).data.account.preferences.tutorial,
      "completed",
    );
    const profile = await new f.Browser().call(
      "/api/profiles/profileuser",
      {},
      { method: "GET" },
    );
    assert.deepEqual(Object.keys(profile.data).sort(), [
      "displayName",
      "joinedMonth",
      "username",
    ]);
    assert.match(profile.data.joinedMonth, /^\d{4}-\d{2}$/);
    assert.equal(profile.data.displayName, "Café 👋");
    assert.equal(
      (
        await a.call(
          "/api/account",
          { preferences: { view: ["focused"] } },
          { method: "PATCH" },
        )
      ).status,
      400,
    );
    assert.equal(
      (await a.call("/api/account", { username: "Other" }, { method: "PATCH" }))
        .status,
      400,
    );
    assert.equal(
      (
        await a.call(
          "/api/account",
          { displayName: "Changed" },
          { method: "PATCH", headers: { Origin: "https://foreign.test" } },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await a.call(
          "/api/account",
          { displayName: "Changed" },
          { method: "PATCH", headers: { "X-Righelt-Session": "x" } },
        )
      ).status,
      409,
    );
    await a.call("/api/auth/logout");
    assert.equal(
      (
        await a.call(
          "/api/account",
          { displayName: "Changed" },
          { method: "PATCH" },
        )
      ).status,
      401,
    );
    await a.login("ProfileUser");
    const guardedEnv = {
      ...f.env,
      DB: {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          await f.db
            .prepare(
              "UPDATE account_sessions SET revoked_at=1 WHERE context_id=?",
            )
            .bind(a.context)
            .run();
          return f.db.batch(statements);
        },
      },
    };
    assert.equal(
      (
        await a.call(
          "/api/account",
          { displayName: "Race must rollback" },
          { method: "PATCH", env: guardedEnv },
        )
      ).status,
      409,
    );
    assert.equal(
      (await b.call("/api/profiles/profileuser", {}, { method: "GET" })).data
        .displayName,
      "Café 👋",
    );
  } finally {
    await f.close();
  }
});

// Keep rate admission real, but inject only into the credential transaction.
// Bound statements retain their SQL labels so this cannot accidentally prove
// rollback of the earlier rate-counter batch instead of the operation under test.
function credentialFaultDatabase(db, position, observed) {
  const statements = new WeakMap();
  function wrap(statement, sql) {
    const wrapped = new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...values) => wrap(target.bind(...values), sql);
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    statements.set(wrapped, { statement, sql });
    return wrapped;
  }
  return {
    prepare: (sql) => wrap(db.prepare(sql), sql),
    batch: (batch) => {
      const entries = batch.map((statement) => {
        assert.ok(
          statements.has(statement),
          "all batch statements are tracked",
        );
        return statements.get(statement);
      });
      const raw = entries.map(({ statement }) => statement);
      if (entries.every(({ sql }) => sql.includes("account_rate_limits"))) {
        return db.batch(raw);
      }
      observed.calls++;
      observed.length = raw.length;
      assert.ok(position <= raw.length, "fault lies within the transaction");
      return db.batch([
        ...raw.slice(0, position),
        db.prepare(
          "INSERT INTO account_transaction_guards(guard_id,valid) VALUES('injected-fault',0)",
        ),
        ...raw.slice(position),
      ]);
    },
  };
}
async function credentialSnapshot(db) {
  const tables = [
    "accounts",
    "account_sessions",
    "account_session_rooms",
    "account_revocation_outbox",
    "account_transaction_guards",
  ];
  const result = {};
  for (const table of tables) {
    result[table] = (
      await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()
    ).results;
  }
  return result;
}

for (const operation of ["register", "login", "logout", "password"]) {
  test(`${operation} rolls back at every credential batch boundary and permits a clean retry`, async () => {
    const f = await fixture();
    try {
      const a = new f.Browser(),
        peer = new f.Browser();
      const registered = await a.register();
      assert.equal(registered.status, 200);
      assert.equal((await peer.login()).status, 200);
      const accountId = registered.data.account.id;
      if (operation === "login") {
        assert.equal(
          (await new f.Browser().register("OtherPlayer")).status,
          200,
        );
      }
      await f.db
        .prepare(
          "INSERT INTO account_session_rooms(session_hash,room_id) SELECT token_hash,'atomicity-room' FROM account_sessions",
        )
        .run();
      const before = await credentialSnapshot(f.db);
      const browserBefore = { cookies: [...a.cookies], context: a.context };
      const bodies = {
        register: { username: "FreshPlayer", password },
        login: { username: "OtherPlayer", password },
        logout: {},
        password: { newPassword },
      };
      const path = `/api/auth/${operation}`;
      let statementCount;
      // Include the boundary AFTER the final statement: all writes and guard
      // cleanup have executed when that fault proves the whole batch rolls back.
      for (let position = 0; position <= (statementCount ?? 0); position++) {
        await f.db.prepare("DELETE FROM account_rate_limits").run();
        const observed = { calls: 0, length: 0 };
        const result = await a.call(path, bodies[operation], {
          env: {
            ...f.env,
            DB: credentialFaultDatabase(f.db, position, observed),
          },
        });
        assert.equal(
          observed.calls,
          1,
          `credential transaction reached at boundary ${position}`,
        );
        statementCount ??= observed.length;
        assert.equal(observed.length, statementCount);
        assert.equal(result.status, operation === "logout" ? 503 : 409);
        assert.deepEqual(
          await credentialSnapshot(f.db),
          before,
          `no partial state at boundary ${position}`,
        );
        assert.deepEqual(
          { cookies: [...a.cookies], context: a.context },
          browserBefore,
        );
        assert.deepEqual(result.response.headers.getSetCookie(), []);
      }
      assert.ok(statementCount >= 2);
      await f.db.prepare("DELETE FROM account_rate_limits").run();
      const retried = await a.call(path, bodies[operation]);
      assert.equal(
        retried.status,
        200,
        "same valid request succeeds after the fault is removed",
      );
      const after = await credentialSnapshot(f.db);
      assert.equal(after.account_transaction_guards.length, 0);
      const account = after.accounts.find(
        (row) => row.account_id === accountId,
      );
      const liveSessions = after.account_sessions.filter(
        (row) => row.revoked_at === null,
      );
      if (operation === "register" || operation === "login") {
        assert.notEqual(retried.data.account.id, accountId);
        assert.equal(
          after.account_sessions.length,
          before.account_sessions.length + 1,
        );
        assert.equal(after.account_revocation_outbox.length, 1);
        assert.equal((await peer.session()).data.authenticated, true);
      } else if (operation === "logout") {
        assert.equal(retried.data.authenticated, false);
        assert.equal(liveSessions.length, 1);
        assert.equal(after.account_revocation_outbox.length, 1);
        assert.equal(
          (await a.call(path)).status,
          200,
          "logout remains idempotent",
        );
      } else if (operation === "password") {
        assert.equal(account.credential_version, 2);
        assert.equal(account.session_epoch, 2);
        assert.equal(liveSessions.length, 1);
        assert.equal(after.account_revocation_outbox.length, 2);
        assert.equal((await peer.session()).data.authenticated, false);
        assert.equal(verifyPassword(newPassword, account.password_hash), true);
      }
    } finally {
      await f.close();
    }
  });
}

test("registration is immediately usable; cross-browser password reset revokes previous sessions and publishes notifications", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser(),
      c = new f.Browser();
    const first = await a.register();
    assert.equal(first.status, 200);
    assert.equal(first.data.authenticated, true);
    assert.equal("recoveryAcknowledgmentRequired" in first.data, false);
    assert.equal("recoveryCode" in first.data, false);
    assert.equal(
      (await b.login("kEnAn")).data.account.id,
      first.data.account.id,
    );
    assert.equal(
      (await c.register("KENAN")).data.error,
      "username_unavailable",
    );
    const previousHash = await tokenHash(
      a.cookies.get("__Host-righelt_session"),
    );
    await f.db
      .prepare(
        "INSERT INTO account_session_rooms(session_hash,room_id) VALUES(?,?)",
      )
      .bind(previousHash, "game-room")
      .run();
    const original = (await a.session()).data.contextId;
    assert.equal(
      (await a.call("/api/auth/password", { newPassword })).status,
      200,
    );
    assert.notEqual(a.context, original);
    assert.equal((await a.session()).data.authenticated, true);
    assert.equal((await b.session()).data.authenticated, false);
    assert.deepEqual(
      (
        await f.db
          .prepare("SELECT room_id,delivered_at FROM account_revocation_outbox")
          .all()
      ).results,
      [{ room_id: "game-room", delivered_at: null }],
    );
    assert.equal((await b.login("Kenan", password)).status, 401);
    assert.equal((await b.login("Kenan", newPassword)).status, 200);
    assert.equal((await a.call("/api/auth/logout")).status, 200);
    assert.equal((await a.call("/api/auth/logout")).status, 200);
    assert.equal((await a.session()).data.authenticated, false);
    assert.equal((await b.session()).data.authenticated, true);
  } finally {
    await f.close();
  }
});

test("username lookup is canonical, minimal, non-renewing, separately limited and never hashes", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser();
    await a.register();
    const before = (await f.db.prepare("SELECT * FROM account_sessions").all())
      .results;
    const env = {
      ...f.env,
      HASH_SERVICE: {
        fetch() {
          throw new Error("lookup must not hash");
        },
      },
    };
    const lookup = (name) =>
      a.call("/api/auth/username", { username: name }, { env });
    assert.deepEqual((await lookup(" kEnAn ")).data, {
      ok: true,
      exists: true,
    });
    assert.deepEqual((await lookup("available")).data, {
      ok: true,
      exists: false,
    });
    assert.equal((await lookup("é")).status, 400);
    assert.deepEqual(
      (await f.db.prepare("SELECT * FROM account_sessions").all()).results,
      before,
    );
    for (const headers of [
      { Origin: "" },
      { Origin: "null" },
      { Origin: "https://evil.test" },
      { "X-Righelt-Auth": "" },
      { "Content-Type": "text/plain" },
    ])
      assert.equal(
        (
          await a.call(
            "/api/auth/username",
            { username: "Kenan" },
            { headers, env },
          )
        ).status,
        403,
      );
    assert.equal(
      (
        await a.call(
          "/api/auth/username",
          { username: "Kenan", accountId: "spoofed" },
          { env },
        )
      ).status,
      400,
    );
    for (let i = 2; i < 60; i++)
      assert.equal((await lookup("available")).status, 200);
    const limited = await lookup("available");
    assert.equal(limited.status, 429);
    assert.ok(+limited.response.headers.get("Retry-After") > 0);
    const keys = (
      await f.db.prepare("SELECT bucket_key FROM account_rate_limits").all()
    ).results.map((r) => r.bucket_key);
    assert.ok(keys.every((k) => !k.includes(a.ip)));
    assert.ok(keys.every((k) => !k.startsWith("verify:")));
    // Expire only the short window; the independent quarter-hour cap remains.
    await f.db
      .prepare(
        "UPDATE account_rate_limits SET expires_at=? WHERE bucket_key LIKE 'username-minute:%'",
      )
      .bind(Date.now() - 1)
      .run();
    await f.db
      .prepare(
        "UPDATE account_rate_limits SET attempts=300 WHERE bucket_key LIKE 'username-quarter:%'",
      )
      .run();
    assert.equal((await lookup("available")).status, 429);
    assert.equal(
      (
        await new f.Browser().call(
          "/api/auth/username",
          { username: "Kenan" },
          { env },
        )
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});

test("password reset rejects missing authority, context spoofing, expired sessions and obsolete fields before hashing", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser();
    let calls = 0;
    const env = {
      ...f.env,
      HASH_SERVICE: {
        async fetch() {
          calls++;
          throw Error("must not hash");
        },
      },
    };
    assert.equal(
      (await a.call("/api/auth/password", { newPassword }, { env })).status,
      401,
    );
    await a.register();
    for (const [body, headers, status] of [
      [{ newPassword, currentPassword: password }, {}, 400],
      [{ newPassword, accountId: "other" }, {}, 400],
      [{ newPassword }, { "X-Righelt-Session": "other" }, 409],
      [{ newPassword }, { Origin: "https://evil.test" }, 403],
      [{ newPassword: "short" }, {}, 400],
      [{ newPassword: "password" }, {}, 400],
    ])
      assert.equal(
        (await a.call("/api/auth/password", body, { headers, env })).status,
        status,
      );
    await f.db
      .prepare(`UPDATE account_sessions SET expires_at=${DB_NOW}`)
      .run();
    assert.equal(
      (await a.call("/api/auth/password", { newPassword }, { env })).status,
      401,
    );
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});

test("password reset budget belongs to the account across browsers and rotated sessions, before hashing", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    await a.register();
    await b.login();
    assert.equal(
      (await a.call("/api/auth/password", { newPassword })).status,
      200,
    );
    await b.login("Kenan", newPassword);
    for (let i = 0; i < 4; i++)
      assert.equal(
        (
          await (i % 2 ? a : b).call("/api/auth/password", {
            newPassword: "short",
          })
        ).status,
        400,
      );
    let calls = 0;
    const env = {
      ...f.env,
      HASH_SERVICE: {
        fetch() {
          calls++;
          throw Error("must not hash");
        },
      },
    };
    assert.equal(
      (await a.call("/api/auth/password", { newPassword: password }, { env }))
        .status,
      429,
    );
    assert.equal(calls, 0);
    assert.equal(
      (await b.call("/api/auth/password", { newPassword: password }, { env }))
        .status,
      429,
    );
  } finally {
    await f.close();
  }
});

test("concurrent password resets have one winner; logout during hashing prevents reset", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    await a.register();
    await b.login();
    let release;
    const gate = new Promise((r) => (release = r));
    let entered = 0;
    const env = {
      ...f.env,
      HASH_SERVICE: {
        async fetch(request) {
          entered++;
          await gate;
          return f.env.HASH_SERVICE.fetch(request);
        },
      },
    };
    const pending = [
      a.call("/api/auth/password", { newPassword }, { env }),
      b.call(
        "/api/auth/password",
        { newPassword: newPassword + "-other" },
        { env },
      ),
    ];
    while (entered < 2) await new Promise((r) => setImmediate(r));
    release();
    assert.deepEqual(
      (await Promise.all(pending)).map((r) => r.status).sort(),
      [200, 409],
    );
    const live = (await a.session()).data.authenticated ? a : b;
    let release2;
    const gate2 = new Promise((r) => (release2 = r));
    let hashing = false;
    const delayed = live.call(
      "/api/auth/password",
      { newPassword: password },
      {
        env: {
          ...f.env,
          HASH_SERVICE: {
            async fetch(request) {
              hashing = true;
              await gate2;
              return f.env.HASH_SERVICE.fetch(request);
            },
          },
        },
      },
    );
    while (!hashing) await new Promise((r) => setImmediate(r));
    await live.call("/api/auth/logout");
    release2();
    assert.equal((await delayed).status, 409);
    assert.equal(
      (await f.db.prepare("SELECT credential_version FROM accounts").first())
        .credential_version,
      2,
    );
  } finally {
    await f.close();
  }
});

test("slow login cannot mint a session after signed-in password reset", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    await a.register();
    let release;
    const gate = new Promise((r) => (release = r));
    let entered = false;
    const pending = b.call(
      "/api/auth/login",
      { username: "Kenan", password },
      {
        env: {
          ...f.env,
          HASH_SERVICE: {
            async fetch(request) {
              entered = true;
              await gate;
              return f.env.HASH_SERVICE.fetch(request);
            },
          },
        },
      },
    );
    while (!entered) await new Promise((r) => setImmediate(r));
    assert.equal(
      (await a.call("/api/auth/password", { newPassword })).status,
      200,
    );
    release();
    assert.equal((await pending).status, 409);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM account_sessions WHERE revoked_at IS NULL",
          )
          .first()
      ).n,
      1,
    );
  } finally {
    await f.close();
  }
});

test("lost password reset response leaves the old session unusable and requires sign-in, without a repeat reset", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser();
    await a.register();
    assert.equal(
      (
        await a.call(
          "/api/auth/password",
          { newPassword },
          { discardResponse: true },
        )
      ).status,
      200,
    );
    assert.equal((await a.session()).data.authenticated, false);
    assert.equal(
      (await a.call("/api/auth/password", { newPassword })).status,
      401,
    );
    assert.equal((await a.login("Kenan", newPassword)).status, 200);
    assert.equal(
      (await f.db.prepare("SELECT credential_version FROM accounts").first())
        .credential_version,
      2,
    );
  } finally {
    await f.close();
  }
});

test("removed recovery routes are unavailable, and hash errors remain secret-free without mutation", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser();
    await a.register();
    for (const suffix of [
      "recovery/prepare",
      "recovery/finish",
      "recovery-code/prepare",
      "recovery-code/finish",
      "recovery-code/acknowledge",
    ])
      assert.equal((await a.call("/api/auth/" + suffix, {})).status, 404);
    const before = await f.db.prepare("SELECT * FROM accounts").first();
    const response = await a.call(
      "/api/auth/password",
      { newPassword },
      {
        env: {
          ...f.env,
          HASH_SERVICE: {
            fetch() {
              throw Error("secret-password-token");
            },
          },
        },
      },
    );
    assert.deepEqual(response.data, {
      ok: false,
      error: "temporarily_unavailable",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(
      await f.db.prepare("SELECT * FROM accounts").first(),
      before,
    );
    assert.equal((await a.session()).data.authenticated, true);
  } finally {
    await f.close();
  }
});

test("concurrent canonical username registration has one account and one session winner", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    const results = await Promise.all([
      a.register("RaceUser"),
      b.register("raceuser"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM accounts").first()).n,
      1,
    );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM account_sessions").first())
        .n,
      1,
    );
    assert.equal(
      results.find((r) => r.status === 409).data.error,
      "username_unavailable",
    );
  } finally {
    await f.close();
  }
});

for (const interveningAction of ["session expiry", "account switch"]) {
  test(
    `password reset cannot commit after ${interveningAction} during hashing`,
    { timeout: 10000 },
    async () => {
      const f = await fixture();
      let release;
      let pending;
      try {
        const browser = new f.Browser();
        const first = await browser.register("FirstPlayer");
        assert.equal(first.status, 200);
        if (interveningAction === "account switch")
          assert.equal(
            (await new f.Browser().register("SecondPlayer")).status,
            200,
          );
        const originalHash = await tokenHash(
          browser.cookies.get("__Host-righelt_session"),
        );
        await f.db
          .prepare(
            "INSERT INTO account_session_rooms(session_hash,room_id) VALUES(?,?)",
          )
          .bind(originalHash, "held-reset-room")
          .run();
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        let started;
        const hashing = new Promise((resolve) => {
          started = resolve;
        });
        pending = browser.call(
          "/api/auth/password",
          { newPassword },
          {
            env: {
              ...f.env,
              HASH_SERVICE: {
                async fetch(request) {
                  started();
                  await gate;
                  return f.env.HASH_SERVICE.fetch(request);
                },
              },
            },
          },
        );
        await Promise.race([
          hashing,
          pending.then(() => {
            throw new Error("reset completed before the held hash");
          }),
        ]);
        if (interveningAction === "session expiry") {
          await f.db
            .prepare(
              `UPDATE account_sessions SET expires_at=${DB_NOW} WHERE token_hash=?`,
            )
            .bind(originalHash)
            .run();
        } else {
          const switched = await browser.login("SecondPlayer");
          assert.equal(switched.status, 200);
          assert.notEqual(switched.data.account.id, first.data.account.id);
        }
        const afterIntervention = await credentialSnapshot(f.db);
        const browserAfterIntervention = {
          cookies: [...browser.cookies],
          context: browser.context,
        };
        release();
        const result = await pending;
        assert.equal(result.status, 409);
        assert.equal(result.data.error, "stale_operation");
        assert.deepEqual(result.response.headers.getSetCookie(), []);
        assert.deepEqual(
          await credentialSnapshot(f.db),
          afterIntervention,
          "rejected reset leaves credentials, sessions, outbox, room associations and guards unchanged",
        );
        assert.deepEqual(
          { cookies: [...browser.cookies], context: browser.context },
          browserAfterIntervention,
        );
        const session = await browser.session();
        if (interveningAction === "session expiry")
          assert.equal(session.data.authenticated, false);
        else assert.equal(session.data.account.username, "SecondPlayer");
      } finally {
        release?.();
        await pending;
        await f.close();
      }
    },
  );
}
