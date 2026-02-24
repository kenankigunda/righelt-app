import assert from "node:assert/strict";

export function assertHexHash(value) {
  assert.equal(typeof value, "string");
  assert.match(value, /^[a-f0-9]{64}$/);
}
