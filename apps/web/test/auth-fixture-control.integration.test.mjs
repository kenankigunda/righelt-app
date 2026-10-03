import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createFixtureControlHandler, runFixtureCommand } from "../../../scripts/auth-fixture-control.mjs";

const request = (overrides = {}) => ({ method: "POST", url: "/expire-sessions", headers: {}, ...overrides });
const response = () => ({ status: null, body: null, writeHead(status) { this.status = status; return this; }, end(body) { this.body = body; } });
const busyError = () => Object.assign(new Error("Local fixture command exited 1"), { diagnostics: "NOSENTRY database is locked: SQLITE_BUSY" });

test("busy fixture retries only twice with bounded delays and preserves identical SQL", async () => {
  const calls = [], delays = [], reports = [];
  const handler = createFixtureControlHandler({ execute: async sql => { calls.push(sql); if (calls.length < 3) throw busyError(); }, wait: async ms => delays.push(ms), report: error => reports.push(error) });
  const res = response(); await handler(request(), res);
  assert.equal(res.status, 200); assert.equal(calls.length, 3);
  assert.equal(new Set(calls).size, 1); assert.match(calls[0], /^UPDATE account_sessions SET expires_at/);
  assert.deepEqual(delays, [100, 250]); assert.deepEqual(reports, []);
});

test("persistent SQLite contention fails after three attempts and releases control admission", async () => {
  let calls = 0; const reports = [];
  const handler = createFixtureControlHandler({ execute: async () => { calls++; throw busyError(); }, wait: async () => {}, report: error => reports.push(error) });
  const res = response(); await handler(request(), res);
  assert.equal(res.status, 500); assert.equal(calls, 3); assert.equal(reports.length, 1);
  assert.match(reports[0].diagnostics, /SQLITE_BUSY/);
  const next = response(); await handler(request(), next); assert.equal(next.status, 500); assert.equal(calls, 6);
});

for (const diagnostics of ["no such table: account_sessions", "database is locked without a SQLite diagnostic", "SQLITE_BUSY_TIMEOUT", ""]) {
  test(`non-busy failure is not retried: ${diagnostics || "spawn failure"}`, async () => {
    let calls = 0; const error = Object.assign(new Error("failure"), { diagnostics });
    const reports = []; const handler = createFixtureControlHandler({ execute: async () => { calls++; throw error; }, wait: async () => assert.fail("unexpected delay"), report: e => reports.push(e) });
    const res = response(); await handler(request(), res);
    assert.equal(res.status, 500); assert.equal(calls, 1); assert.equal(reports[0], error);
  });
}

test("successful fixture runs once; invalid and browser-origin requests execute nothing", async () => {
  let calls = 0;
  const handler = createFixtureControlHandler({ execute: async () => { calls++; } });
  for (const req of [request({ method: "GET" }), request({ headers: { origin: "http://localhost" } }), request({ headers: { origin: "" } }), request({ url: "/unknown" }), request({ url: "/__proto__" })]) {
    const res = response(); await handler(req, res); assert.equal(res.status, 404);
  }
  assert.equal(calls, 0); const res = response(); await handler(request(), res);
  assert.equal(res.status, 200); assert.equal(calls, 1);
});

test("overlapping controls remain rejected while retry delay owns admission", async () => {
  let release, entered; const blocked = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; }); let calls = 0;
  const handler = createFixtureControlHandler({ execute: async () => { if (++calls === 1) throw busyError(); }, wait: async () => { entered(); await blocked; } });
  const first = response(); const pending = handler(request(), first); await waiting;
  const second = response(); await handler(request(), second); assert.equal(second.status, 409); assert.equal(calls, 1);
  release(); await pending; assert.equal(first.status, 200); assert.equal(calls, 2);
});

test("command captures late stderr through close and preserves streamed diagnostics", async () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const output = []; let invocation;
  const result = runFixtureCommand(["exec", "wrangler"], { cwd: "/tmp", spawnCommand: (...args) => { invocation = args; return child; }, stdout: { write: chunk => output.push(String(chunk)) }, stderr: { write: chunk => output.push(String(chunk)) } });
  child.emit("exit", 1); child.stderr.emit("data", "database is locked: SQLITE_BUSY"); child.emit("close", 1);
  await assert.rejects(result, error => /SQLITE_BUSY/.test(error.diagnostics));
  assert.equal(invocation[0], "pnpm"); assert.equal(invocation[2].cwd, "/tmp");
  assert.deepEqual(output, ["database is locked: SQLITE_BUSY"]);
});
