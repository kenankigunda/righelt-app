import test from "node:test";
import assert from "node:assert/strict";
import { createAuthFixtureControl } from "./auth-fixture-control.mjs";
const busyError = () => Object.assign(new Error("Local command exited 1"), { stderr: "NOSENTRY database is locked: SQLITE_BUSY" });
function response() { return { status: null, body: null, writeHead(status) { this.status = status; return this; }, end(body) { this.body = body; } }; }
const request = (url = "/reset-limits") => ({ method: "POST", headers: {}, url });

test("retries only fixed reset after explicit busy and reports success after execution", async () => {
  const sql = [], delays = [];
  const handler = createAuthFixtureControl(async value => { sql.push(value); if (sql.length < 3) throw busyError(); }, { sleep: async ms => delays.push(ms) });
  const res = response(); await handler(request(), res);
  assert.deepEqual(sql, Array(3).fill("DELETE FROM account_rate_limits"));
  assert.deepEqual(delays, [250, 500]); assert.equal(res.status, 200);
});
for (const url of ["/reset-limits", "/maintenance-on", "/maintenance-off"]) test(`nonbusy failures and misleading error messages fail immediately for ${url}`, async () => {
  for (const error of [new Error("SQLITE_BUSY"), Object.assign(new Error("exit"), { stderr: "SQLITE_ERROR no such table" })]) {
    let calls = 0;
    const handler = createAuthFixtureControl(async () => { calls++; throw error; }, { sleep: async () => assert.fail("must not sleep") });
    const res = response(); await handler(request(url), res);
    assert.equal(calls, 1); assert.equal(res.status, 500);
  }
});
for (const url of ["/reset-limits", "/maintenance-on", "/maintenance-off"]) test(`persistent busy exhausts four attempts and releases serialization guard for ${url}`, async () => {
  let calls = 0; const delays = [];
  const handler = createAuthFixtureControl(async () => { calls++; throw busyError(); }, { sleep: async ms => delays.push(ms) });
  const res = response(); await handler(request(url), res);
  assert.equal(calls, 4); assert.equal(res.status, 500); assert.deepEqual(delays, [250, 500, 750]);
  const next = response(); await handler(request(url), next);
  assert.equal(calls, 8); assert.equal(next.status, 500);
});
for (const url of ["/reset-limits", "/maintenance-on", "/maintenance-off"]) test(`concurrent control is rejected while ${url} waits to retry, without duplicate execution`, async () => {
  let release, sleeping; const reachedSleep = new Promise(resolve => { sleeping = resolve; });
  let calls = 0;
  const handler = createAuthFixtureControl(async () => { if (++calls === 1) throw busyError(); }, {
    sleep: () => new Promise(resolve => { release = resolve; sleeping(); }),
  });
  const first = response(); const pending = handler(request(url), first); await reachedSleep;
  const second = response(); await handler(request(), second);
  assert.equal(second.status, 409); assert.equal(calls, 1); assert.equal(first.status, null);
  release(); await pending; assert.equal(calls, 2); assert.equal(first.status, 200);
});
test("session expiration never retries even for busy", async () => {
  let calls = 0;
  const handler = createAuthFixtureControl(async () => { calls++; throw busyError(); }, { sleep: async () => assert.fail("must not retry expiration") });
  const res = response(); await handler(request("/expire-sessions"), res);
  assert.equal(calls, 1); assert.equal(res.status, 500);
});
test("origin, method, unknown endpoint and query parameters remain fail closed", async () => {
  const handler = createAuthFixtureControl(async () => assert.fail("must not execute"));
  for (const req of [{ ...request(), headers: { origin: "https://example.com" } }, { ...request(), method: "GET" }, request("/unknown"), request("/reset-limits?sql=anything")]) {
    const res = response(); await handler(req, res); assert.equal(res.status, 404);
  }
});

test("activation retains fixed SQL and never retries busy", async () => {
  const sql = "UPDATE account_cutover SET activated_at=COALESCE(activated_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),maintenance=1,canary_account_id=(SELECT account_id FROM accounts WHERE username_canonical='cutover_canary') WHERE singleton=1";
  const executed = [];
  const handler = createAuthFixtureControl(async value => { executed.push(value); throw busyError(); }, { sleep: async () => assert.fail("must not retry activation") });
  const res = response(); await handler(request("/activate-cutover"), res);
  assert.deepEqual(executed, [sql]); assert.equal(res.status, 500);
});

for (const [url, value] of [["/maintenance-on", 1], ["/maintenance-off", 0]]) test(`${url} retries explicit busy and acknowledges only completed fixed assignment`, async () => {
  const executed = [], delays = [];
  const handler = createAuthFixtureControl(async sql => { executed.push(sql); if (executed.length < 3) throw busyError(); }, { sleep: async ms => delays.push(ms) });
  const res = response(); await handler(request(url), res);
  assert.deepEqual(executed, Array(3).fill(`UPDATE account_cutover SET maintenance=${value} WHERE singleton=1 AND activated_at IS NOT NULL`));
  assert.deepEqual(delays, [250, 500]);
  assert.equal(res.status, 200);
});
