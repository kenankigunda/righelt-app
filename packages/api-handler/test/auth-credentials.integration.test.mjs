import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { handleAuthRequest } from "../src/auth-handler.ts";
import { hashPassword, verifyPassword } from "../../../apps/auth-hash/hash.mjs";
import { tokenHash } from "../src/auth-security.ts";
import { DB_NOW } from "../src/auth-controls.ts";
const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler/package.json"))(
  "miniflare",
);
const schema = readFileSync(
  new URL("../../../db/migrations/0011_accounts.sql", import.meta.url),
  "utf8",
).replace(/--[^\n]*/g, "") + readFileSync(new URL("../../../db/migrations/0014_opponent_introductions.sql", import.meta.url), "utf8");
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
  const trigger = schema.match(/CREATE TRIGGER[\s\S]*?END;/)[0];
  await db.batch(
    [
      ...schema
        .replace(trigger, "")
        .split(";")
        .filter((s) => s.trim()),
      trigger,
    ].map((s) => db.prepare(s.trim())),
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
    operationContext = null;
    ip = `192.0.2.${nextIp++}`;
    async call(path, body = {}, options = {}) {
      // Each tab keeps the preparation context in its own form state. Cookies
      // may be shared; never derive this confirmation value from the cookie.
      if (
        [
          "/api/auth/recovery/finish",
          "/api/auth/recovery-code/finish",
        ].includes(path) &&
        !Object.hasOwn(body, "operationContext")
      )
        body = { ...body, operationContext: this.operationContext };
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
        if (typeof data.operationContext === "string")
          this.operationContext = data.operationContext;
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
test("registration, acknowledgment, cross-browser login, password change and browser logout", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser(),
      c = new f.Browser();
    const registered = await a.register();
    assert.equal(registered.status, 200);
    assert.equal(registered.data.recoveryAcknowledgmentRequired, true);
    assert.ok(registered.data.recoveryCode);
    const snapshot = await f.db
      .prepare("SELECT * FROM account_sessions")
      .first();
    await a.session();
    assert.equal(
      (
        await f.db
          .prepare("SELECT last_activity_at FROM account_sessions")
          .first()
      ).last_activity_at,
      snapshot.last_activity_at,
    );
    assert.equal(
      (
        await a.call("/api/auth/recovery-code/acknowledge", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await a.call("/api/auth/recovery-code/acknowledge", {
          saved: true,
          recoveryVersion: 1,
        })
      ).data.recoveryAcknowledgmentRequired,
      false,
    );
    assert.equal(
      (await b.login("kEnAn")).data.account.id,
      registered.data.account.id,
    );
    assert.equal(
      (await c.register("KENAN")).data.error,
      "username_unavailable",
    );
    const originalRecovery = (
      await f.db.prepare("SELECT recovery_hash FROM accounts").first()
    ).recovery_hash;
    assert.equal(
      (
        await a.call("/api/auth/password", {
          currentPassword: password,
          newPassword,
        })
      ).status,
      200,
    );
    assert.equal((await b.session()).data.authenticated, false);
    assert.equal((await a.session()).data.authenticated, true);
    assert.equal(
      (await f.db.prepare("SELECT recovery_hash FROM accounts").first())
        .recovery_hash,
      originalRecovery,
    );
    assert.equal((await b.login("Kenan", newPassword)).status, 200);
    assert.equal((await a.call("/api/auth/logout")).status, 200);
    assert.equal((await a.session()).data.authenticated, false);
    assert.equal((await b.session()).data.authenticated, true);
  } finally {
    await f.close();
  }
});
test("recovery prepares without changing credentials; concurrent finish retries issue one session; logout cannot restore it", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      recovery = new f.Browser();
    const first = await a.register();
    const before = await f.db.prepare("SELECT * FROM accounts").first();
    const prepared = await recovery.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: first.data.recoveryCode.toLowerCase(),
      newPassword,
    });
    assert.equal(prepared.status, 200);
    assert.equal(
      (await f.db.prepare("SELECT password_hash FROM accounts").first())
        .password_hash,
      before.password_hash,
    );
    assert.equal((await a.session()).data.authenticated, true);
    const oldFlow = recovery.cookies.get("__Host-righelt_recovery");
    const results = await Promise.all([
      recovery.call(
        "/api/auth/recovery/finish",
        { saved: true, recoveryVersion: 2 },
        { discardResponse: true },
      ),
      recovery.call(
        "/api/auth/recovery/finish",
        { saved: true, recoveryVersion: 2 },
        { discardResponse: true },
      ),
    ]);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(
      results[0].response.headers.get("Set-Cookie").split(";")[0],
      results[1].response.headers.get("Set-Cookie").split(";")[0],
    );
    assert.equal((await a.session()).data.authenticated, false);
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
    assert.equal(
      (
        await recovery.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      200,
    );
    assert.equal((await recovery.call("/api/auth/logout")).status, 200);
    recovery.cookies.set("__Host-righelt_recovery", oldFlow);
    assert.equal(
      (
        await recovery.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM account_sessions WHERE revoked_at IS NULL",
          )
          .first()
      ).n,
      0,
    );
  } finally {
    await f.close();
  }
});
test("competing recovery preparations have one winner; stale code never acknowledges new recovery version", async () => {
  const f = await fixture();
  try {
    const owner = new f.Browser(),
      a = new f.Browser(),
      b = new f.Browser();
    const first = await owner.register();
    for (const browser of [a, b])
      assert.equal(
        (
          await browser.call("/api/auth/recovery/prepare", {
            username: "Kenan",
            recoveryCode: first.data.recoveryCode,
            newPassword,
          })
        ).status,
        200,
      );
    const result = await Promise.all([
      a.call("/api/auth/recovery/finish", { saved: true, recoveryVersion: 2 }),
      b.call("/api/auth/recovery/finish", { saved: true, recoveryVersion: 2 }),
    ]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await f.db
          .prepare("SELECT credential_version,recovery_version FROM accounts")
          .first()
      ).credential_version,
      2,
    );
  } finally {
    await f.close();
  }
});
test("password-authenticated code replacement preserves sessions and interrupted registration resumes", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    await a.register();
    await b.login();
    assert.equal((await b.session()).data.recoveryAcknowledgmentRequired, true);
    const before = (
      await f.db.prepare("SELECT recovery_hash FROM accounts").first()
    ).recovery_hash;
    assert.equal(
      (
        await b.call("/api/auth/recovery-code/prepare", {
          currentPassword: password,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.db.prepare("SELECT recovery_hash FROM accounts").first())
        .recovery_hash,
      before,
    );
    assert.equal(
      (
        await b.call("/api/auth/recovery-code/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      200,
    );
    assert.equal((await a.session()).data.authenticated, true);
    assert.equal(
      (await b.session()).data.recoveryAcknowledgmentRequired,
      false,
    );
    assert.equal(
      (
        await b.call("/api/auth/recovery-code/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await a.call("/api/auth/recovery-code/acknowledge", {
          saved: true,
          recoveryVersion: 1,
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});
test("recovery batch failures roll back every mutation and committed response loss retries safely", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    const first = await a.register();
    await b.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: first.data.recoveryCode,
      newPassword,
    });
    const before = await f.db.prepare("SELECT * FROM accounts").first();
    // Inject a constraint violation before each of the nine transaction statements.
    for (let position = 0; position < 9; position++) {
      const broken = {
        ...f.env,
        DB: {
          prepare: (sql) => f.db.prepare(sql),
          batch: (statements) =>
            f.db.batch([
              ...statements.slice(0, position),
              f.db.prepare(
                "INSERT INTO account_transaction_guards(guard_id,valid) VALUES('fault',0)",
              ),
              ...statements.slice(position),
            ]),
        },
      };
      const result = await b.call(
        "/api/auth/recovery/finish",
        { saved: true, recoveryVersion: 2 },
        { env: broken },
      );
      assert.equal(result.status, 409);
      assert.deepEqual(
        await f.db.prepare("SELECT * FROM accounts").first(),
        before,
      );
      assert.equal(
        (
          await f.db
            .prepare("SELECT count(*) AS n FROM account_sessions")
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await f.db
            .prepare("SELECT completed_at FROM account_operations")
            .first()
        ).completed_at,
        null,
      );
    }
    const lost = {
      ...f.env,
      DB: {
        prepare: (sql) => f.db.prepare(sql),
        async batch(statements) {
          await f.db.batch(statements);
          throw new Error("synthetic response lost");
        },
      },
    };
    assert.equal(
      (
        await b.call(
          "/api/auth/recovery/finish",
          { saved: true, recoveryVersion: 2 },
          { env: lost },
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await b.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM account_sessions").first())
        .n,
      2,
    );
  } finally {
    await f.close();
  }
});
test("slow password verification cannot create a session after recovery changes credentials", async () => {
  const f = await fixture();
  try {
    const owner = new f.Browser(),
      login = new f.Browser(),
      recovery = new f.Browser();
    const first = await owner.register();
    let release, entered;
    const barrier = new Promise((resolve) => (release = resolve)),
      started = new Promise((resolve) => (entered = resolve));
    const original = f.env.HASH_SERVICE;
    const delayed = {
      ...f.env,
      HASH_SERVICE: {
        async fetch(request) {
          const result = await original.fetch(request);
          entered();
          await barrier;
          return result;
        },
      },
    };
    const pending = login.call(
      "/api/auth/login",
      { username: "Kenan", password },
      { env: delayed },
    );
    await started;
    await recovery.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: first.data.recoveryCode,
      newPassword,
    });
    await recovery.call("/api/auth/recovery/finish", {
      saved: true,
      recoveryVersion: 2,
    });
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
test("recovery into another account revokes only the replaced browser; stale browser transitions cannot finish", async () => {
  const f = await fixture();
  try {
    const ownerA = new f.Browser(),
      browserB = new f.Browser(),
      otherB = new f.Browser();
    const a = await ownerA.register("Alice");
    await browserB.register("Bobby");
    await otherB.login("Bobby");
    await browserB.call("/api/auth/recovery/prepare", {
      username: "Alice",
      recoveryCode: a.data.recoveryCode,
      newPassword,
    });
    const bToken = browserB.cookies.get("__Host-righelt_session");
    assert.equal(
      (
        await browserB.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).data.account.username,
      "Alice",
    );
    assert.ok(
      (
        await f.db
          .prepare("SELECT revoked_at FROM account_sessions WHERE token_hash=?")
          .bind(await tokenHash(bToken))
          .first()
      ).revoked_at,
    );
    assert.equal((await otherB.session()).data.authenticated, true);
    // A new flow races a later transition of the requesting browser.
    const b = new f.Browser();
    await b.login("Bobby");
    const code = await ownerA.login("Alice", newPassword);
    assert.equal(code.status, 200);
    const replacement = await ownerA.call("/api/auth/recovery-code/prepare", {
      currentPassword: newPassword,
    });
    await ownerA.call("/api/auth/recovery-code/finish", {
      saved: true,
      recoveryVersion: 3,
    });
    await b.call("/api/auth/recovery/prepare", {
      username: "Alice",
      recoveryCode: replacement.data.recoveryCode,
      newPassword: password,
    });
    let release, entered;
    const barrier = new Promise((resolve) => (release = resolve)),
      started = new Promise((resolve) => (entered = resolve));
    const delayed = {
      ...f.env,
      DB: {
        prepare: (sql) => f.db.prepare(sql),
        async batch(statements) {
          entered();
          await barrier;
          return f.db.batch(statements);
        },
      },
    };
    const pending = b.call(
      "/api/auth/recovery/finish",
      { saved: true, recoveryVersion: 4 },
      { env: delayed, discardResponse: true },
    );
    await started;
    assert.equal((await b.login("Bobby")).status, 200);
    release();
    assert.equal((await pending).status, 409);
    assert.equal((await b.session()).data.account.username, "Bobby");
  } finally {
    await f.close();
  }
});
test("a completion cookie with lost response body can retry only its matching completed flow", async () => {
  const f = await fixture();
  try {
    const owner = new f.Browser(),
      b = new f.Browser();
    const registered = await owner.register();
    await b.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: registered.data.recoveryCode,
      newPassword,
    });
    const first = await b.call(
      "/api/auth/recovery/finish",
      { saved: true, recoveryVersion: 2 },
      { discardResponse: true },
    );
    assert.equal(first.status, 200);
    // Browser applies headers but never receives JSON contextId.
    for (const cookie of first.response.headers.getSetCookie()) {
      const [name, value] = cookie.split(";")[0].split("=");
      b.cookies.set(name, value);
    }
    assert.equal(b.context, null);
    assert.equal(
      (
        await b.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await b.call(
          "/api/auth/activity",
          {},
          { headers: { "X-Righelt-Session": "wrong" } },
        )
      ).status,
      409,
    );
    // Retry must not extend cookie validity beyond the unchanged server expiry.
    await f.db
      .prepare(
        `UPDATE account_sessions SET expires_at=${DB_NOW}+120000 WHERE revoked_at IS NULL`,
      )
      .run();
    const retry = await b.call("/api/auth/recovery/finish", {
      saved: true,
      recoveryVersion: 2,
    });
    assert.equal(retry.status, 200);
    const maxAge = Number(
      retry.response.headers.get("Set-Cookie").match(/Max-Age=(\d+)/)[1],
    );
    assert.ok(maxAge > 0 && maxAge <= 120);
  } finally {
    await f.close();
  }
});
test("successful login/register invalidate pending or completed browser flow; failed login preserves it", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    const owner = await a.register("Alice");
    await b.register("Bobby");
    const recover = new f.Browser();
    await recover.call("/api/auth/recovery/prepare", {
      username: "Alice",
      recoveryCode: owner.data.recoveryCode,
      newPassword,
    });
    const flow = recover.cookies.get("__Host-righelt_recovery");
    await recover.call(
      "/api/auth/recovery/finish",
      { saved: true, recoveryVersion: 2 },
      { discardResponse: true },
    );
    assert.equal(
      (await recover.login("Bobby", "incorrect-password-123")).status,
      401,
    );
    assert.ok(
      await f.db
        .prepare("SELECT flow_hash FROM account_operations WHERE flow_hash=?")
        .bind(await tokenHash(flow))
        .first(),
    );
    assert.equal((await recover.login("Bobby")).status, 200);
    assert.equal(
      await f.db
        .prepare("SELECT flow_hash FROM account_operations WHERE flow_hash=?")
        .bind(await tokenHash(flow))
        .first(),
      null,
    );
    const delayed = new f.Browser();
    delayed.cookies.set("__Host-righelt_recovery", flow);
    assert.equal(
      (
        await delayed.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM account_sessions s JOIN accounts a ON a.account_id=s.account_id WHERE a.username='Alice' AND s.revoked_at IS NULL",
          )
          .first()
      ).n,
      0,
    );
    // Pending flow is also retired by successful new-account registration.
    const fresh = new f.Browser();
    const code = await a.login("Alice", newPassword);
    assert.equal(code.status, 200);
    const prepared = await a.call("/api/auth/recovery-code/prepare", {
      currentPassword: newPassword,
    });
    await a.call("/api/auth/recovery-code/finish", {
      saved: true,
      recoveryVersion: 3,
    });
    await fresh.call("/api/auth/recovery/prepare", {
      username: "Alice",
      recoveryCode: prepared.data.recoveryCode,
      newPassword: password,
    });
    const pending = fresh.cookies.get("__Host-righelt_recovery");
    assert.equal((await fresh.register("Charlie")).status, 200);
    fresh.cookies.set("__Host-righelt_recovery", pending);
    assert.equal(
      (
        await fresh.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 4,
        })
      ).status,
      409,
    );
  } finally {
    await f.close();
  }
});
test("logout racing a pending finish revokes its issued session even when logout read the pending operation", async () => {
  const f = await fixture();
  try {
    const owner = new f.Browser(),
      logout = new f.Browser(),
      finisher = new f.Browser();
    const registered = await owner.register();
    await logout.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: registered.data.recoveryCode,
      newPassword,
    });
    finisher.cookies = new Map(logout.cookies);
    finisher.operationContext = logout.operationContext;
    let release, entered;
    const barrier = new Promise((resolve) => (release = resolve)),
      started = new Promise((resolve) => (entered = resolve));
    const delayed = {
      ...f.env,
      DB: {
        prepare: (sql) => f.db.prepare(sql),
        async batch(statements) {
          entered();
          await barrier;
          return f.db.batch(statements);
        },
      },
    };
    const pending = logout.call("/api/auth/logout", {}, { env: delayed });
    await started;
    assert.equal(
      (
        await finisher.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      200,
    );
    release();
    assert.equal((await pending).status, 200);
    assert.equal((await finisher.session()).data.authenticated, false);
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT count(*) AS n FROM account_sessions WHERE revoked_at IS NULL",
          )
          .first()
      ).n,
      0,
    );
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

test("password changes invalidate prepared recovery and publish durable revocation notifications", async () => {
  const f = await fixture();
  try {
    const a = new f.Browser(),
      b = new f.Browser();
    const first = await a.register();
    await f.db
      .prepare(
        "INSERT INTO account_session_rooms(session_hash,room_id) VALUES(?,?)",
      )
      .bind(
        await tokenHash(a.cookies.get("__Host-righelt_session")),
        "game-room",
      )
      .run();
    await b.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: first.data.recoveryCode,
      newPassword,
    });
    assert.equal(
      (
        await a.call("/api/auth/password", {
          currentPassword: password,
          newPassword,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await b.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      409,
    );
    const notices = (
      await f.db
        .prepare("SELECT room_id,delivered_at FROM account_revocation_outbox")
        .all()
    ).results;
    assert.deepEqual(notices, [{ room_id: "game-room", delivered_at: null }]);
  } finally {
    await f.close();
  }
});

test("expired preparations and hash-service errors do not mutate credentials or disclose secrets", async () => {
  const f = await fixture();
  try {
    const b = new f.Browser();
    const failure = await b.call(
      "/api/auth/register",
      { username: "Kenan", password },
      {
        env: {
          ...f.env,
          HASH_SERVICE: {
            async fetch() {
              throw new Error("synthetic-secret-password-must-stay-private");
            },
          },
        },
      },
    );
    assert.equal(failure.status, 503);
    assert.deepEqual(failure.data, {
      ok: false,
      error: "temporarily_unavailable",
    });
    assert.equal(
      (await f.db.prepare("SELECT count(*) AS n FROM accounts").first()).n,
      0,
    );
    const owner = new f.Browser(),
      registered = await owner.register();
    await b.call("/api/auth/recovery/prepare", {
      username: "Kenan",
      recoveryCode: registered.data.recoveryCode,
      newPassword,
    });
    await f.db
      .prepare(`UPDATE account_operations SET expires_at=${DB_NOW}`)
      .run();
    assert.equal(
      (
        await b.call("/api/auth/recovery/finish", {
          saved: true,
          recoveryVersion: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.db.prepare("SELECT credential_version FROM accounts").first())
        .credential_version,
      1,
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
      introducedOpponents: 0,
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
    await Promise.all([
      a.call("/api/account", { preferences: { introducedOpponents: 1 } }, { method: "PATCH" }),
      b.call("/api/account", { preferences: { introducedOpponents: 2 } }, { method: "PATCH" }),
    ]);
    assert.equal((await a.session()).data.account.preferences.introducedOpponents, 3);
    await a.call("/api/account", { preferences: { introducedOpponents: 0 } }, { method: "PATCH" });
    assert.equal((await b.session()).data.account.preferences.introducedOpponents, 3);
    for (const invalidMask of [-1, 8, 1.5, "1"]) {
      assert.equal((await a.call("/api/account", { preferences: { introducedOpponents: invalidMask } }, { method: "PATCH" })).status, 400);
    }
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
    "account_operations",
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

for (const operation of [
  "register",
  "login",
  "logout",
  "password",
  "acknowledge",
  "recovery/prepare",
  "recovery/finish",
  "recovery-code/prepare",
  "recovery-code/finish",
]) {
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
      if (["register", "login", "recovery-code/finish"].includes(operation)) {
        assert.equal(
          (
            await a.call("/api/auth/recovery-code/prepare", {
              currentPassword: password,
            })
          ).status,
          200,
        );
      }
      // Completed flow plus its issued session makes logout's flow retirement
      // and normal session revocation both observable, not empty SQL branches.
      if (operation === "logout" || operation === "recovery/finish") {
        assert.equal(
          (
            await a.call("/api/auth/recovery/prepare", {
              username: "Kenan",
              recoveryCode: registered.data.recoveryCode,
              newPassword,
            })
          ).status,
          200,
        );
      }
      if (operation === "logout") {
        assert.equal(
          (
            await a.call("/api/auth/recovery/finish", {
              saved: true,
              recoveryVersion: 2,
            })
          ).status,
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
        password: { currentPassword: password, newPassword },
        acknowledge: { saved: true, recoveryVersion: 1 },
        "recovery/prepare": {
          username: "Kenan",
          recoveryCode: registered.data.recoveryCode,
          newPassword,
        },
        "recovery/finish": { saved: true, recoveryVersion: 2 },
        "recovery-code/prepare": { currentPassword: password },
        "recovery-code/finish": { saved: true, recoveryVersion: 2 },
      };
      const path = `/api/auth/${operation === "acknowledge" ? "recovery-code/acknowledge" : operation}`;
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
      assert.ok(statementCount >= 3);
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
        assert.equal(after.account_operations.length, 0);
        assert.equal(after.account_revocation_outbox.length, 1);
        assert.equal((await peer.session()).data.authenticated, true);
      } else if (operation === "logout") {
        assert.equal(retried.data.authenticated, false);
        assert.equal(liveSessions.length, 0);
        assert.equal(after.account_operations.length, 0);
        assert.equal(after.account_revocation_outbox.length, 1);
        assert.equal(
          (await a.call(path)).status,
          200,
          "logout remains idempotent",
        );
      } else if (operation === "password" || operation === "recovery/finish") {
        assert.equal(account.credential_version, 2);
        assert.equal(account.session_epoch, 2);
        assert.equal(liveSessions.length, 1);
        assert.equal(after.account_revocation_outbox.length, 2);
        assert.equal((await peer.session()).data.authenticated, false);
        assert.equal(verifyPassword(newPassword, account.password_hash), true);
        if (operation === "recovery/finish") {
          assert.equal(account.recovery_version, 2);
          assert.equal(account.recovery_acknowledged, 1);
          assert.notEqual(
            account.recovery_hash,
            before.accounts[0].recovery_hash,
          );
          assert.ok(after.account_operations[0].completed_at !== null);
          assert.equal(
            after.account_operations[0].issued_session_hash,
            liveSessions[0].token_hash,
          );
          assert.equal(
            after.account_sessions.length,
            before.account_sessions.length + 1,
          );
          assert.equal(
            (await a.call(path, bodies[operation])).status,
            200,
            "completed recovery retries safely",
          );
          assert.deepEqual(
            await credentialSnapshot(f.db),
            after,
            "completed retry does not repeat mutations",
          );
        }
      } else if (operation === "acknowledge") {
        assert.equal(account.recovery_acknowledged, 1);
        assert.equal(liveSessions.length, 2);
      } else if (operation.endsWith("prepare")) {
        assert.deepEqual(
          after.accounts,
          before.accounts,
          "preparation leaves credentials unchanged",
        );
        assert.equal(after.account_operations.length, 1);
        assert.equal(after.account_operations[0].completed_at, null);
        assert.ok(retried.data.recoveryCode);
        assert.equal(liveSessions.length, 2);
      } else {
        assert.equal(account.recovery_version, 2);
        assert.notEqual(
          account.recovery_hash,
          before.accounts[0].recovery_hash,
        );
        assert.ok(after.account_operations[0].completed_at !== null);
        assert.equal(liveSessions.length, 2);
        assert.equal(
          (await a.call(path, bodies[operation])).status,
          200,
          "completed receipt retries safely",
        );
      }
    } finally {
      await f.close();
    }
  });
}

for (const kind of ["replacement", "recovery", "cross-account recovery"]) {
  test(`shared browser flow cookie cannot acknowledge another tab's ${kind} code`, async () => {
    const f = await fixture();
    try {
      const firstOwner = new f.Browser(),
        secondOwner = new f.Browser();
      const firstAccount = await firstOwner.register("FirstOwner");
      await firstOwner.call("/api/auth/recovery-code/acknowledge", {
        saved: true,
        recoveryVersion: 1,
      });
      const secondAccount = await secondOwner.register("SecondOwner");
      await secondOwner.call("/api/auth/recovery-code/acknowledge", {
        saved: true,
        recoveryVersion: 1,
      });
      const shared = kind === "replacement" ? firstOwner : new f.Browser();
      const prepare =
        kind === "replacement"
          ? "/api/auth/recovery-code/prepare"
          : "/api/auth/recovery/prepare";
      const finish =
        kind === "replacement"
          ? "/api/auth/recovery-code/finish"
          : "/api/auth/recovery/finish";
      const first = await shared.call(
        prepare,
        kind === "replacement"
          ? { currentPassword: password }
          : {
              username: "FirstOwner",
              recoveryCode: firstAccount.data.recoveryCode,
              newPassword,
            },
      );
      const firstFlowCookie = shared.cookies.get("__Host-righelt_recovery");
      const second = await shared.call(
        prepare,
        kind === "replacement"
          ? { currentPassword: password }
          : {
              username:
                kind === "cross-account recovery"
                  ? "SecondOwner"
                  : "FirstOwner",
              recoveryCode:
                kind === "cross-account recovery"
                  ? secondAccount.data.recoveryCode
                  : firstAccount.data.recoveryCode,
              newPassword: "another-synthetic-password-789",
            },
      );
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.data.recoveryVersion, second.data.recoveryVersion);
      const before = await credentialSnapshot(f.db);
      const missing = await shared.call(finish, {
        saved: true,
        recoveryVersion: first.data.recoveryVersion,
        operationContext: undefined,
      });
      assert.equal(missing.status, 400);
      const wrong = await shared.call(finish, {
        saved: true,
        recoveryVersion: first.data.recoveryVersion,
        operationContext: first.data.operationContext,
      });
      assert.equal(wrong.status, 409);
      assert.equal((await shared.call(finish,{saved:true,recoveryVersion:first.data.recoveryVersion,operationContext:null})).status,409);
      assert.deepEqual(await credentialSnapshot(f.db), before);
      assert.match(first.data.operationContext, /^[a-f0-9]{64}$/);
      assert.notEqual(first.data.operationContext, firstFlowCookie);
      assert.notEqual(
        first.data.operationContext,
        await tokenHash(firstFlowCookie),
      );
      assert.notEqual(
        first.data.operationContext,
        second.data.operationContext,
      );
      const right = {
        saved: true,
        recoveryVersion: second.data.recoveryVersion,
        operationContext: second.data.operationContext,
      };
      const completed = await shared.call(finish, right);
      assert.equal(completed.status, 200);
      assert.equal(
        completed.data.account.username,
        kind === "cross-account recovery" ? "SecondOwner" : "FirstOwner",
      );
      const stored = await f.db
        .prepare("SELECT recovery_hash FROM accounts WHERE username=?")
        .bind(completed.data.account.username)
        .first();
      assert.equal(
        stored.recovery_hash,
        await tokenHash(second.data.recoveryCode.replaceAll("-", "")),
      );
      assert.notEqual(
        stored.recovery_hash,
        await tokenHash(first.data.recoveryCode.replaceAll("-", "")),
      );
      const completedSnapshot = await credentialSnapshot(f.db);
      assert.equal(
        (
          await shared.call(finish, {
            ...right,
            operationContext: first.data.operationContext,
          })
        ).status,
        409,
      );
      assert.deepEqual(await credentialSnapshot(f.db), completedSnapshot);
      assert.equal((await shared.call(finish, right)).status, 200);
    } finally {
      await f.close();
    }
  });
}
