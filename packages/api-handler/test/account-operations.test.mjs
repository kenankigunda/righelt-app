import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  const legacyRead = fixture.calls.find((c) => c.route === "/api/shell/games/legacy");
  assert.equal(legacyRead.headers.Cookie, "");
  assert.ok(fixture.calls.some((c) => c.route === "/api/shell/games/legacy/live"));
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


test("account smoke rejects missing or blank legacy proof before any network calls", async () => {
  for (const legacyGameId of [undefined, null, "", " ", "\t\n"]) {
    const fixture = smokeFixture();
    await assert.rejects(accountSmoke({
      origin, username: "canary", password: "synthetic password",
      legacyGameId, fetcher: fixture.fetcher,
    }), /ACCOUNT_SMOKE_LEGACY_GAME_ID/);
    assert.deepEqual(fixture.calls, []);
  }
});

test("ordinary enabled deployment requires legacy proof; disabled and preparation remain valid", () => {
  const env = {
    RIGHELT_SITE_ORIGIN: origin, RIGHELT_AUTH_ENABLED: "true",
    AUTH_HMAC_SECRET: "a".repeat(64), TURNSTILE_SECRET: "synthetic",
    AUTH_TURNSTILE_SITE_KEY: "public", ACCOUNT_SMOKE_USERNAME: "canary",
    ACCOUNT_SMOKE_PASSWORD: "synthetic password",
  };
  for (const ACCOUNT_SMOKE_LEGACY_GAME_ID of [undefined, "", " ", "\t\n"]) {
    const candidate = { ...env, ACCOUNT_SMOKE_LEGACY_GAME_ID };
    assert.throws(() => validateDeployment(candidate), /ACCOUNT_SMOKE_LEGACY_GAME_ID/);
    assert.equal(validateDeployment({ ...candidate, PREPARE_ACCOUNTS: "true" }).enabled, "true");
    assert.equal(validateDeployment({ ...candidate, RIGHELT_AUTH_ENABLED: "false" }).enabled, "false");
  }
  assert.equal(validateDeployment({ ...env, ACCOUNT_SMOKE_LEGACY_GAME_ID: "legacy" }).enabled, "true");
});


test("deployment CLI rejects absent legacy proof before invoking deployment tooling", () => {
  for (const legacyGameId of [undefined, "", " ", "\t\n"]) {
    const env = {
      PATH: "", RIGHELT_SITE_ORIGIN: origin, RIGHELT_AUTH_ENABLED: "true",
      AUTH_HMAC_SECRET: "a".repeat(64), TURNSTILE_SECRET: "synthetic",
      AUTH_TURNSTILE_SITE_KEY: "public", ACCOUNT_SMOKE_USERNAME: "canary",
      ACCOUNT_SMOKE_PASSWORD: "synthetic password",
      ...(legacyGameId === undefined ? {} : { ACCOUNT_SMOKE_LEGACY_GAME_ID: legacyGameId }),
    };
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../../scripts/deploy-account-services.mjs", import.meta.url))], { env, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ACCOUNT_SMOKE_LEGACY_GAME_ID/);
    assert.doesNotMatch(result.stderr, /deployment command failed/);
  }
});

test("deployment workflow supplies legacy proof to preflight, deploy and smoke", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  for (const name of ["Preflight configuration check", "Deploy private authentication services and API", "Verify acknowledged canary account"]) {
    const step = workflow.split(`- name: ${name}\n`)[1]?.split("\n      - name:")[0];
    assert.ok(step, name);
    assert.match(step, /ACCOUNT_SMOKE_LEGACY_GAME_ID: \$\{\{ vars\.ACCOUNT_SMOKE_LEGACY_GAME_ID \}\}/);
  }
});


test("deployment shares the explicit origin or canonical Pages fallback across preflight and all smoke gates", async () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const expression = /^    env:\n      RIGHELT_SITE_ORIGIN: \$\{\{ (.+) \}\}$/m.exec(workflow)?.[1];
  assert.equal(expression, "vars.RIGHELT_SITE_ORIGIN || format('https://{0}.pages.dev', vars.CLOUDFLARE_PAGES_PROJECT)");
  assert.equal((workflow.match(/RIGHELT_SITE_ORIGIN:/g) || []).length, 1, "steps inherit the single job-level origin");
  assert.match(workflow, /if \[ -z "\$CLOUDFLARE_PAGES_PROJECT" \]; then/);
  for (const name of ["Preflight configuration check", "Deploy private authentication services and API", "Verify public Pages and private API boundaries", "Verify acknowledged canary account", "Verify account preparation remains closed"])
    assert.ok(workflow.includes(`- name: ${name}\n`), name);
  assert.match(workflow, /if: vars\.RIGHELT_AUTH_ENABLED == 'true' && !inputs\.prepare_accounts/);
  assert.match(workflow, /if: inputs\.prepare_accounts/);

  // The exact expression above locks GitHub's short-circuit selection. Exercise its
  // two resulting origins against real preflight and public/private smoke logic.
  for (const selectedOrigin of ["https://righelt-dev.pages.dev", "https://play.custom.test"]) {
    assert.deepEqual(validateDeployment({ RIGHELT_SITE_ORIGIN: selectedOrigin }), { enabled: "false", origin: selectedOrigin });
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../../../scripts/deploy-account-services.mjs", import.meta.url)), "--check-only"], { env: { PATH: "", RIGHELT_SITE_ORIGIN: selectedOrigin }, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    const calls = [];
    assert.deepEqual(await boundarySmoke({ origin: selectedOrigin, privateOrigin, fetcher: async url => {
      calls.push(url.href);
      return url.origin === selectedOrigin
        ? Response.json({ ok: true, bindings: { db: true, gameRooms: true } })
        : new Response("", { status: 404, headers: { server: "cloudflare" } });
    } }), { ok: true });
    assert.deepEqual(calls, [`${selectedOrigin}/api/health`, `${privateOrigin}/api/health`]);
    assert.throws(() => validateDeployment({ RIGHELT_SITE_ORIGIN: selectedOrigin, RIGHELT_AUTH_ENABLED: "true" }), /secret/);
  }
  for (const invalidOrigin of ["http://custom.test", "https://custom.test/path", "https://custom.test/", "https://a.test,https://b.test"]) {
    assert.throws(() => validateDeployment({ RIGHELT_SITE_ORIGIN: invalidOrigin }));
    let calls = 0;
    await assert.rejects(boundarySmoke({ origin: invalidOrigin, privateOrigin, fetcher: async () => { calls++; } }));
    assert.equal(calls, 0, "invalid explicit origin cannot proceed to a smoke request");
  }
});
