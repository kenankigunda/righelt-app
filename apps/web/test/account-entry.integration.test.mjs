import test from "node:test";
import assert from "node:assert/strict";
import { createAccountDialog, canonicalEntryUsername, validEntryUsername } from "../shell/account-dialog.js";

// Production handlers at a DOM boundary; native autofill/focus/validity are E2E.
function fixture({ failBlocklist = false } = {}) {
  const listeners = new Map(), nodes = new Map(), timers = new Map(), lookups = [], acts = [], assets = [];
  let tick = 0, generation = 0, markup = "";
  const document = { body: { append() {} }, activeElement: null, querySelector() { return null; } };
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { value: "", type: "text", hidden: false, disabled: false, dataset: {}, textContent: "", setAttribute(name, value) { this[name] = value; }, focus() { document.activeElement = this; }, closest() { return null; }, querySelectorAll() { return []; } });
    return nodes.get(key);
  }
  const query = key => key === "input" ? [...nodes.values()].find(value => value.name) : nodes.get(key) || null;
  const element = { dataset: {}, open: false, setAttribute() {}, addEventListener(key, fn) { listeners.set(key, fn); }, showModal() { this.open = true; }, close() { this.open = false; }, replaceChildren() { nodes.clear(); markup = ""; }, querySelector: query, querySelectorAll() { return []; } };
  Object.defineProperty(element, "innerHTML", { get: () => markup, set(value) {
    markup = value; nodes.clear(); const form = node("form"); form.querySelectorAll = () => [node("button[type=submit]")];
    form.dataset.entryMode = value.match(/data-entry-mode="([^"]+)"/)?.[1];
    for (const match of value.matchAll(/<input ([^>]+)>/g)) {
      const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(part => [part[1], part[2]]));
      Object.assign(node(`[name="${attrs.name}"]`), attrs);
    }
    for (const key of ["data-account-status", "data-username-status", "data-forgot"]) if (value.includes(key)) node(`[${key}]`);
    for (const key of ["length", "differentFromUsername", "notCommon"]) if (value.includes(`data-requirement="${key}"`)) node(`[data-requirement="${key}"]`);
    node("button[type=submit]");
  } });
  document.createElement = () => element; document.activeElement = document.body;
  const controller = {
    snapshot: () => ({ generation, session: { authenticated: true, account: { username: "Alice", displayName: "Alice" } }, busy: false }),
    lookupUsername(username, { signal }) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); lookups.push({ username, signal, resolve, reject }); return promise; },
    async act(...args) { acts.push(args); }, async updateAccount(patch) { acts.push(["updateAccount", patch]); },
  };
  const dialog = createAccountDialog({ controller, document, fetcher: async url => { assets.push(url); if (failBlocklist) throw new Error("offline"); return Response.json(["password", "password123"]); }, timers: { setTimeout(fn, ms) { timers.set(++tick, { fn, ms }); return tick; }, clearTimeout(id) { timers.delete(id); } } });
  const click = (attribute) => listeners.get("click")({ preventDefault() {}, target: { closest: () => ({ dataset: {}, hasAttribute: name => name === attribute }) } });
  const input = (name, value, event = "input") => { const target = node(`[name="${name}"]`); target.name = name; target.value = value; listeners.get(event)({ target }); };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const debounce = () => { for (const [id, { fn, ms }] of [...timers]) if (ms === 500) { timers.delete(id); fn(); } };
  const submit = async () => {
    const original = globalThis.FormData;
    globalThis.FormData = class { constructor() { return [...nodes.values()].filter(value => value.name).map(value => [value.name, value.value]); } };
    try { await listeners.get("submit")({ preventDefault() {}, target: node("form") }); } finally { globalThis.FormData = original; }
  };
  dialog.open();
  return { dialog, controller, element, node, input, click, debounce, flush, lookups, acts, assets, timers, document, listeners, submit, retire() { generation++; dialog.onTransition(); } };
}

test("entry username validation uses fixed ASCII identity", () => {
  assert.equal(canonicalEntryUsername(" \tAlice_1\r\n"), "alice_1");
  assert.equal(validEntryUsername(" Alice_1 "), true);
  for (const value of ["ab", "x".repeat(25), "Álice", "a b", "\u00a0alice"]) assert.equal(validEntryUsername(value), false);
});

test("sign-in exposes both credentials immediately and never looks up usernames or loads password policy", async () => {
  const f = fixture(); f.input("username", "NewName"); f.input("password", "short"); f.debounce(); await f.flush();
  assert.match(f.element.innerHTML, /Log in to start playing/);
  assert.equal(f.node('[name="password"]').type, "password");
  assert.equal(f.node('[name="password"]').autocomplete, "current-password");
  assert.equal(f.lookups.length, 0); assert.equal(f.assets.length, 0);
  await f.submit(); assert.equal(f.acts[0][0], "login");
  assert.equal(f.acts[0][1].password, "short", "sign-in must not impose creation password policy");
});

test("separate forms retain username/display-name drafts and clear passwords on switches", async () => {
  const f = fixture(); f.input("username", "Alice"); f.input("password", "private old password");
  await f.click("data-create"); await f.flush();
  assert.match(f.element.innerHTML, /<h2[^>]*>Create account<\/h2>/);
  assert.equal(f.document.activeElement, f.node('[name="username"]'));
  assert.equal(f.node('[name="password"]').value, ""); assert.equal(f.node('[name="password"]').type, "text");
  assert.equal(f.node('[name="displayName"]').placeholder, "Alice"); assert.equal(f.node('[name="displayName"]').value, "");
  f.input("displayName", "Alice Example"); f.input("password", "private new password");
  await f.click("data-signin");
  assert.equal(f.node('[name="username"]').value, "Alice"); assert.equal(f.node('[name="password"]').value, "");
  await f.click("data-create");
  assert.equal(f.node('[name="displayName"]').value, "Alice Example");
  f.input("username", "Bob"); assert.equal(f.node('[name="displayName"]').placeholder, "Bob");
});

test("creation availability is debounced, advisory and never changes form or typed password", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  f.input("username", "Alice"); f.input("username", "Alice_1"); f.input("password", "a private password");
  assert.equal(f.lookups.length, 0); f.debounce(); assert.equal(f.lookups.length, 1);
  const password = f.node('[name="password"]'); password.type = "password";
  f.lookups[0].resolve({ exists: true }); await f.flush();
  assert.equal(f.node("form").dataset.entryMode, "create");
  assert.equal(password.value, "a private password"); assert.equal(password.type, "password");
  assert.equal(f.node("button[type=submit]").disabled, false);
  await f.submit(); assert.equal(f.acts.length, 0); assert.equal(f.document.activeElement, f.node('[name="username"]'));
  f.input("username", "Bob"); assert.equal(password.value, "a private password");
  f.debounce(); f.lookups[1].reject(new Error("offline")); await f.flush();
  assert.equal(f.node("form").dataset.lookupState, "error");
  await f.submit(); assert.equal(f.acts[0][0], "register");
});

test("creation lookup cannot update the sign-in form after switching or a retired dialog", async () => {
  const f = fixture(); await f.click("data-create"); f.input("username", "Alice"); f.debounce();
  await f.click("data-signin"); f.lookups[0].resolve({ exists: true }); await f.flush();
  assert.equal(f.node("form").dataset.entryMode, "login");
  assert.equal(f.node('[name="password"]').type, "password");
  await f.click("data-create"); f.debounce(); f.retire();
  f.lookups[1].resolve({ exists: false }); await f.flush(); assert.equal(f.dialog.isOpen(), false); assert.equal(f.acts.length, 0);
});

test("password requirements begin neutral then update from password and username without replacing fields", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  assert.equal(f.node('[data-requirement="length"]').dataset.state, "neutral");
  const password = f.node('[name="password"]');
  f.input("username", "different"); f.input("password", "password123", "change");
  assert.equal(f.node('[data-requirement="length"]').dataset.state, "met");
  assert.equal(f.node('[data-requirement="notCommon"]').dataset.state, "unmet");
  await f.submit(); assert.equal(f.acts.length, 0); assert.equal(f.document.activeElement, password);
  f.input("password", "unique_username"); f.input("username", "unique_username");
  assert.equal(f.node('[data-requirement="differentFromUsername"]').dataset.state, "unmet");
  assert.equal(f.node('[name="password"]'), password); assert.equal(password.value, "unique_username");
});

test("blocklist failure is disclosed and server submission remains available", async () => {
  const f = fixture({ failBlocklist: true }); await f.click("data-create"); await f.flush();
  f.input("username", "Alice"); f.input("password", "very unique password");
  assert.equal(f.node('[data-requirement="notCommon"]').dataset.state, "unavailable");
  assert.match(f.node('[data-requirement="notCommon"]').textContent, /checked when you submit/);
  await f.submit(); assert.equal(f.acts[0][0], "register"); assert.equal(f.acts[0][1].displayName, "");
});

test("live autofilled values receive validation even without input events", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  f.node('[name="username"]').value = "Alice"; f.node('[name="password"]').value = "short";
  await f.submit(); assert.equal(f.acts.length, 0); assert.equal(f.document.activeElement, f.node('[name="password"]'));
  f.node('[name="password"]').value = "another unique password";
  await f.submit(); assert.equal(f.acts[0][0], "register");
});

test("Account offers only display-name save and credential actions; password change needs no old password", async () => {
  const f = fixture(); f.dialog.open("account");
  assert.doesNotMatch(f.element.innerHTML, /View preference|Replay tutorial|Switch account|Tutorial:/);
  assert.match(f.element.innerHTML, />Save<\/button>/);
  f.input("displayName", "New Name"); await f.submit(); assert.deepEqual(f.acts[0], ["updateAccount", { displayName: "New Name" }]);
  f.dialog.open("password"); await f.flush();
  assert.equal(f.node('[name="newPassword"]').type, "password");
  f.input("newPassword", "a new private password"); await f.submit();
  assert.deepEqual(f.acts[1].slice(0, 2), ["password", { newPassword: "a new private password" }]);
});

test("repeated Enter cannot duplicate an account save while the request is pending", async () => {
  const f = fixture(); f.dialog.open("account");
  let release;
  const held = new Promise(resolve => { release = resolve; });
  f.controller.updateAccount = async patch => { f.acts.push(["updateAccount", patch]); await held; };
  f.input("displayName", "Saved once");
  const first = f.submit();
  assert.equal(f.node("button[type=submit]").disabled, true);
  await f.submit(); assert.equal(f.acts.length, 1);
  release(); await first;
  assert.equal(f.node("button[type=submit]").disabled, false);
});
