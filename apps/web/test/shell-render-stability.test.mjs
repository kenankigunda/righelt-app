import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");

test("shell render commits markup only when it changes", () => {
  assert.match(source, /let lastRenderedMarkup = "";/);
  assert.match(source, /const nextMarkup = `\$\{renderHeader\(\)\}\$\{body\}`;/);
  assert.match(source, /if \(nextMarkup !== lastRenderedMarkup\) \{\s*appEl\.innerHTML = nextMarkup;\s*lastRenderedMarkup = nextMarkup;\s*\}/s);
  assert.equal((source.match(/appEl\.innerHTML\s*=/g) || []).length, 1);
});

test("live sync applies authoritative pushed game payloads before render", () => {
  assert.match(
    source,
    /if \(\s*\(payload\?\.type === "state_sync" \|\|\s*payload\?\.type === "event_appended" \|\|\s*payload\?\.type === "presence_changed" \|\|\s*payload\?\.type === "join_request_created" \|\|\s*payload\?\.type === "join_request_resolved"\)\s*&&\s*payload\?\.game\s*\) \{\s*transport\.applyLiveGameUpdate\(\{ game: payload\.game, eventSeq: payload\.eventSeq \}\);\s*\}\s*render\(\);/s,
  );
});

test("live sync status renders are deduplicated by stable status key", () => {
  assert.match(source, /let lastWsStatusKey = toStableKey\(wsStatus\);/);
  assert.match(source, /const statusKey = toStableKey\(status\);/);
  assert.match(source, /if \(statusKey === lastWsStatusKey\) \{\s*return;\s*\}/s);
  assert.match(source, /lastWsStatusKey = statusKey;\s*wsStatus = status;\s*if \(status\.state === "closed" && status\.reconnectAttempts >= 3\) \{\s*void syncRouteDataPassive\(\);\s*\}\s*render\(\);/s);
});

test("syncLiveChannel does not disconnect/reconnect while same route is still connecting", () => {
  assert.match(
    source,
    /if \(routeKey === liveSyncConnectedRoute && \(wsStatus\.state === "connected" \|\| wsStatus\.state === "connecting"\)\) \{\s*return;\s*\}/s,
  );
});

test("history renderer emits move-only rows without visible turn wrappers", () => {
  assert.doesNotMatch(source, /class="history-turn"/);
  assert.doesNotMatch(source, /class="history-turn-header"/);
  assert.doesNotMatch(source, /class="history-turn-list"/);
  assert.match(source, /const moveRows = game\.turns\.flatMap/);
});
