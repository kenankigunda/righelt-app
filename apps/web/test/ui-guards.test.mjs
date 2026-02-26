import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "main.js"), "utf8");

test("UI disables record-move based on canRecordMove capability", () => {
  assert.match(source, /game\.canRecordMove\s*&&\s*!busy/);
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
