import test from "node:test";
import assert from "node:assert/strict";
import { createModal } from "../shell/modal.js";

function fixture() {
  const focus = [];
  const control = name => ({ isConnected: true, matches: () => true, focus: options => { assert.equal(options.preventScroll, true); focus.push(name); } });
  const fallback = control("heading");
  const listeners = {};
  const element = { open: false, dataset: {}, setAttribute() {}, querySelector() { return null; }, addEventListener(type, listener) { listeners[type] = listener; }, showModal() { this.open = true; }, close() { this.open = false; } };
  const document = { body: { append() {} }, createElement: () => element, querySelector: selector => selector === "#app" ? { dataset: { actionAffiliation: "blue" } } : fallback };
  return { focus, control, element, listeners, modal: createModal({ document, labelId: "story" }) };
}

test("Escape restores the replacement trigger after background content rerenders", () => {
  const f = fixture(), source = f.control("original"), replacement = f.control("replacement");
  f.modal.open("story", source, () => replacement);
  source.isConnected = false;
  let prevented = false;
  f.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(f.focus, ["replacement"]);
  assert.equal(f.element.open, false);
  assert.equal(f.element.dataset.actionAffiliation, "blue");
});

test("connected trigger stays preferred and missing replacement keeps the heading fallback", () => {
  const f = fixture(), source = f.control("original");
  f.modal.open("story", source, () => f.control("replacement"));
  f.modal.close();
  assert.deepEqual(f.focus, ["original"]);
  f.modal.open("next story", source);
  source.isConnected = false;
  f.modal.close();
  assert.deepEqual(f.focus, ["original", "heading"]);
});
