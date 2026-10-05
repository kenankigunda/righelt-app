import test from "node:test";
import assert from "node:assert/strict";
import { createAccountDialog, canonicalEntryUsername, validEntryUsername } from "../shell/account-dialog.js";

// Exercise production event handlers against a small DOM boundary. Real native
// autofocus, validity and password-manager semantics are additionally browser-tested.
function fixture() {
  const listeners = new Map(), nodes = new Map(), timers = new Map(), lookups = [], acts = [];
  let tick = 0, generation = 0, markup = "";
  const document = { body: { append() {} }, activeElement: null, querySelector() { return null; } };
  function node(key) {
    if (!nodes.has(key)) nodes.set(key, { value: "", type: "password", hidden: false, disabled: false, dataset: {}, textContent: "", setAttribute(name, value) { this[name] = value; }, focus() { document.activeElement = this; }, closest() { return null; }, querySelectorAll() { return []; } });
    return nodes.get(key);
  }
  const element = { dataset: {}, open: false, setAttribute() {}, addEventListener(key, fn) { listeners.set(key, fn); }, showModal() { this.open = true; }, close() { this.open = false; }, replaceChildren() { nodes.clear(); }, querySelector: node, querySelectorAll() { return []; } };
  Object.defineProperty(element, "innerHTML", { get: () => markup, set(value) { markup = value; nodes.clear(); const form = node("form"); form.querySelectorAll = () => [node("button[type=submit]")]; form.reportValidity = () => true; node('[name="username"]').name = "username"; } });
  document.createElement = () => element;
  document.activeElement = document.body;
  const controller = {
    snapshot: () => ({ generation, session: { authenticated: false }, busy: false }),
    lookupUsername(username, { signal }) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); lookups.push({ username, signal, resolve, reject }); return promise; },
    async act(...args) { acts.push(args); },
  };
  const dialog = createAccountDialog({ controller, document, timers: { setTimeout(fn, ms) { assert.equal(ms, 500); timers.set(++tick, fn); return tick; }, clearTimeout(id) { timers.delete(id); } } });
  const click = (attribute) => listeners.get("click")({ preventDefault() {}, target: { closest: () => ({ dataset: {}, hasAttribute: name => name === attribute }) } });
  const type = (value) => { const target = node('[name="username"]'); target.value = value; listeners.get("input")({ target }); };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const debounce = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  dialog.open();
  return { dialog, controller, element, node, type, click, debounce, flush, lookups, acts, timers, document, listeners, retire() { generation++; dialog.onTransition(); } };
}

test("entry username normalization matches fixed ASCII identity and validation", () => {
  assert.equal(canonicalEntryUsername(" \tAlice_1\r\n"), "alice_1");
  assert.equal(validEntryUsername(" Alice_1 "), true);
  for (const value of ["ab", "x".repeat(25), "Álice", "a b", "\u00a0alice"]) assert.equal(validEntryUsername(value), false);
});

test("entry starts with only username; debounce unfurls in place without moving focus", async () => {
  const f = fixture(); await f.flush();
  assert.equal(f.node("[data-password-section]").hidden, true);
  assert.equal(f.node("[data-create]").hidden, false);
  const username = f.node('[name="username"]'), password = f.node('[name="password"]');
  username.focus();
  f.type("Alice"); f.type("Alice_1");
  assert.equal(f.timers.size, 1); assert.equal(f.lookups.length, 0);
  f.debounce(); assert.equal(f.lookups.length, 1);
  f.lookups[0].resolve({ exists: false }); await f.flush();
  assert.equal(f.node('[name="username"]'), username);
  assert.equal(f.node('[name="password"]'), password);
  assert.equal(f.document.activeElement, username);
  assert.equal(password.type, "text"); assert.equal(password.autocomplete, "new-password");
  assert.equal(f.node("button[type=submit]").textContent, "Create account & continue");
});

test("explicit creation expands empty and keeps taken names in creation with an alternate sign-in link", async () => {
  const f = fixture(); await f.flush();
  await f.click("data-create");
  assert.equal(f.node("[data-password-section]").hidden, false);
  assert.equal(f.document.activeElement, f.node('[name="username"]'));
  assert.equal(f.node('[name="password"]').type, "text");
  f.type("Alice"); f.debounce(); f.lookups[0].resolve({ exists: true }); await f.flush();
  assert.equal(f.node("form").dataset.entryMode, "create");
  assert.equal(f.node("button[type=submit]").disabled, true);
  assert.equal(f.node("[data-signin]").hidden, false);
  assert.match(f.node("[data-account-status]").textContent, /taken/);
  f.node('[name="password"]').value = "private password";
  await f.click("data-signin"); f.lookups[1].resolve({ exists: true }); await f.flush();
  assert.equal(f.node('[name="password"]').value, "");
  assert.equal(f.node('[name="password"]').type, "password");
  assert.equal(f.node('[name="password"]').autocomplete, "current-password");
});

test("a pending automatic response cannot change explicit creation or reveal a previous password", async () => {
  const f = fixture(); f.type("Alice"); f.debounce();
  await f.click("data-create");
  assert.equal(f.lookups[0].signal.aborted, true);
  f.node('[name="password"]').value = "new password";
  f.lookups[0].resolve({ exists: true }); await f.flush();
  assert.equal(f.node("form").dataset.lookupState, "pending");
  f.lookups[1].resolve({ exists: false }); await f.flush();
  assert.equal(f.node("form").dataset.entryMode, "create");
  assert.equal(f.node('[name="password"]').value, "new password");
  assert.equal(f.node("button[type=submit]").disabled, false);
});

test("canonical username edits clear secrets; formatting edits retain fields and completed lookup", async () => {
  const f = fixture(); f.type("Alice"); f.debounce(); f.lookups[0].resolve({ exists: true }); await f.flush();
  f.node('[name="password"]').value = "keep this secret";
  f.type(" ALICE ");
  assert.equal(f.node('[name="password"]').value, "keep this secret");
  assert.equal(f.timers.size, 0);
  f.type("Bob");
  assert.equal(f.node('[name="password"]').value, "");
  assert.equal(f.node("[data-password-section]").hidden, true);
});

test("lookup failure stays unavailable until explicit retry and retired dialogs ignore late output", async () => {
  const f = fixture(); await f.click("data-create"); f.type("Alice"); f.debounce();
  f.lookups[0].reject(new Error("network")); await f.flush();
  assert.equal(f.node("form").dataset.lookupState, "error");
  assert.equal(f.node("button[type=submit]").disabled, true);
  assert.equal(f.node("[data-lookup-retry]").hidden, false);
  await f.click("data-lookup-retry"); assert.equal(f.lookups.length, 2);
  f.retire(); assert.equal(f.dialog.isOpen(), false);
  f.lookups[1].resolve({ exists: false }); await f.flush();
  assert.equal(f.dialog.isOpen(), false); assert.equal(f.acts.length, 0);
});

test("Enter checks immediately and focuses password without submitting credentials", async () => {
  const f = fixture(); f.type("Alice");
  let prevented = false;
  f.listeners.get("keydown")({ key: "Enter", target: f.node('[name="username"]'), preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.timers.size, 0);
  assert.equal(f.lookups.length, 1);
  f.lookups[0].resolve({ exists: true }); await f.flush();
  assert.equal(f.document.activeElement, f.node('[name="password"]')); assert.equal(f.acts.length, 0);
});

for (const checkedName of ["Alice", " ALICE "]) test(`unchanged canonical username Enter retains the creation password and visibility (${checkedName})`, async () => {
  const f = fixture(); f.type("Alice"); f.debounce(); f.lookups[0].resolve({ exists: false }); await f.flush();
  const password = f.node('[name="password"]');
  password.value = "new private password";
  password.type = "password";
  const toggle = f.node('[data-toggle="password"]');
  toggle.textContent = "Show";
  f.type(checkedName);
  f.listeners.get("keydown")({ key: "Enter", target: f.node('[name="username"]'), preventDefault() {} });
  assert.equal(f.lookups.length, 2);
  f.lookups[1].resolve({ exists: false }); await f.flush();
  assert.equal(password.value, "new private password");
  assert.equal(password.type, "password");
  assert.equal(toggle.textContent, "Show");
  assert.equal(f.document.activeElement, password);
  assert.equal(f.acts.length, 0);
});

test("repeated Enter and failed rechecks retain the last resolved creation mode", async () => {
  const f = fixture(); f.type("Alice"); f.debounce(); f.lookups[0].resolve({ exists: false }); await f.flush();
  const password = f.node('[name="password"]');
  password.value = "new private password";
  password.type = "password";
  const enter = () => f.listeners.get("keydown")({ key: "Enter", target: f.node('[name="username"]'), preventDefault() {} });
  enter(); enter();
  assert.equal(f.lookups[1].signal.aborted, true);
  f.lookups[2].reject(new Error("network")); await f.flush();
  await f.click("data-lookup-retry");
  f.lookups[3].resolve({ exists: false }); await f.flush();
  f.lookups[1].resolve({ exists: true }); await f.flush();
  assert.equal(password.value, "new private password");
  assert.equal(password.type, "password");
  assert.equal(f.node("button[type=submit]").textContent, "Create account & continue");
});
