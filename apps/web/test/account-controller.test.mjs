import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccountController,
  safeAccountIntent,
  LOGOUT_PENDING_KEY,
  AUTH_CHANGE_KEY,
} from "../shell/account-controller.js";
const storage = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
};
const state = (id = "alice", context = "a") => ({
  authenticated: true,
  account: { id, username: id, displayName: id },
  contextId: context.repeat(64),
  expiresAt: Date.now() + 86400000,
});
const setup = () => {
  let session = { authenticated: false },
    offline = false;
  const calls = [],
    transitions = [],
    transitionSources = [],
    target = new EventTarget(),
    document = new EventTarget();
  document.visibilityState = "visible";
  const store = storage();
  const fetcher = async (url, init = {}) => {
    calls.push([url, init]);
    if (offline) throw new Error("offline");
    if (url.endsWith("/bootstrap"))
      return Response.json({ authProtocolVersion: 2, accountsRequired: true });
    if (url.endsWith("/logout")) session = { authenticated: false };
    if (url.endsWith("/login"))
      session = state(JSON.parse(init.body).username, "b");
    return Response.json({ ok: true, ...session });
  };
  const client = createAccountController({
    fetcher,
    storage: store,
    eventTarget: target,
    document,
    onTransition: (s, source) => { transitions.push(s); transitionSources.push(source); },
  });
  return {
    client,
    calls,
    transitions,
    transitionSources,
    store,
    target,
    document,
    setSession: (s) => (session = s),
    setOffline: (v) => (offline = v),
  };
};
test("authentication does not hydrate a guest identity and mutations carry only server context", async () => {
  const fixture = setup();
  await fixture.client.start();
  assert.equal(fixture.client.canPlay(), false);
  await fixture.client.act("login", {
    username: "alice",
    password: "example password",
  });
  assert.equal(fixture.client.canPlay(), true);
  await fixture.client.fetch("/api/shell/games", {
    method: "POST",
    body: "{}",
  });
  assert.equal(
    fixture.calls.at(-1)[1].headers["X-Righelt-Session"],
    "b".repeat(64),
  );
  assert.equal(fixture.calls.at(-1)[1].headers["X-Righelt-Auth-Version"], "2");
  fixture.client.destroy();
});
test("A to B to A retires each generation; delayed response bodies cannot restore authority", async () => {
  const f = setup();
  f.setSession(state());
  await f.client.start();
  const a = f.client.snapshot().generation;
  const response = await f.client.fetch("/api/shell/games/g");
  f.setSession(state("bobby", "b"));
  await f.client.hydrate();
  assert.ok(f.client.snapshot().generation > a);
  await assert.rejects(response.json(), /session_changed/);
  f.setSession(state("alice", "c"));
  await f.client.hydrate();
  assert.equal(f.transitions.length, 3);
  assert.equal(f.client.snapshot().session.contextId, "c".repeat(64));
  f.client.destroy();
});
test("offline logout removes authority immediately and finishes before hydrating on reconnect", async () => {
  const f = setup();
  f.setSession(state());
  await f.client.start();
  f.setOffline(true);
  await f.client.logout();
  assert.equal(f.client.canPlay(), false);
  assert.ok(f.store.getItem(LOGOUT_PENDING_KEY));
  await assert.rejects(f.client.fetch("/api/shell/games"), /logout_pending/);
  f.setOffline(false);
  await f.client.hydrate();
  assert.equal(f.store.getItem(LOGOUT_PENDING_KEY), null);
  assert.equal(f.client.snapshot().session.authenticated, false);
  assert.equal(f.calls.at(-1)[0], "/api/auth/logout");
  f.client.destroy();
});
test("inactivity renews only visible interaction and is throttled", async () => {
  const f = setup();
  f.setSession(state());
  await f.client.start();
  await f.client.activity();
  await f.client.activity();
  assert.equal(f.calls.filter(([u]) => u.endsWith("/activity")).length, 1);
  f.document.visibilityState = "hidden";
  await f.client.activity(true);
  assert.equal(f.calls.filter(([u]) => u.endsWith("/activity")).length, 1);
  f.client.destroy();
});
test("cross-tab account notification retires local authority before asynchronous hydration", async () => {
  const f = setup();
  f.setSession(state());
  await f.client.start();
  f.setOffline(true);
  const event = new Event("storage");
  event.key = AUTH_CHANGE_KEY;
  f.target.dispatchEvent(event);
  assert.equal(f.client.canPlay(), false);
  f.client.destroy();
});
test("missing auth negotiation fails closed while explicitly disabled mode remains compatible", async () => {
  for (const [body, expected] of [
    [{ protocolVersion: 2 }, false],
    [{ authProtocolVersion: 2, accountsRequired: false }, true],
  ]) {
    const client = createAccountController({
      fetcher: async () => Response.json(body),
      storage: storage(),
      eventTarget: null,
      document: null,
    });
    if (expected) {
      await client.start();
      assert.equal(client.canPlay(), true);
    } else await assert.rejects(client.start(), /upgrade_required/);
    client.destroy();
  }
});
test("continuation retains only allowed navigation choices", () => {
  assert.deepEqual(
    safeAccountIntent({
      hash: "#/invite/abc",
      action: "join-player",
      gameId: "g",
      password: "secret",
      moves: [{}],
    }),
    { hash: "#/invite/abc", action: "join-player", gameId: "g" },
  );
  for (const hash of [
    "https://foreign.test",
    "//foreign.test",
    "#/javascript:alert(1)",
  ])
    assert.equal(safeAccountIntent({ hash, action: "create-game" }), null);

});

test("denied browser storage cannot suppress logout or restore authority while offline", async () => {
  let offline = false,
    logoutCalls = 0;
  const denied = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  const client = createAccountController({
    storage: denied,
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      if (offline) throw new Error("offline");
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url.endsWith("/logout")) {
        logoutCalls++;
        return Response.json({ authenticated: false });
      }
      return Response.json(state());
    },
  });
  await client.start();
  offline = true;
  await client.logout();
  assert.equal(client.snapshot().pendingLogout, true);
  assert.equal(client.canPlay(), false);
  offline = false;
  await client.hydrate();
  assert.equal(logoutCalls, 1);
  assert.equal(client.snapshot().pendingLogout, false);
  client.destroy();
});

test("credential transition waits for cookie-renewing game response headers", async () => {
  let session = state(),
    release,
    started;
  const headers = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r)),
    calls = [];
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url, init) => {
      calls.push(url);
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url === "/game") {
        started();
        await headers;
        return Response.json({ ok: true });
      }
      if (url.endsWith("/login")) session = state("bobby", "b");
      return Response.json(session);
    },
  });
  await client.start();
  const game = client.fetch("/game", { method: "POST", body: "{}" });
  await entered;
  const login = client.act("login", {
    username: "bobby",
    password: "example password",
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.includes("/api/auth/login"), false);
  await assert.rejects(
    client.fetch("/another-game", { method: "POST", body: "{}" }),
    /operation_pending/,
  );
  release();
  await game;
  await login;
  assert.equal(client.snapshot().session.account.id, "bobby");
  client.destroy();
});

test("logout cancels a credential transition queued behind a prior renewal", async () => {
  let session = state(),
    release,
    started;
  const headers = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r)),
    calls = [];
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      calls.push(url);
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url === "/game") {
        started();
        await headers;
        return Response.json({ ok: true });
      }
      if (url.endsWith("/logout")) session = { authenticated: false };
      return Response.json(session);
    },
  });
  await client.start();
  const game = client
    .fetch("/game", { method: "POST", body: "{}" })
    .catch(() => {});
  await entered;
  const login = client.act("login", {
    username: "bobby",
    password: "example password",
  });
  const rejected = assert.rejects(login, /session_changed/);
  const logout = client.logout();
  release();
  await Promise.all([game, rejected, logout]);
  assert.equal(calls.includes("/api/auth/login"), false);
  assert.equal(client.canPlay(), false);
  client.destroy();
});

test("old socket revocation during password commit does not abort the replacement response", async () => {
  let session = state(),
    release,
    started;
  const pending = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url.endsWith("/password")) {
        started();
        return pending;
      }
      return Response.json(session);
    },
  });
  await client.start();
  const changed = client.act("password", {
    newPassword: "new password",
  });
  await entered;
  client.authorityLost();
  session = state("alice", "d");
  release(Response.json(session));
  assert.equal((await changed).contextId, "d".repeat(64));
  assert.equal(client.snapshot().session.contextId, "d".repeat(64));
  assert.equal(client.canPlay(), true);
  client.destroy();
});

test("BroadcastChannel retires sibling authority during offline logout with storage denied", async () => {
  const peers = new Set(),
    channelFactory = () => {
      const channel = {
        onmessage: null,
        postMessage(data) {
          for (const peer of peers)
            if (peer !== channel)
              queueMicrotask(() =>
                peer.onmessage?.({ data: structuredClone(data) }),
              );
        },
        close() {
          peers.delete(channel);
        },
      };
      peers.add(channel);
      return channel;
    };
  const denied = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
    removeItem() {
      throw Error("denied");
    },
  };
  let offline = false,
    session = state();
  const fetcher = async (url) => {
    if (offline) throw Error("offline");
    if (url.endsWith("/bootstrap"))
      return Response.json({ authProtocolVersion: 2, accountsRequired: true });
    if (url.endsWith("/logout")) session = { authenticated: false };
    return Response.json(session);
  };
  const a = createAccountController({
      storage: denied,
      eventTarget: null,
      document: null,
      fetcher,
      channelFactory,
    }),
    b = createAccountController({
      storage: denied,
      eventTarget: null,
      document: null,
      fetcher,
      channelFactory,
    });
  await a.start();
  await b.start();
  offline = true;
  await a.logout();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(a.canPlay(), false);
  assert.equal(b.canPlay(), false);
  assert.equal(b.snapshot().pendingLogout, true);
  await assert.rejects(
    b.fetch("/game", { method: "POST", body: "{}" }),
    /logout_pending/,
  );
  offline = false;
  await a.hydrate();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(b.snapshot().session.authenticated, false);
  assert.equal(b.snapshot().pendingLogout, false);
  a.destroy();
  b.destroy();
});

test("failed credential reconciliation retires deferred revoked authority", async () => {
  let release,
    started,
    offline = false;
  const pending = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url.endsWith("/password")) {
        started();
        return pending;
      }
      if (offline) throw Error("offline");
      return Response.json(state());
    },
  });
  await client.start();
  const changed = client.act("password", {});
  await entered;
  client.authorityLost();
  offline = true;
  release(Response.json({ error: "invalid_credentials" }, { status: 400 }));
  await assert.rejects(changed, /invalid_credentials/);
  assert.equal(client.canPlay(), false);
  client.destroy();
});

test("delayed game error body defers authority loss until password response settles", async () => {
  let session = state(),
    releasePassword,
    enteredPassword,
    releaseBody;
  const password = new Promise((r) => (releasePassword = r)),
    entered = new Promise((r) => (enteredPassword = r));
  const body = new Promise((r) => (releaseBody = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url === "/game") return { json: () => body };
      if (url.endsWith("/password")) {
        enteredPassword();
        return password;
      }
      return Response.json(session);
    },
  });
  await client.start();
  const response = await client.fetch("/game", { method: "POST" });
  const read = response.json();
  const changed = client.act("password", {});
  await entered;
  releaseBody({ error: "session_changed" });
  await read;
  session = state("alice", "e");
  releasePassword(Response.json(session));
  await changed;
  assert.equal(client.snapshot().session.contextId, "e".repeat(64));
  assert.equal(client.canPlay(), true);
  client.destroy();
});

test("expiry reached during credential work reconciles after that work finishes", async () => {
  let release,
    started,
    session = { ...state(), expiresAt: Date.now() + 50 };
  const pending = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url.endsWith("/password")) {
        started();
        return pending;
      }
      return Response.json(session);
    },
  });
  await client.start();
  const changed = client.act("password", {});
  await entered;
  await new Promise((r) => setTimeout(r, 1100));
  session = { authenticated: false };
  release(Response.json({ error: "invalid_credentials" }, { status: 400 }));
  await assert.rejects(changed, /invalid_credentials/);
  assert.equal(client.canPlay(), false);
  client.destroy();
});

test("online event drains an unfinished offline logout before retrying revocation", async () => {
  const target = new EventTarget();
  let offline = false,
    rejectOffline,
    started,
    session = state(),
    logoutCalls = 0,
    reads = 0;
  const entered = new Promise((r) => (started = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: target,
    document: null,
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (offline) {
        started();
        return new Promise((resolve, reject) => (rejectOffline = reject));
      }
      if (url.endsWith("/session")) reads++;
      if (url.endsWith("/logout")) {
        logoutCalls++;
        session = { authenticated: false };
      }
      return Response.json(session);
    },
  });
  await client.start();
  offline = true;
  const logout = client.logout();
  await entered;
  client.authorityLost();
  assert.equal(client.snapshot().pendingLogout, true);
  offline = false;
  target.dispatchEvent(new Event("online"));
  rejectOffline(Error("offline"));
  await logout;
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(logoutCalls, 1);
  assert.equal(reads, 2);
  assert.equal(client.snapshot().pendingLogout, false);
  assert.equal(client.canPlay(), false);
  client.destroy();
});

test("pending logout retries early online failure with capped backoff and cancels on offline or destroy", async () => {
  const target = new EventTarget(),
    timers = new Map(),
    delays = [];
  let nextTimer = 0,
    failing = false,
    requests = 0,
    session = state();
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const client = createAccountController({
    storage: storage(),
    eventTarget: target,
    document: null,
    retryTimers: {
      setTimeout(fn, delay) {
        delays.push(delay);
        timers.set(++nextTimer, fn);
        return nextTimer;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      requests++;
      if (failing) throw new TypeError("network not ready");
      if (url.endsWith("/logout")) session = { authenticated: false };
      return Response.json(session);
    },
  });
  await client.start();
  failing = true;
  target.dispatchEvent(new Event("offline"));
  await client.logout();
  assert.equal(timers.size, 0);
  target.dispatchEvent(new Event("online"));
  await settle();
  assert.equal(client.snapshot().pendingLogout, true);
  assert.equal(client.canPlay(), false);
  assert.deepEqual(delays, [1000]);
  const tick = async () => {
    const [id, fn] = [...timers][0];
    timers.delete(id);
    fn();
    await settle();
  };
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  target.dispatchEvent(new Event("offline"));
  assert.equal(timers.size, 0);
  const before = requests;
  await settle();
  assert.equal(requests, before);
  target.dispatchEvent(new Event("online"));
  await settle();
  assert.equal(delays.at(-1), 1000);
  failing = false;
  await tick();
  assert.equal(client.snapshot().pendingLogout, false);
  assert.equal(client.canPlay(), false);
  assert.equal(timers.size, 0);
  failing = true;
  await client.logout();
  assert.equal(timers.size, 1);
  const stale = [...timers.values()][0];
  client.destroy();
  assert.equal(timers.size, 0);
  const after = requests;
  stale();
  await settle();
  assert.equal(requests, after);
});

test("same-session settings serialize through response body without retiring the account generation", async () => {
  let release,
    starts = 0,
    session = {
      ...state(),
      account: {
        ...state().account,
        preferences: { view: "focused", tutorial: "new" },
      },
    };
  const held = new Promise((r) => (release = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url, init) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url === "/api/account") {
        starts++;
        const patch = JSON.parse(init.body);
        session = {
          ...session,
          account: { ...session.account, displayName: patch.displayName },
        };
        return starts === 1
          ? { ok: true, json: () => held }
          : Response.json(session);
      }
      return Response.json(session);
    },
  });
  await client.start();
  const generation = client.snapshot().generation;
  const first = client.updateAccount({ displayName: "First" });
  await new Promise((r) => setTimeout(r, 0));
  const firstResult = structuredClone(session);
  const second = client.updateAccount({ displayName: "Second" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(starts, 1);
  release(firstResult);
  await Promise.all([first, second]);
  assert.equal(client.snapshot().session.account.displayName, "Second");
  assert.equal(client.snapshot().generation, generation);
  client.destroy();
});

test("late hydration and activity metadata cannot replace newer account settings", async () => {
  for (const source of ["hydrate", "activity"]) {
    let hold = false,
      release,
      session = {
        ...state(),
        account: {
          ...state().account,
          preferences: { view: "focused", tutorial: "new" },
        },
      };
    const delayed = new Promise((r) => (release = r));
    const client = createAccountController({
      storage: storage(),
      eventTarget: null,
      document: null,
      fetcher: async (url) => {
        if (url.endsWith("/bootstrap"))
          return Response.json({
            authProtocolVersion: 2,
            accountsRequired: true,
          });
        if (url === "/api/account") {
          session = {
            ...session,
            account: {
              ...session.account,
              preferences: { view: "explanatory", tutorial: "new" },
            },
          };
          return Response.json(session);
        }
        return hold
          ? { ok: true, json: () => delayed }
          : Response.json(session);
      },
    });
    await client.start();
    const old = structuredClone(session);
    hold = true;
    const read =
      source === "hydrate" ? client.hydrate() : client.activity(true);
    await new Promise((r) => setTimeout(r, 0));
    await client.updateAccount({ preferences: { view: "explanatory" } });
    release({ ...old, expiresAt: old.expiresAt + 1000 });
    await read;
    assert.equal(
      client.snapshot().session.account.preferences.view,
      "explanatory",
    );
    assert.equal(client.snapshot().session.expiresAt, old.expiresAt + 1000);
    client.destroy();
  }
});

test("an older same-context session read cannot shorten a renewed session expiry", async () => {
  let held = false,
    release,
    session = state();
  const delayed = new Promise((r) => (release = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    fetcher: async (url) => {
      if (url.endsWith("/bootstrap"))
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      if (url === "/api/account") {
        session = { ...session, expiresAt: session.expiresAt + 50000 };
        return Response.json(session);
      }
      return held ? { ok: true, json: () => delayed } : Response.json(session);
    },
  });
  await client.start();
  const original = structuredClone(session);
  held = true;
  const pending = client.hydrate();
  await new Promise((r) => setTimeout(r, 0));
  await client.updateAccount({ preferences: { view: "focused" } });
  release(original);
  await pending;
  assert.equal(client.snapshot().session.expiresAt, original.expiresAt + 50000);
  client.destroy();
});

test("hung startup is bounded, aborted, and late bootstrap cannot overwrite a successful retry", async () => {
  let timeout,
    release,
    calls = 0,
    firstSignal;
  const held = new Promise((r) => (release = r));
  const client = createAccountController({
    storage: storage(),
    eventTarget: null,
    document: null,
    bootstrapTimers: {
      setTimeout(fn, delay) {
        assert.equal(delay, 5000);
        timeout = fn;
        return 1;
      },
      clearTimeout() {},
    },
    fetcher: async (url, init) => {
      if (url.endsWith("/bootstrap")) {
        calls++;
        if (calls === 1) {
          firstSignal = init.signal;
          return held;
        }
        return Response.json({
          authProtocolVersion: 2,
          accountsRequired: true,
        });
      }
      return Response.json(state());
    },
  });
  const failed = client.start();
  const rejected = assert.rejects(
    failed,
    /temporarily_unavailable|session_changed/,
  );
  timeout();
  await rejected;
  assert.equal(firstSignal.aborted, true);
  assert.equal(client.snapshot().ready, false);
  await client.start();
  const accepted = client.snapshot();
  release(Response.json({ authProtocolVersion: 2, accountsRequired: false }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(client.snapshot().enabled, true);
  assert.equal(client.snapshot().generation, accepted.generation);
  assert.equal(client.canPlay(), true);
  client.destroy();
});


test("only the initiating local credential operation owns its session transition", async () => {
  const fixture = setup();
  try {
    await fixture.client.start();
    const owner = {};
    await fixture.client.act("login", { username: "alice", password: "example password" }, owner);
    assert.equal(fixture.transitionSources.at(-1).owner, owner);
    assert.equal("owner" in fixture.client.snapshot(), false);
    const changed = new Event("storage");
    changed.key = AUTH_CHANGE_KEY;
    fixture.target.dispatchEvent(changed);
    assert.equal(fixture.transitionSources.at(-1).owner, null);
    await fixture.client.logout();
    assert.equal(fixture.transitionSources.at(-1).owner, null);
  } finally { fixture.client.destroy(); }
});

test('required but unavailable accounts hydrate public browsing without restoring guest play',async()=>{
 const calls=[];
 const controller=createAccountController({storage:storage(),eventTarget:new EventTarget(),fetcher:async route=>{
  calls.push(route);assert.equal(route,'/api/shell/bootstrap');return Response.json({authProtocolVersion:2,accountsRequired:true,accountsAvailable:false,maintenance:true});
 }});
 try{await controller.start();assert.equal(controller.snapshot().ready,true);assert.equal(controller.snapshot().enabled,true);assert.equal(controller.snapshot().available,false);assert.equal(controller.canPlay(),false);await controller.hydrate();assert.equal(calls.length,1);}finally{controller.destroy();}
});
test('maintenance keeps an authenticated session but denies play',async()=>{
 const controller=createAccountController({storage:storage(),eventTarget:new EventTarget(),fetcher:async route=>Response.json(route==='/api/shell/bootstrap'?{authProtocolVersion:2,accountsRequired:true,accountsAvailable:true,maintenance:true}:state())});
 try{await controller.start();assert.equal(controller.snapshot().session.authenticated,true);assert.equal(controller.canPlay(),false);}finally{controller.destroy();}
});


test("startup is not ready until the cookie session has been hydrated", async () => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const controller = createAccountController({ storage: storage(), eventTarget: new EventTarget(), fetcher: async route => {
    if (route === "/api/shell/bootstrap") return Response.json({ authProtocolVersion: 2, accountsRequired: true });
    entered();
    await held;
    return Response.json(state());
  } });
  try {
    const started = controller.start();
    await waiting;
    assert.equal(controller.snapshot().ready, false);
    await assert.rejects(controller.act("login", {}), error => error.code === "auth_not_ready");
    release();
    await started;
    assert.equal(controller.snapshot().ready, true);
    assert.equal(controller.snapshot().session.authenticated, true);
    assert.equal(controller.canPlay(), true);
  } finally { release(); controller.destroy(); }
});

test("username lookup is a protected read and does not acquire the cookie lock or busy state", async () => {
  let locks = 0, lookupInit, release;
  const held = new Promise(resolve => { release = resolve; });
  const client = createAccountController({ storage: storage(), eventTarget: null, document: null,
    locks: { request: async (_, __, work) => { locks++; return work(); } },
    fetcher: async (url, init) => {
      if (url.endsWith("bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("username")) { lookupInit = init; return held; }
      return Response.json(state());
    },
  });
  try {
    await client.start();
    const before = client.snapshot();
    const lookup = client.lookupUsername("Alice");
    assert.equal(client.snapshot().busy, false);
    assert.equal(locks, 0);
    assert.equal(lookupInit.method, "POST");
    assert.equal(lookupInit.cache, "no-store");
    assert.equal(lookupInit.headers["X-Righelt-Session"], before.session.contextId);
    assert.deepEqual(JSON.parse(lookupInit.body), { username: "Alice" });
    // A hanging availability read cannot block a credential mutation.
    await client.act("password", { newPassword: "another good password" });
    release(Response.json({ ok: true, exists: true }));
    assert.deepEqual(await lookup, { ok: true, exists: true });
    assert.equal(locks, 1);
    assert.equal(client.snapshot().generation, before.generation);
  } finally { release(Response.json({ ok: true, exists: true })); client.destroy(); }
});

test("username lookup deadline includes a hanging response body and aborts late output", async () => {
  let deadline, release, signal;
  const held = new Promise(resolve => { release = resolve; });
  const client = createAccountController({ storage: storage(), eventTarget: null, document: null,
    bootstrapTimers: { setTimeout(fn, delay) { assert.equal(delay, 5000); deadline = fn; return 1; }, clearTimeout() {} },
    fetcher: async (url, init) => {
      if (url.endsWith("bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("username")) { signal = init.signal; return { ok: true, json: () => held }; }
      return Response.json({ authenticated: false });
    },
  });
  try {
    await client.start();
    const lookup = client.lookupUsername("Alice");
    const rejection = assert.rejects(lookup, /temporarily_unavailable/);
    deadline(); await rejection;
    assert.equal(signal.aborted, true);
    release({ ok: true, exists: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(client.snapshot().session.authenticated, false);
    assert.equal(client.snapshot().busy, false);
  } finally { release({ ok: true, exists: true }); client.destroy(); }
});

test("account retirement fences a delayed username lookup", async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const client = createAccountController({ storage: storage(), eventTarget: null, document: null,
    fetcher: async url => url.endsWith("bootstrap") ? Response.json({ authProtocolVersion: 2, accountsRequired: true }) : url.endsWith("username") ? held : Response.json(state()),
  });
  try {
    await client.start();
    const lookup = client.lookupUsername("Alice");
    const rejection = assert.rejects(lookup, /session_changed/);
    client.retire(); release(Response.json({ ok: true, exists: true }));
    await rejection;
  } finally { release(Response.json({ ok: true, exists: true })); client.destroy(); }
});
