import test from "node:test";
import assert from "node:assert/strict";
import { loadDebugFlyoutOpen, saveDebugFlyoutOpen } from "../shell/persistence.js";

const createStorage = () => {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
};

test("debug flyout preference defaults closed and persists as local state", () => {
  const storage = createStorage();
  assert.equal(loadDebugFlyoutOpen(storage), false);
  saveDebugFlyoutOpen(storage, true);
  assert.equal(loadDebugFlyoutOpen(storage), true);
  saveDebugFlyoutOpen(storage, false);
  assert.equal(loadDebugFlyoutOpen(storage), false);
});
