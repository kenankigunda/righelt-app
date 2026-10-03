import assert from "node:assert/strict";
import test from "node:test";
import { boundarySmoke } from "../../../scripts/deploy-boundary-smoke.mjs";
import { cutoverSql } from "../../../scripts/account-cutover.mjs";
import { validateDeployment } from "../../../scripts/deploy-account-services.mjs";
import { accountSmoke } from "../../../scripts/account-smoke.mjs";
const origin = "https://site.test",
  privateOrigin = "https://api.test";
test("deployment boundary requires provider rejection, never timeout or arbitrary failure", async () => {
  const run = (result) =>
    boundarySmoke({
      origin,
      privateOrigin,
      fetcher: async (url) =>
        url.origin === origin
          ? Response.json({ ok: true, bindings: { db: true, gameRooms: true } })
          : typeof result === "function"
            ? result()
            : result,
    });
  for (const status of [403, 404])
    assert.equal(
      (
        await run(
          new Response("", { status, headers: { server: "cloudflare" } }),
        )
      ).ok,
      true,
    );
  for (const status of [200, 301, 403, 500, 503])
    await assert.rejects(run(new Response("", { status })), /route rejection/);
  for (const code of ["ENOTFOUND", "ETIMEDOUT", "ECONNRESET"])
    await assert.rejects(
      run(() => {
        throw Object.assign(Error("network"), { code });
      }),
      /could not be verified/,
    );
});
test("preparation smoke requires closed maintenance and enabled credentials", async () => {
  for (const maintenance of [false, true]) {
    const work = boundarySmoke({
      origin,
      privateOrigin,
      preparation: true,
      fetcher: async (url) =>
        url.origin === privateOrigin
          ? new Response("", { status: 404, headers: { "cf-ray": "fixture" } })
          : Response.json(
              url.pathname === "/api/health"
                ? { ok: true, bindings: { db: true, gameRooms: true } }
                : {
                    accountsRequired: true,
                    accountsAvailable: true,
                    maintenance,
                  },
            ),
    });
    if (maintenance) assert.equal((await work).ok, true);
    else await assert.rejects(work, /remain closed/);
  }
});
test("operator exposes no downgrade command and validates immutable ID before building SQL", () => {
  for (const action of ["reset", "deactivate", "rollback"])
    assert.throws(() => cutoverSql(action), /forbidden/);
  assert.throws(() => cutoverSql("activate", "x'; DROP TABLE accounts"));
  assert.match(cutoverSql("activate", "a".repeat(32)), /activated_at=COALESCE/);
  assert.doesNotMatch(cutoverSql("reopen"), /activated_at\s*=/);
});
function smokeFixture({
  cookiePath = "/",
  revoke = true,
  wrongContext = 409,
  legacyWritable = false,
} = {}) {
  let sequence = 0;
  const sessions = new Map(),
    calls = [];
  const fetcher = async (url, init) => {
    const route = url.pathname,
      body = init.body ? JSON.parse(init.body) : null;
    calls.push({ route, headers: init.headers });
    const token = init.headers.Cookie?.split("=")[1],
      session = sessions.get(token);
    let status = 200,
      data = { ok: true },
      cookie;
    if (route === "/api/shell/bootstrap")
      data = { accountsRequired: true, accountsAvailable: true };
    else if (route === "/api/auth/login" || route === "/api/auth/password") {
      if (route.endsWith("/password") && revoke) sessions.clear();
      const next = String(++sequence),
        context = "ctx" + next;
      sessions.set(next, context);
      cookie = `__Host-righelt_session=${next}; Secure; HttpOnly; SameSite=Lax; Path=${cookiePath}`;
      data = {
        authenticated: true,
        contextId: context,
        recoveryAcknowledgmentRequired: false,
      };
    } else if (route === "/api/auth/session")
      data = { authenticated: !!session };
    else if (route === "/api/auth/logout") sessions.delete(token);
    else if (init.headers["X-Righelt-Session"] === "wrong-context")
      status = wrongContext;
    else if (body?.identityId === "forged") status = 403;
    else if (route === "/api/shell/games/legacy/live") {
      status = legacyWritable ? 200 : 409;
      data = { error: "legacy_read_only" };
    } else
      data = {
        game: {
          id: "game",
          ownershipMode: route.endsWith("/legacy")
            ? "legacy_guest"
            : "account_v1",
          myRole: "Player 1",
          canRecordMove: !route.endsWith("/legacy"),
        },
      };
    return Response.json(data, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(cookie ? { "Set-Cookie": cookie } : {}),
      },
    });
  };
  return { fetcher, calls };
}
test("account smoke proves distinct browser jars, guarded contexts, legacy protection and revocation", async () => {
  const fixture = smokeFixture();
  const result = await accountSmoke({
    origin,
    username: "canary",
    password: "synthetic password",
    legacyGameId: "legacy",
    fetcher: fixture.fetcher,
  });
  assert.equal(result.ok, true);
  assert.ok(result.checks.includes("legacy read-only"));
  const reads = fixture.calls.filter((c) => c.route === "/api/auth/session");
  assert.ok(new Set(reads.map((c) => c.headers.Cookie)).size >= 2);
});
test("account smoke fails unsafe cookie paths, missing revocation and accepted stale context/legacy writes", async () => {
  for (const options of [
    { cookiePath: "/api" },
    { revoke: false },
    { wrongContext: 200 },
    { legacyWritable: true },
  ])
    await assert.rejects(
      accountSmoke({
        origin,
        username: "canary",
        password: "synthetic password",
        legacyGameId: "legacy",
        fetcher: smokeFixture(options).fetcher,
      }),
    );
});

test("deployment configuration fails before writes for missing credentials or invalid preparation", () => {
  const env = {
    RIGHELT_SITE_ORIGIN: origin,
    RIGHELT_AUTH_ENABLED: "true",
    AUTH_HMAC_SECRET: "a".repeat(64),
    TURNSTILE_SECRET: "synthetic",
    AUTH_TURNSTILE_SITE_KEY: "public",
  };
  assert.throws(() => validateDeployment(env), /canary/);
  assert.equal(
    validateDeployment({ ...env, PREPARE_ACCOUNTS: "true" }).enabled,
    "true",
  );
  assert.throws(
    () =>
      validateDeployment({
        ...env,
        PREPARE_ACCOUNTS: "true",
        RIGHELT_AUTH_ENABLED: "false",
      }),
    /requires enabled/,
  );
  assert.throws(
    () =>
      validateDeployment({
        ...env,
        PREPARE_ACCOUNTS: "true",
        AUTH_HMAC_SECRET: "",
      }),
    /secret/,
  );
});
