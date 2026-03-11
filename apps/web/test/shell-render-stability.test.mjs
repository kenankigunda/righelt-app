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

test("live sync update events defer to passive sync without immediate render", () => {
  assert.match(
    source,
    /if \(payload\?\.type === "game\.updated" \|\| payload\?\.type === "socket\.connected"\) \{\s*void syncRouteDataPassive\(\);\s*return;\s*\}\s*render\(\);/s,
  );
});

test("live sync status renders are deduplicated by stable status key", () => {
  assert.match(source, /let lastWsStatusKey = toStableKey\(wsStatus\);/);
  assert.match(source, /const statusKey = toStableKey\(status\);/);
  assert.match(source, /if \(statusKey === lastWsStatusKey\) \{\s*return;\s*\}/s);
  assert.match(source, /lastWsStatusKey = statusKey;\s*wsStatus = status;\s*render\(\);/s);
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

test("history navigation animates deselection before snapshot swap and queues board transition", () => {
  assert.match(source, /const animateHistoryPress = async \(actionEl\) => \{/);
  assert.match(source, /boardWrapEl\.classList\.add\("history-board-pressing"\);/);
  assert.match(source, /actionEl\.classList\.add\("is-pressing"\);/);
  assert.match(source, /const animateHistoryDeselection = async \(actionEl\) => \{/);
  assert.match(source, /currentSelected\.classList\.add\("is-deselecting"\);/);
  assert.match(source, /const queueHistoryItemTransition = \(\{ gameId, moveIndex \}\) => \{/);
  assert.match(source, /const playHistoryItemTransitionIfNeeded = \(game\) => \{/);
  assert.match(source, /const playBoardTransitionIfNeeded = \(\) => \{/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*queueHistoryItemTransition\(\{ gameId, moveIndex \}\);[\s\S]*queueBoardTransition\(\);[\s\S]*await animateHistoryPress\(actionEl\);[\s\S]*await animateHistoryDeselection\(actionEl\);/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*queueBoardTransition\(\);[\s\S]*await animateHistoryPress\(actionEl\);[\s\S]*await animateHistoryDeselection\(actionEl\);/s);
  assert.match(source, /playHistoryItemTransitionIfNeeded\(game\);\s*playBoardTransitionIfNeeded\(\);\s*void boardRuntime\.loadSnapshot\(/s);
  assert.match(source, /playBoardTransitionIfNeeded\(\);\s*void boardRuntime\.loadSnapshot\(/s);
});
