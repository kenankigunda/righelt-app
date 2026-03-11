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

test("withBusy only repaints immediately for actions that need visible busy state", () => {
  assert.match(source, /const withBusy = async \(fn, \{ renderStart = true, renderEnd = true \} = \{\}\) => \{/);
  assert.match(source, /if \(renderStart\) \{\s*render\(\);\s*\}/s);
  assert.match(source, /const shouldRenderBusyState =\s*action !== "copy-invite" &&[\s\S]*action !== "jump-history" &&[\s\S]*action !== "return-live"/s);
  assert.match(source, /\}, \{ renderStart: shouldRenderBusyState \}\);/);
});

test("history navigation uses pointer-down press state without post-swap transition animation", () => {
  assert.match(source, /const startHistoryPress = \(actionEl\) => \{/);
  assert.match(source, /const clearHistoryPress = \(\) => \{/);
  assert.match(source, /boardWrapEl\.classList\.add\("history-board-pressing"\);/);
  assert.match(source, /window\.addEventListener\("pointerup", \(event\) => \{[\s\S]*action === "jump-history" \|\| action === "return-live"[\s\S]*return;[\s\S]*clearHistoryPress\(\);\s*\}\);/s);
  assert.match(source, /appEl\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*action !== "jump-history" && action !== "return-live"[\s\S]*startHistoryPress\(actionEl\);/s);
  assert.match(source, /const animateHistoryDeselection = async \(actionEl\) => \{/);
  assert.match(source, /currentSelected\.classList\.add\("is-deselecting"\);/);
  assert.doesNotMatch(source, /queueHistoryItemTransition/);
  assert.doesNotMatch(source, /playHistoryItemTransitionIfNeeded/);
  assert.doesNotMatch(source, /queueBoardTransition/);
  assert.doesNotMatch(source, /playBoardTransitionIfNeeded/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*clearHistoryPress\(\);[\s\S]*await animateHistoryDeselection\(actionEl\);/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*clearHistoryPress\(\);[\s\S]*await animateHistoryDeselection\(actionEl\);/s);
});
