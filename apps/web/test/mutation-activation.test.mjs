import test from "node:test";
import assert from "node:assert/strict";
import { createMutationActivationFence } from "../board/mutation-activation.js";

test("a held pointer or keyboard activation cannot cross an unavailable interval", () => {
  for (const input of ["pointer", "keyboard"]) {
    const fence = createMutationActivationFence(), target = { input };
    fence.update(false);
    fence.begin(target);
    fence.update(true);
    fence.update(false);
    assert.equal(fence.allow(target), false, input);
    assert.equal(fence.allow(target), true, `${input} needs a fresh activation after the stale press is retired`);
  }
});

test("the activation fence never admits while unavailable and cancels retired page presses", () => {
  const fence = createMutationActivationFence(), target = {};
  fence.update(true); fence.begin(target);
  assert.equal(fence.allow(target), false);
  fence.cancel(); fence.update(false);
  assert.equal(fence.allow(target), true);
});
