import test from "node:test";
import assert from "node:assert/strict";
import { createAccountController, LOGOUT_PENDING_KEY } from "../shell/account-controller.js";
import { createAccountDialog } from "../shell/account-dialog.js";

// Minimal DOM boundary: execute the production dialog handlers/controller,
// without duplicating their flow or transition decisions. Native DOM proof is E2E.
function documentBoundary() {
  const listeners = new Map();
  const element = {
    dataset: {}, open: false, innerHTML: "",
    setAttribute() {}, querySelector() { return null; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    showModal() { this.open = true; }, close() { this.open = false; },
    replaceChildren() { this.innerHTML = ""; },
  };
  const document = new EventTarget();
  document.body = { append() {} };
  document.activeElement = document.body;
  document.visibilityState = "visible";
  document.createElement = () => element;
  document.querySelector = () => null;
  const clickLogout = () => listeners.get("click")({ target: { closest: () => ({
    dataset: {}, hasAttribute: name => name === "data-logout",
  }) } });
  return { document, element, clickLogout };
}
async function fixture() {
  const dom = documentBoundary(), values = new Map(), transitions = [], completed = [];
  let release, reached, dialog;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  let session = { authenticated: true, account: { id: "alice", username: "alice", displayName: "Alice", preferences: {} }, contextId: "a".repeat(64), expiresAt: Date.now() + 86400000 };
  const controller = createAccountController({
    document: dom.document, eventTarget: new EventTarget(), channelFactory: null,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    fetcher: async url => {
      if (url.endsWith("/bootstrap")) return Response.json({ authProtocolVersion: 2, accountsRequired: true });
      if (url.endsWith("/logout")) { reached(); await held; session = { authenticated: false }; }
      return Response.json({ ok: true, ...session });
    },
    onTransition: (next, source) => { transitions.push(next); dialog?.onTransition(source); },
  });
  dialog = createAccountDialog({ controller, document: dom.document, onComplete: intent => completed.push(intent) });
  await controller.start();
  return { ...dom, controller, dialog, values, completed, transitions, release, started };
}

test("completed old logout does not retire a newer sign-in dialog", async () => {
  const f = await fixture();
  let logout;
  try {
    f.dialog.open("account");
    logout = f.clickLogout();
    await f.started;
    assert.equal(f.controller.snapshot().session.authenticated, false);
    assert.equal(f.controller.snapshot().pendingLogout, true);
    assert.equal(f.dialog.isOpen(), false, "initial retirement must clear old account fields");
    f.dialog.open("login");
    const loginMarkup = f.element.innerHTML;
    assert.match(loginMarkup, /Log in to start playing/);
    await assert.rejects(f.controller.act("login", {}), /logout_pending/, "new login cannot acquire authority before revocation completes");
    f.release(); await logout;
    assert.equal(f.controller.snapshot().pendingLogout, false);
    assert.equal(f.values.has(LOGOUT_PENDING_KEY), false);
    assert.equal(f.dialog.isOpen(), true, "old logout completion must not close the new sign-in flow");
    assert.equal(f.element.innerHTML, loginMarkup);
    assert.equal(f.completed.length, 0, "old dialog completion must not complete the new flow");
    f.controller.retire({ authenticated: false });
    assert.equal(f.dialog.isOpen(), false, "unrelated authority transitions still retire secret-bearing forms");
  } finally { f.release(); await logout; f.controller.destroy(); }
});

for (const next of [{ authenticated: false }, { authenticated: true, account: { id: "bob" }, contextId: "b".repeat(64) }]) test(`unrelated authority retirement still clears a pending sign-in flow (${next.authenticated ? "other account" : "anonymous"})`, async () => {
  const f = await fixture();
  let logout;
  try {
    f.dialog.open("account");
    logout = f.clickLogout(); await f.started;
    f.dialog.open("login");
    f.controller.retire(next);
    assert.equal(f.dialog.isOpen(), false);
    assert.equal(f.element.innerHTML, "");
    f.release(); await logout;
    assert.equal(f.controller.snapshot().session.authenticated, next.authenticated);
    assert.equal(f.controller.canPlay(), false, "pending logout still prevents authority after an unrelated transition");
  } finally { f.release(); await logout; f.controller.destroy(); }
});


test("a completion marker from another generation cannot preserve a form", async () => {
  const f = await fixture();
  let logout;
  try {
    f.dialog.open("account"); logout = f.clickLogout(); await f.started;
    f.dialog.open("login");
    f.dialog.onTransition({ completedLogoutGeneration: f.controller.snapshot().generation - 1 });
    assert.equal(f.dialog.isOpen(), false);
    assert.equal(f.element.innerHTML, "");
    f.release(); await logout;
    assert.equal(f.dialog.isOpen(), false);
  } finally { f.release(); await logout; f.controller.destroy(); }
});
