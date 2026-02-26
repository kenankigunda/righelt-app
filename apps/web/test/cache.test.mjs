import test from "node:test";
import assert from "node:assert/strict";
import { getBootstrapCachePolicy } from "../shell/bootstrap.js";

test("cache policy for bootstrap includes edge reuse and stale revalidation", () => {
  const policy = getBootstrapCachePolicy();
  assert.match(policy, /public/);
  assert.match(policy, /s-maxage=60/);
  assert.match(policy, /stale-while-revalidate=300/);
});
