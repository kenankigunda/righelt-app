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
  assert.match(source, /const renderSectionActions = \(actions\) => \{/);
  assert.match(source, /if \(items\.length === 0\) \{\s*return "";\s*\}/s);
  assert.match(source, /class="section-followup"/);
  assert.match(source, /class="section-stack"/);
  assert.match(source, /<div class="section-followup">\s*\$\{historyStatusLine\}\s*\$\{historyBanner\}\s*<ol class="history-list">\$\{historyRows\}<\/ol>/s);
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
});

test("history live-return control stays mounted during busy history navigation", () => {
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
  assert.match(source, /data-action="return-live"[^`]*\$\{busy \? "disabled" : ""\}/);
  assert.doesNotMatch(source, /if \(game\.inHistoryMode && activeTurn\.moveIndexes\.length > 0\) \{/);
});

test("app does not call removed presence endpoint helpers", () => {
  assert.doesNotMatch(source, /syncCurrentIdentityPresence/);
  assert.doesNotMatch(source, /setParticipantConnected/);
});

test("invite choice commit suppresses repeat game-route invite gate and join actions commit choice", () => {
  assert.match(source, /const inviteChoiceCommittedByGameId = new Set\(\);/);
  assert.match(source, /const markInviteChoiceCommitted = \(gameId\) => \{/);
  assert.match(source, /if \(routeName === "game" && inviteChoiceCommittedByGameId\.has\(game\.id\)\) \{\s*return null;\s*\}/s);
  assert.match(source, /if \(action === "join-viewer" \|\| action === "accept-invite-viewer"\)[\s\S]*?markInviteChoiceCommitted\(gameId\);/s);
  assert.match(source, /if \(action === "join-player" \|\| action === "accept-invite-player"\)[\s\S]*?markInviteChoiceCommitted\(gameId\);/s);
  assert.match(source, /if \(currentRoute\.name === "game"\) \{\s*resolvedInvite = null;\s*await transport\.loadGame\(currentRoute\.gameId, \{ openAsViewer: false \}\);\s*routeHydrated = true;\s*return;\s*\}/s);
});

test("game route live sync connection is not gated by participant role", () => {
  assert.match(
    source,
    /const routeKey = liveGameId \? `game:\$\{liveGameId\}` : "none";/s,
  );
});
