import test from "node:test";
import assert from "node:assert/strict";
import { captureHeaderFocus, restoreHeaderFocus } from "../shell/header-focus.js";

const fixture = () => {
  const attributes = { "data-flyout-link": "home" };
  const old = { isConnected: false, getAttribute: (key) => attributes[key] ?? null };
  let focused = 0;
  const next = { getAttribute: old.getAttribute, closest: () => null, focus: (options) => {
    assert.equal(options.preventScroll, true); focused++;
  } };
  const header = { contains: (node) => node === old, querySelectorAll: () => [next] };
  const body = {};
  const document = { body, activeElement: body };
  return { old, next, header, document, focused: () => focused };
};

test("header replacement restores the same semantic control without scrolling", () => {
  const f = fixture();
  const saved = captureHeaderFocus(f.header, f.old);
  restoreHeaderFocus(f.header, saved, f.document);
  assert.equal(f.focused(), 1);
});

test("focus outside chrome or deliberately moved elsewhere is preserved", () => {
  const f = fixture();
  assert.equal(captureHeaderFocus(f.header, {}), null);
  f.document.activeElement = {};
  restoreHeaderFocus(f.header, captureHeaderFocus(f.header, f.old), f.document);
  assert.equal(f.focused(), 0);
});

test("operation-specific alerts are excluded from persistent chrome restoration", () => {
  const f = fixture();
  f.old.getAttribute = (key) => key === "data-action" ? "dismiss-failed-operation" : null;
  f.old.closest = (selector) => selector === "[data-shell-alert-zone]" ? {} : null;
  assert.equal(captureHeaderFocus(f.header, f.old), null);
});

test("still-connected, hidden and removed controls never steal focus", () => {
  const f = fixture();
  const saved = captureHeaderFocus(f.header, f.old);
  f.old.isConnected = true;
  restoreHeaderFocus(f.header, saved, f.document);
  f.old.isConnected = false;
  f.next.closest = () => ({});
  restoreHeaderFocus(f.header, saved, f.document);
  f.header.querySelectorAll = () => [];
  restoreHeaderFocus(f.header, saved, f.document);
  assert.equal(f.focused(), 0);
});
