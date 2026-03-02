import test from "node:test";
import assert from "node:assert/strict";
import { getBootstrapCachePolicy, getBootstrapPayload, shouldDeferNonCriticalLoad } from "../shell/bootstrap.js";

test("bootstrap payload is deterministic and referentially stable", () => {
  const a = getBootstrapPayload();
  const b = getBootstrapPayload();
  assert.equal(a, b);
  assert.equal(a.app, "righelt-web-shell");
  assert.ok(Array.isArray(a.tutorialSteps));
  assert.ok(Object.isFrozen(a));
});

test("bootstrap cache policy is explicit and supports stale-while-revalidate", () => {
  const policy = getBootstrapCachePolicy();
  assert.match(policy, /s-maxage=/);
  assert.match(policy, /stale-while-revalidate=/);
});

test("non-critical load defers until first render completes", () => {
  assert.equal(shouldDeferNonCriticalLoad({ firstRenderComplete: false }), false);
  assert.equal(shouldDeferNonCriticalLoad({ firstRenderComplete: true }), true);
});
