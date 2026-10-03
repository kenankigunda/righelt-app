import assert from "node:assert/strict";
import { normalizeDisplayName, normalizeUsername } from "../../apps/web/generated/packages/shared-types/src/auth.js";

// Public maximum-length values exercise wrapping without testing rejection.
export const profileLayoutDisplayName = "VeryLongUnbrokenDisplayName12345";
export const profileLayoutUsername = "LongUnbrokenUsername1234";
assert.equal(profileLayoutDisplayName.length, 32);
assert.deepEqual(normalizeDisplayName(profileLayoutDisplayName, "fallback"), { ok: true, value: profileLayoutDisplayName });
assert.equal(normalizeDisplayName(`${profileLayoutDisplayName}x`, "fallback").ok, false);
assert.equal(profileLayoutUsername.length, 24);
assert.equal(normalizeUsername(profileLayoutUsername).ok, true);
assert.equal(normalizeUsername(`${profileLayoutUsername}x`).ok, false);
