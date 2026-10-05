import test from "node:test";
import assert from "node:assert/strict";
import { createAccountDialog, canonicalEntryUsername, validEntryUsername } from "../shell/account-dialog.js";

// Production handlers at a DOM boundary; native autofill/focus/validity are E2E.
function fixture({ failBlocklist = false } = {}) {
  const listeners = new Map(), nodes = new Map(), timers = new Map(), lookups = [], acts = [], assets = [];
  let tick = 0, generation = 0, markup = "";
  const document = { body: { append() {} }, activeElement: null, querySelector() { return null; } };
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { value: "", type: "text", hidden: false, disabled: false, dataset: {}, parentElement: { dataset: {} }, textContent: "", setAttribute(name, value) { this[name] = value; }, focus() { document.activeElement = this; }, closest() { return null; }, querySelectorAll() { return []; } });
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
    for (const key of ["data-autosave-status", "data-account-status", "data-username-status", "data-forgot", "data-existing-hint"]) if (value.includes(key)) node(`[${key}]`);
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

test("separate forms retain username and clear passwords on switches", async () => {
  const f = fixture(); f.input("username", "Alice"); f.input("password", "private old password");
  await f.click("data-create"); await f.flush();
  assert.match(f.element.innerHTML, /<h2[^>]*>Create account<\/h2>/);
  assert.equal(f.document.activeElement, f.node('[name="password"]'));
  assert.equal(f.node('[name="password"]').value, ""); assert.equal(f.node('[name="password"]').type, "text");
  assert.doesNotMatch(f.element.innerHTML, /name="displayName"/);
  assert.match(f.element.innerHTML, /<button[^>]+data-signin>Back to sign in<\/button>/);
  f.input("password", "private new password");
  await f.click("data-signin"); await f.flush();
  assert.equal(f.document.activeElement, f.node('[name="password"]'));
  assert.equal(f.node('[name="username"]').value, "Alice"); assert.equal(f.node('[name="password"]').value, "");
  await f.click("data-create");
  assert.equal(f.node('[name="username"]').value, "Alice");
  assert.doesNotMatch(f.element.innerHTML, /name="displayName"/);
});

test("creation availability is debounced, advisory and never changes form or typed password", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  f.input("username", "Alice"); f.input("username", "Alice_1"); f.input("password", "a private password");
  assert.equal(f.lookups.length, 0); f.debounce(); assert.equal(f.lookups.length, 1);
  assert.equal(f.node("[data-username-status]").dataset.state, "pending");
  assert.match(f.node("[data-username-status]").textContent, /^○ Checking/);
  const password = f.node('[name="password"]'); password.type = "password";
  f.lookups[0].resolve({ exists: true }); await f.flush();
  assert.equal(f.node("form").dataset.entryMode, "create");
  assert.equal(f.node("[data-username-status]").dataset.state, "taken");
  assert.match(f.node("[data-username-status]").textContent, /^✕ /);
  assert.equal(password.value, "a private password"); assert.equal(password.type, "password");
  assert.equal(f.node("button[type=submit]").disabled, false);
  await f.submit(); assert.equal(f.acts.length, 0); assert.equal(f.document.activeElement, f.node('[name="username"]'));
  f.input("username", "Bob"); assert.equal(password.value, "a private password");
  assert.equal(f.node("[data-username-status]").dataset.state, "pending");
  assert.equal(f.node("[data-username-status]").dataset.revealed, "true");
  assert.equal(f.lookups.length, 1, "editing does not bypass debounce");
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
  await f.submit(); assert.equal(f.acts[0][0], "register"); assert.equal(Object.hasOwn(f.acts[0][1], "displayName"), false);
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
  assert.doesNotMatch(f.element.innerHTML, />Save<\/button>/);
  assert.match(f.element.innerHTML, /data-autosave-status/);
  f.input("displayName", "New Name"); await f.submit(); assert.deepEqual(f.acts[0], ["updateAccount", { displayName: "New Name" }]);
  f.dialog.open("password"); await f.flush();
  assert.equal(f.node('[name="newPassword"]').type, "text");
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
  const second = f.submit(); assert.equal(f.acts.length, 1);
  release(); await first; await second;
  assert.equal(f.node("[data-autosave-status]").textContent, "Saved");
});


test("sign-in hint waits five seconds after blur and cancels when credentials change", async () => {
  const f = fixture();
  const hint = () => f.node('[data-existing-hint]');
  const blur = () => f.listeners.get("focusout")({ target: f.node('[name="username"]') });
  const wait = () => { for (const [id, { fn, ms }] of [...f.timers]) if (ms === 5000) { f.timers.delete(id); fn(); } };
  await f.flush();
  f.document.activeElement = f.node('[name="password"]');
  f.input("username", "Alice"); blur(); assert.equal(hint().hidden, true);
  wait(); assert.equal(hint().hidden, false);
  f.input("username", "Bob"); assert.equal(hint().hidden, true);
  blur(); f.input("password", "x"); f.input("password", ""); wait(); assert.equal(hint().hidden, true);
  blur(); f.listeners.get("focusin")({ target: f.node('[name="username"]') }); wait(); assert.equal(hint().hidden, true);
  blur(); f.node('[name="password"]').value = "autofilled"; wait(); assert.equal(hint().hidden, true);
  f.input("password", ""); f.input("username", "   "); blur(); wait(); assert.equal(hint().hidden, true);
  f.input("username", "Alice"); blur();
  await f.click("data-create"); await f.click("data-signin"); wait();
  assert.equal(hint().hidden, true); assert.equal(f.lookups.length, 0);
});

test("incorrect credentials show the creation hint immediately; transport errors do not", async () => {
  const f = fixture(); f.input("username", "Alice"); f.input("password", "wrong");
  f.controller.act = async () => { throw { code: "temporarily_unavailable" }; };
  await f.submit(); assert.equal(f.node('[data-existing-hint]').hidden, true);
  f.controller.act = async () => { throw { code: "invalid_credentials" }; };
  await f.submit(); assert.equal(f.node('[data-existing-hint]').hidden, false);
  assert.equal(f.node("[data-account-status]").dataset.state, "error");
  assert.ok(f.element.innerHTML.indexOf('name="password"') < f.element.innerHTML.indexOf("data-account-status"));
  assert.ok(f.element.innerHTML.indexOf("data-account-status") < f.element.innerHTML.indexOf("account-help"));
  f.input("password", "next attempt"); assert.equal(f.node('[data-existing-hint]').hidden, true);
});


test("creation starts in Username only when no username has been entered", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  assert.equal(f.document.activeElement, f.node('[name="username"]'));
  await f.click("data-signin"); f.input("username", "Alice");
  await f.click("data-create-link"); await f.flush();
  assert.equal(f.document.activeElement, f.node('[name="password"]'));
  assert.equal(f.node('[name="username"]').value, "Alice");
});


test("revealed username feedback keeps its row when the name becomes incomplete", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  assert.equal(f.node("[data-username-status]").dataset.revealed, "false");
  f.input("username", "Alice"); f.debounce(); f.lookups[0].resolve({ exists: false }); await f.flush();
  assert.equal(f.node("[data-username-status]").dataset.state, "available");
  f.input("username", ""); f.debounce();
  assert.equal(f.node("[data-username-status]").dataset.revealed, "true");
  assert.equal(f.node("[data-username-status]").textContent, "");
  assert.equal(f.lookups.length, 1);
  await f.click("data-signin"); await f.click("data-create");
  assert.equal(f.node("[data-username-status]").dataset.revealed, "false");
});

test("Close and outside clicks dismiss without treating padding or an inside drag as dismissal", async () => {
  const f = fixture();
  f.element.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 500 });
  f.element.closest = () => null;
  const point = (x, y) => ({ button: 0, target: f.element, clientX: x, clientY: y });
  assert.match(f.element.innerHTML, /data-cancel aria-label="Close"/);
  assert.doesNotMatch(f.element.innerHTML, />Cancel<\/button>/);
  f.listeners.get("pointerdown")(point(110, 110));
  await f.listeners.get("click")(point(110, 110)); assert.equal(f.dialog.isOpen(), true);
  f.listeners.get("pointerdown")(point(110, 110));
  await f.listeners.get("click")(point(50, 50)); assert.equal(f.dialog.isOpen(), true);
  f.listeners.get("pointerdown")(point(50, 50));
  f.listeners.get("pointercancel")();
  await f.listeners.get("click")(point(50, 50)); assert.equal(f.dialog.isOpen(), true);
  f.listeners.get("pointerdown")(point(50, 50));
  await f.listeners.get("click")(point(50, 50)); assert.equal(f.dialog.isOpen(), false);
  f.dialog.open(); await f.click("data-cancel"); assert.equal(f.dialog.isOpen(), false);
});


test("account feedback declares pending, success and error states with concise invalid-input text", async () => {
  const f = fixture(); f.input("username", "Alice"); f.input("password", "secret");
  let release; const held = new Promise(resolve => { release = resolve; });
  f.controller.act = async () => { await held; throw { code: "invalid_input" }; };
  const submitting = f.submit();
  assert.equal(f.node("[data-account-status]").dataset.state, "pending");
  release(); await submitting;
  assert.equal(f.node("[data-account-status]").dataset.state, "error");
  assert.equal(f.node("[data-account-status]").textContent, "Usernames use 3–24 letters, digits or underscores. Passwords need 8–128 characters.");
  f.dialog.open("account"); f.input("displayName", "New Alice"); await f.submit();
  assert.equal(f.node("[data-autosave-status]").textContent, "Saved");
});


test("an empty sign-in password is neutral guidance and focuses Password", async () => {
  const f = fixture(); f.input("username", "Alice"); await f.submit();
  assert.equal(f.node("[data-account-status]").dataset.state, "info");
  assert.equal(f.node("[data-account-status]").textContent, "Enter your password.");
  assert.equal(f.document.activeElement, f.node('[name="password"]'));
  assert.equal(f.acts.length, 0);
});


test("a held control keeps current validation and flushes lookup plus checklist together", async () => {
  const f = fixture(); await f.click("data-create"); await f.flush();
  f.input("username", "NewName"); f.input("password", "password");
  const target = { closest: () => ({}) };
  f.listeners.get("pointerdown")({ button: 0, target });
  f.debounce(); f.lookups[0].resolve({ exists: false }); await f.flush();
  f.input("password", "password123");
  assert.notEqual(f.node("[data-username-status]").dataset.state, "available");
  await f.submit();
  assert.equal(f.acts.length, 0, "held submit still enforces local common-password validation");
  await f.click("unused");
  for (const [id, { fn, ms }] of [...f.timers]) if (ms === 0) { f.timers.delete(id); fn(); }
  assert.equal(f.node("[data-username-status]").dataset.state, "available");
  assert.equal(f.node('[data-requirement="notCommon"]').dataset.state, "unmet");
});
