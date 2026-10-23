import test from "node:test";
import assert from "node:assert/strict";
import { createAccountController } from "../shell/account-controller.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const account = (name) => ({ authenticated: true, account: { id: name, username: name }, contextId: name.repeat(64), expiresAt: Date.now() + 86400000 });

for (const denied of [false, true]) test(`a queued peer cannot revoke a newly signed-in account (storage ${denied ? "denied" : "available"})`, async () => {
  const gate = deferred(), values = new Map(), calls = [];
  let session = account("a"), channel;
  const storage = {
    getItem(key) { if (denied) throw Error("denied"); return values.get(key) ?? null; },
    setItem(key, value) { if (denied) throw Error("denied"); values.set(key, value); },
    removeItem(key) { if (denied) throw Error("denied"); values.delete(key); },
  };
  const client = createAccountController({
    storage, eventTarget: null, document: null,
    locks: { request: async (_name, _options, work) => { await gate.promise; return work(); } },
    channelFactory: () => channel = { onmessage: null, postMessage() {}, close() {} },
    fetcher: async (url, init) => {
      if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("/logout")) calls.push(init);
      return Response.json({ ok: true, ...session });
    },
  });
  try {
    await client.start();
    values.set("righelt.account.logout-pending.v1", session.contextId);
    channel.onmessage({ data: { type: "changed", pendingLogout: true, logoutContext: session.contextId } });
    const waiting = client.hydrate().catch(() => {});
    // Another tab finishes the old logout, then signs in, while this peer's
    // completion message remains undelivered. Admission must inspect this state.
    values.clear(); session = account("b");
    gate.resolve(); await waiting;
    assert.equal(calls.length, 0, "stale peer must not POST against the new cookie");
    assert.equal(session.account.id, "b");
    assert.equal(client.canPlay(), false);
    assert.equal(client.snapshot().pendingLogout, denied, "denied storage must fail closed until correlated completion");
    channel.onmessage({ data: { type: "logout-complete", logoutContext: "a".repeat(64) } });
    await client.hydrate();
    assert.equal(client.snapshot().session.account.id, "b");
  } finally { gate.resolve(); client.destroy(); }
});

test("the explicit logout owner still revokes the actual cookie after partial credential headers", async () => {
  let session = account("a");
  const values = new Map(), contexts = [];
  const client = createAccountController({
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    eventTarget: null, document: null, channelFactory: null,
    fetcher: async (url, init) => {
      if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("/logout")) { contexts.push(init.headers["X-Righelt-Session"]); session = { authenticated: false }; }
      return Response.json({ ok: true, ...session });
    },
  });
  try {
    await client.start();
    session = account("b");
    await client.logout();
    assert.deepEqual(contexts, ["b".repeat(64)]);
    assert.equal(client.snapshot().pendingLogout, false);
    assert.equal(client.canPlay(), false);
  } finally { client.destroy(); }
});

test("an unrecognized session response cannot complete logout", async () => {
  const values = new Map();
  let invalid = false, logouts = 0;
  const client = createAccountController({
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    eventTarget: null, document: null, channelFactory: null,
    fetcher: async url => {
      if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("/logout")) logouts++;
      return Response.json(invalid ? { ok: true } : account("a"));
    },
  });
  try {
    await client.start(); invalid = true; await client.logout();
    assert.equal(client.snapshot().pendingLogout, true);
    assert.equal(client.canPlay(), false);
    assert.equal(logouts, 0);
  } finally { client.destroy(); }
});

test("an old completion cannot clear a newer explicit logout when storage is denied", async () => {
  const held = deferred(), started = deferred();
  let session = account("b"), channel, signal;
  const client = createAccountController({
    storage: { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); }, removeItem() { throw Error("denied"); } },
    eventTarget: null, document: null,
    channelFactory: () => channel = { onmessage: null, postMessage() {}, close() {} },
    fetcher: async (url, init) => {
      if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("/logout")) {
        signal = init.signal; started.resolve(); await held.promise;
        session = { authenticated: false };
      }
      return Response.json({ ok: true, ...session });
    },
  });
  let pending;
  try {
    await client.start(); pending = client.logout(); await started.promise;
    channel.onmessage({ data: { type: "logout-complete", logoutContext: "a".repeat(64) } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signal.aborted, false);
    assert.equal(client.snapshot().pendingLogout, true);
    assert.equal(client.canPlay(), false);
    held.resolve(); await pending;
    assert.equal(client.snapshot().pendingLogout, false);
    assert.equal(client.canPlay(), false);
  } finally { held.resolve(); await pending; client.destroy(); }
});

for (const cancellation of ["deadline", "destroy"]) test(`queued logout cannot dispatch after ${cancellation}`, async () => {
  const gate = deferred(), values = new Map(), calls = [];
  let deadline;
  const client = createAccountController({
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    eventTarget: null, document: null, channelFactory: null,
    locks: { request: async (_name, _options, work) => { await gate.promise; return work(); } },
    logoutTimers: { setTimeout(callback) { deadline = callback; return 1; }, clearTimeout() {} },
    fetcher: async url => {
      if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      calls.push(url); return Response.json(account("a"));
    },
  });
  try {
    await client.start(); calls.length = 0;
    const pending = client.logout();
    if (cancellation === "deadline") { deadline(); await pending; }
    else client.destroy();
    gate.resolve(); await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, []);
    assert.equal(client.canPlay(), false);
  } finally { gate.resolve(); client.destroy(); }
});

test("cross-tab logout completes its body and retirement before another tab can revoke", async () => {
  const values = new Map(), peers = new Set(), calls = [];
  const body = deferred(), headers = deferred();
  let session = { authenticated: true, account: { id: "alice", username: "alice" }, contextId: "a".repeat(64), expiresAt: Date.now() + 86400000 };
  let queue = Promise.resolve();
  const locks = { request(_name, _options, work) {
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
  } };
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const channelFactory = () => {
    const peer = { onmessage: null, postMessage(data) {
      for (const other of peers) if (other !== peer) queueMicrotask(() => other.onmessage?.({ data }));
    }, close() { peers.delete(peer); } };
    peers.add(peer);
    return peer;
  };
  const fetcher = async (url, init = {}) => {
    if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
    if (url.endsWith("/logout")) {
      calls.push(init.signal);
      session = { authenticated: false };
      if (calls.length === 1) {
        headers.resolve();
        return { ok: true, json: () => body.promise };
      }
    }
    return Response.json({ ok: true, ...session });
  };
  const options = { storage, locks, channelFactory, fetcher, eventTarget: null, document: null };
  const a = createAccountController(options), b = createAccountController(options);
  try {
    await a.start(); await b.start();
    const pending = a.logout();
    await headers.promise;
    // Drain the actual channel/lock microtasks while the first response body
    // remains withheld. A second tab must not dispatch another mutation here.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1, "the cookie lock must cover logout completion, not only response headers");
    body.resolve({ ok: true });
    await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].aborted, false);
    assert.equal(a.snapshot().pendingLogout, false);
    assert.equal(b.snapshot().pendingLogout, false);
    assert.equal(a.canPlay(), false);
    assert.equal(b.canPlay(), false);
  } finally { body.resolve({ ok: true }); a.destroy(); b.destroy(); }
});
