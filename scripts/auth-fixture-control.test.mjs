import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureControlHandler } from "./auth-fixture-control.mjs";
const createControl = (execute, { sleep } = {}) => createFixtureControlHandler({ execute, wait: sleep, report: () => {} });
const busyError = () => Object.assign(new Error("Local command exited 1"), { diagnostics: "NOSENTRY database is locked: SQLITE_BUSY" });
function response() { return { status: null, body: null, writeHead(status) { this.status = status; return this; }, end(body) { this.body = body; } }; }
const request = (url = "/reset-limits") => ({ method: "POST", headers: {}, url });

test("retries only fixed reset after explicit busy and reports success after execution", async () => {
  const sql = [], delays = [];
  const handler = createControl(async value => { sql.push(value); if (sql.length < 3) throw busyError(); }, { sleep: async ms => delays.push(ms) });
  const res = response(); await handler(request(), res);
  assert.deepEqual(sql, Array(3).fill("DELETE FROM account_rate_limits"));
  assert.deepEqual(delays, [100, 250]); assert.equal(res.status, 200);
});
test("nonbusy failures and misleading error messages fail immediately", async () => {
  for (const error of [new Error("SQLITE_BUSY"), Object.assign(new Error("exit"), { diagnostics: "SQLITE_ERROR no such table" })]) {
    let calls = 0;
    const handler = createControl(async () => { calls++; throw error; }, { sleep: async () => assert.fail("must not sleep") });
    const res = response(); await handler(request(), res);
    assert.equal(calls, 1); assert.equal(res.status, 500);
  }
});
test("persistent busy exhausts three attempts and releases serialization guard", async () => {
  let calls = 0; const delays = [];
  const handler = createControl(async () => { calls++; throw busyError(); }, { sleep: async ms => delays.push(ms) });
  const res = response(); await handler(request(), res);
  assert.equal(calls, 3); assert.equal(res.status, 500); assert.deepEqual(delays, [100, 250]);
  const next = response(); await handler(request(), next);
  assert.equal(calls, 6); assert.equal(next.status, 500);
});
test("concurrent reset is rejected while original waits to retry, without duplicate execution", async () => {
  let release, sleeping; const reachedSleep = new Promise(resolve => { sleeping = resolve; });
  let calls = 0;
  const handler = createControl(async () => { if (++calls === 1) throw busyError(); }, {
    sleep: () => new Promise(resolve => { release = resolve; sleeping(); }),
  });
  const first = response(); const pending = handler(request(), first); await reachedSleep;
  const second = response(); await handler(request(), second);
  assert.equal(second.status, 409); assert.equal(calls, 1); assert.equal(first.status, null);
  release(); await pending; assert.equal(calls, 2); assert.equal(first.status, 200);
});
test("session expiration never retries even for busy", async () => {
  let calls = 0;
  const handler = createControl(async () => { calls++; throw busyError(); }, { sleep: async () => assert.fail("must not retry expiration") });
  const res = response(); await handler(request("/expire-sessions"), res);
  assert.equal(calls, 1); assert.equal(res.status, 500);
});
test("origin, method, unknown endpoint and query parameters remain fail closed", async () => {
  const handler = createControl(async () => assert.fail("must not execute"));
  for (const req of [{ ...request(), headers: { origin: "https://example.com" } }, { ...request(), method: "GET" }, request("/unknown"), request("/reset-limits?sql=anything")]) {
    const res = response(); await handler(req, res); assert.equal(res.status, 404);
  }
});

test("downstream cutover controls retain fixed SQL and never retry busy", async () => {
  const expected = new Map([
    ["/activate-cutover", "UPDATE account_cutover SET activated_at=COALESCE(activated_at,CAST(unixepoch('subsec')*1000 AS INTEGER)),maintenance=1,canary_account_id=(SELECT account_id FROM accounts WHERE username_canonical='cutover_canary' AND recovery_acknowledged=1) WHERE singleton=1"],
    ["/maintenance-on", "UPDATE account_cutover SET maintenance=1 WHERE singleton=1 AND activated_at IS NOT NULL"],
    ["/maintenance-off", "UPDATE account_cutover SET maintenance=0 WHERE singleton=1 AND activated_at IS NOT NULL"],
  ]);
  for (const [url, sql] of expected) {
    const executed = [];
    const handler = createControl(async value => { executed.push(value); throw busyError(); }, { sleep: async () => assert.fail("must not retry cutover") });
    const res = response(); await handler(request(url), res);
    assert.deepEqual(executed, [sql]); assert.equal(res.status, 500);
    const success = response(); await createControl(async value => assert.equal(value, sql))(request(url), success);
    assert.equal(success.status, 200);
  }
});
