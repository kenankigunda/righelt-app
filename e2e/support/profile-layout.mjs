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

// Runs as one browser task: never retain handles across a participant rerender.
export function sampleParticipantGeometry() {
  const panel = document.querySelector('[data-game-panel="participants"]');
  const button = panel?.querySelector('[data-testid="participant-player-1"] button');
  if (!panel?.isConnected || !button?.isConnected) return null;
  const box = button.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || panelBox.width <= 0 || panelBox.height <= 0) return null;
  return {
    x: box.x, width: box.width, panelX: panelBox.x, panelWidth: panelBox.width,
    scrollWidth: button.scrollWidth, clientWidth: button.clientWidth,
  };
}
