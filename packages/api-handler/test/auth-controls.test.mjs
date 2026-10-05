import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  allowedOrigin,
  authBody,
  exactKeys,
  privateCounterKey,
  validateChallenge,
} from "../src/auth-controls.ts";
import { authCookie } from "../src/auth-security.ts";
const env = {
  AUTH_ALLOWED_ORIGINS: "https://righelt.test,https://preview.test",
  TURNSTILE_SECRET: "synthetic-secret",
};
const make = (body = "{}", headers = {}) =>
  new Request("https://untrusted-request-host.test/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://righelt.test",
      "Content-Type": "application/json; charset=utf-8",
      "X-Righelt-Auth": "1",
      ...headers,
    },
    body,
  });
test("auth origin is an exact configured origin, never the request host", () => {
  assert.equal(allowedOrigin(make(), env), "https://righelt.test");
  for (const origin of [
    "null",
    "",
    "https://untrusted-request-host.test",
    "https://righelt.test.evil.test",
    "https://righelt.test/",
  ])
    assert.throws(
      () => allowedOrigin(make("{}", { Origin: origin }), env),
      (error) => error.status === 403,
    );
  assert.throws(
    () => allowedOrigin(make(), {}),
    (error) => error.status === 403,
  );
});
test("auth JSON reader enforces header, exact media type, size and object shape", async () => {
  assert.deepEqual(await authBody(make('{"username":"Kenan"}'), env), {
    username: "Kenan",
  });
  for (const headers of [
    { "X-Righelt-Auth": "" },
    { "Content-Type": "application/jsonp" },
    { "Content-Type": "text/plain" },
  ])
    await assert.rejects(
      authBody(make("{}", headers), env),
      (error) => error.status === 403,
    );
  for (const body of [
    "null",
    "[]",
    "true",
    "invalid",
    JSON.stringify({ password: "x".repeat(5000) }),
  ])
    await assert.rejects(
      authBody(make(body), env),
      (error) => error.code === "invalid_input",
    );
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error("secret must never escape"));
    },
  });
  await assert.rejects(
    authBody(
      new Request("https://righelt.test", {
        method: "POST",
        headers: make().headers,
        body: stream,
        duplex: "half",
      }),
      env,
    ),
    (error) =>
      error.code === "invalid_input" && !error.message.includes("secret"),
  );
});
test("endpoint field lists reject extra actor authority and missing fields", () => {
  exactKeys({ username: "Kenan", password: "pw" }, ["username", "password"]);
  assert.throws(() =>
    exactKeys({ username: "Kenan" }, ["username", "password"]),
  );
  assert.throws(() =>
    exactKeys({ username: "Kenan", password: "pw", accountId: "spoofed" }, [
      "username",
      "password",
    ]),
  );
});
test("rate counter keys are deterministic, domain scoped and contain no IP text", async () => {
  const first = await privateCounterKey("a".repeat(64), "192.0.2.1");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, await privateCounterKey("a".repeat(64), "192.0.2.1"));
  assert.notEqual(first, await privateCounterKey("b".repeat(64), "192.0.2.1"));
  assert.notEqual(first, await privateCounterKey("a".repeat(64), "192.0.2.2"));
});
test("Turnstile validates provider success, exact hostname/action and service failures", async () => {
  let called = 0;
  const valid = async (url, options) => {
    called++;
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(options.body.get("secret"), "synthetic-secret");
    assert.equal(options.body.get("response"), "synthetic-token");
    return Response.json({
      success: true,
      hostname: "righelt.test",
      action: "login",
    });
  };
  await validateChallenge(make(), env, "login", "synthetic-token", valid);
  assert.equal(called, 1);
  for (const result of [
    { success: false },
    { success: true, hostname: "preview.test", action: "login" },
    { success: true, hostname: "righelt.test", action: "register" },
  ])
    await assert.rejects(
      validateChallenge(make(), env, "login", "synthetic-token", async () =>
        Response.json(result),
      ),
      (error) => error.status === 403 && error.challengeRequired,
    );
  await assert.rejects(
    validateChallenge(make(), env, "login", "", valid),
    (error) => error.challengeRequired,
  );
  await assert.rejects(
    validateChallenge(make(), env, "login", "synthetic-token", async () => {
      throw new Error("provider secret");
    }),
    (error) =>
      error.status === 503 && error.message === "temporarily_unavailable",
  );
  await assert.rejects(
    validateChallenge(
      make(),
      { ...env, TURNSTILE_SECRET: undefined },
      "login",
      "synthetic-token",
      valid,
    ),
    (error) => error.status === 503,
  );
});
test("bundled runtime dictionary is reproducible from pinned unmodified source", () => {
  const source = readFileSync(
    new URL("../../shared-types/data/common-passwords.txt", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce",
  );
  const bundled = JSON.parse(
    readFileSync(
      new URL("../../shared-types/data/common-passwords.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    bundled,
    source.toString("utf8").split(/\r?\n/).filter(Boolean),
  );
});
test("cookies use remaining server lifetime", () => {
  const digest = "a".repeat(64);
  assert.match(authCookie(digest, 120), /Max-Age=120;/);
  assert.throws(() => authCookie(digest, 2592001));
  assert.throws(() => authCookie(digest, -1));
});
