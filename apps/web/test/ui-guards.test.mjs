import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const shellHostSource = readFileSync(join(testDir, "..", "board", "hosts", "shell-host.js"), "utf8");

test("game controls do not render standalone record-move or end-turn buttons", () => {
  assert.doesNotMatch(source, /data-action="record-move"/);
  assert.doesNotMatch(source, /data-action="end-turn"/);
  assert.doesNotMatch(source, /getActionType:\s*\(\)\s*=>\s*"pass"/);
  assert.match(shellHostSource, /boardMessage:\s*\{\s*type:\s*"move_sent"/);
  assert.match(shellHostSource, /control:\s*getControlLabel/);
  assert.match(shellHostSource, /boardMessage:\s*\{\s*type:\s*"turn_ended"\s*\}/);
});

test("UI hides join-player unless canJoinAsPlayer and showJoinActions", () => {
  assert.match(source, /game\.canJoinAsPlayer\s*&&\s*game\.showJoinActions/);
  assert.match(source, /data-action="join-player"/);
});

test("UI hides join-viewer unless canJoinAsViewer", () => {
  assert.match(source, /game\.canJoinAsViewer/);
  assert.match(source, /data-action="join-viewer"/);
});

test("UI disables approve unless requester is in approvableRequesterIds", () => {
  assert.match(source, /game\.approvableRequesterIds\.includes\(request\.identityId\)/);
});

test("approvable player requests use blocking accept-or-ignore gate", () => {
  assert.match(source, /data-action="accept-request"/);
  assert.match(source, /data-action="ignore-request"/);
  assert.match(source, /renderApprovalGate/);
  assert.match(source, /invite-gate-content/);
});

test("game, join/invite, and history use shared section spacing structure", () => {
  assert.match(source, /class="row section-actions"/);
  assert.match(source, /class="section-followup"/);
  assert.match(source, /class="section-stack"/);
  assert.match(source, /class="history-turn-body"/);
});

test("offline toggles sync current identity presence", () => {
  assert.match(source, /await syncCurrentIdentityPresence\(!next\)/);
  assert.match(source, /void syncCurrentIdentityPresence\(true\)/);
  assert.match(source, /void syncCurrentIdentityPresence\(false\)/);
});

test("invite acceptance skips one immediate game hydration fetch and relies on join response state", () => {
  assert.match(source, /const skipNextGameHydrationForGameId = new Set\(\);/);
  assert.match(source, /const markSkipNextGameHydration = \(gameId\) => \{/);
  assert.match(source, /const consumeSkipNextGameHydration = \(gameId\) => \{/);
  assert.match(source, /if \(!consumeSkipNextGameHydration\(currentRoute\.gameId\)\) \{\s*await transport\.loadGame\(currentRoute\.gameId, \{ openAsViewer: false \}\);\s*\}/s);
  assert.match(source, /if \(action === "accept-invite-viewer"\) \{\s*markSkipNextGameHydration\(gameId\);\s*\}/s);
  assert.match(source, /if \(action === "accept-invite-player"\) \{\s*markSkipNextGameHydration\(gameId\);\s*\}/s);
});
