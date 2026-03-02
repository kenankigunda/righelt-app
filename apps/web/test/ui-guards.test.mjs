import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");

test("UI disables record-move based on canRecordMove capability", () => {
  assert.match(source, /game\.canRecordMove\s*&&\s*!busy/);
  assert.match(source, /game\.showOfflineState\s*\?\s*"Record Offline Move"\s*:\s*"Record Live Move"/);
});

test("UI disables end-turn based on canEndTurn capability", () => {
  assert.match(source, /game\.canEndTurn\s*&&\s*!busy/);
});

test("UI disables join-player based on canJoinAsPlayer capability", () => {
  assert.match(source, /game\.canJoinAsPlayer\s*&&\s*game\.showJoinActions\s*&&\s*!busy/);
});

test("UI disables join-viewer based on canJoinAsViewer capability", () => {
  assert.match(source, /game\.canJoinAsViewer\s*&&\s*!busy/);
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

test("offline toggles sync current identity presence", () => {
  assert.match(source, /await syncCurrentIdentityPresence\(!next\)/);
  assert.match(source, /void syncCurrentIdentityPresence\(true\)/);
  assert.match(source, /void syncCurrentIdentityPresence\(false\)/);
});
