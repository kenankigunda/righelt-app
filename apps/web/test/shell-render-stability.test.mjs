import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");

test("shell render patches same-route game updates without replacing the board panel", () => {
  assert.match(source, /let lastRenderedMarkup = "";/);
  assert.match(source, /const renderGameShellFrame = \(game\) =>/);
  assert.match(source, /id="shell-game-alerts"/);
  assert.match(source, /data-game-shell-root data-game-id=/);
  assert.match(source, /data-game-panel="history"/);
  assert.match(source, /const updateMountedGameShell = \(\{ game, inviteFromRole = null, inviteToken = null, includeBoard = true \} = \{\}\) => \{/);
  assert.match(source, /const mountedGameShell = getMountedGameShellRoot\(\);/);
  assert.match(source, /shouldUseIncrementalGameShell\(\)/);
  assert.match(source, /updateMountedGameShell\(\{\s*game: transport\.getGameViewModel\(currentRoute\.gameId\),/s);
  assert.match(source, /includeBoard: change\?\.type !== "optimistic_enqueue"/);
  assert.match(source, /const getAnimatedPanels = \(\) =>/);
  assert.match(source, /const capturePanelHeights = \(\) =>/);
  assert.match(source, /const previousPanelHeights = animatePanels \? capturePanelHeights\(\) : \[\];/);
  assert.match(source, /const animatePanelHeightChange = \(panelEl, fromHeight\) => \{/);
  assert.match(source, /const animatePanelHeightChanges = \(previousPanelHeights\) => \{/);
  assert.match(source, /querySelectorAll\("\.panel"\)/);
  assert.match(source, /class="panel" data-shell-panel="board"/);
  assert.match(source, /const nextMarkup = `\$\{renderHeader\(\)\}\$\{body\}`;/);
  assert.match(source, /if \(nextMarkup !== lastRenderedMarkup\) \{\s*appEl\.innerHTML = nextMarkup;\s*lastRenderedMarkup = nextMarkup;[\s\S]*if \(animatePanels\) \{\s*animatePanelHeightChanges\(previousPanelHeights\);\s*\}\s*\}/s);
  assert.equal((source.match(/appEl\.innerHTML\s*=/g) || []).length, 1);
  assert.doesNotMatch(source, /replaceWith\(previousBoardPanel\)/);
});

test("live sync applies authoritative pushed game payloads before render", () => {
  assert.match(source, /payload\?\.type === "state_sync"/);
  assert.match(source, /payload\?\.type === "event_appended"/);
  assert.match(source, /transport\.applyLiveGameUpdate\(\{ game: payload\.game, eventSeq: payload\.eventSeq, clientCommandId: payload\.clientCommandId \?\? null \}\);/);
  assert.match(source, /if \(document\.getElementById\("shell-header-last-event"\)\) \{\s*updateHeaderFields\(\);\s*\} else \{\s*render\(\{ animatePanels: false, includeBoard: false \}\);\s*\}/s);
});

test("live sync status renders are deduplicated by stable status key", () => {
  assert.match(source, /let lastWsStatusKey = toStableKey\(wsStatus\);/);
  assert.match(source, /const statusKey = toStableKey\(status\);/);
  assert.match(source, /if \(statusKey === lastWsStatusKey\) \{\s*return;\s*\}/s);
  assert.match(source, /lastWsStatusKey = statusKey;\s*wsStatus = status;\s*if \(status\.state === "closed" && status\.reconnectAttempts >= 3\) \{\s*void syncRouteDataPassive\(\);\s*\}[\s\S]*updateHeaderFields\(\);/s);
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
  assert.match(source, /const pendingRows = \(Array\.isArray\(game\.pendingMoves\) \? game\.pendingMoves : \[\]\)\.map/);
  assert.match(source, /class="history-item history-item-pending/);
  assert.match(source, /Pending<\/span>/);
  assert.match(source, /const emptyTurnText = "Waiting on next move\.\.\."/);
  assert.match(source, /: `<div class="history-empty-line/);
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
  assert.match(source, /const hasHistoryMoves = Array\.isArray\(game\.moves\) && game\.moves\.length > 0;/);
  assert.match(source, /: hasHistoryMoves\s*\? '<p class="small">You are on the live view\.<\/p><p class="small">Click moves below to see historical state\.<\/p>'\s*: '<p class="small">You are on the live view\.<\/p>'/);
});

test("transport subscriptions drive immediate game-shell updates", () => {
  assert.match(source, /transport\.subscribe\(\(change\) => \{\s*render\(\{\s*animatePanels: false,\s*includeBoard: change\?\.type !== "optimistic_enqueue",\s*\}\);\s*\}\);/s);
  assert.match(source, /const shouldUseIncrementalGameShell = \(gameId = currentRoute\.gameId\) => \{/);
  assert.match(source, /if \(currentRoute\.name === "game"\) \{\s*if \(shouldUseIncrementalGameShell\(\)\) \{\s*updateMountedGameShell\(\{/s);
});

test("withBusy only repaints immediately for actions that need visible busy state", () => {
  assert.match(source, /const withBusy = async \(fn, \{ renderStart = true, renderEnd = true \} = \{\}\) => \{/);
  assert.match(source, /if \(renderStart\) \{\s*render\(\);\s*\}/s);
  assert.match(source, /const shouldRenderBusyState =\s*action !== "copy-invite" &&[\s\S]*action !== "jump-history" &&[\s\S]*action !== "return-live"/s);
  assert.match(source, /\}, \{ renderStart: shouldRenderBusyState \}\);/);
  assert.match(source, /const renderFeedbackReveal = \(message\) =>/);
  assert.match(source, /feedback-reveal\$\{message \? " is-visible" : ""\}/);
});

test("history navigation uses pointer-down press state with a single mouseup release bounce", () => {
  assert.match(source, /const startHistoryPress = \(actionEl\) => \{/);
  assert.match(source, /const startControlPress = \(controlEl\) => \{/);
  assert.match(source, /const clearHistoryPress = \(\) => \{/);
  assert.match(source, /const clearControlPress = \(\) => \{/);
  assert.match(source, /const playHistoryReleaseBounce = \(actionEl\) => \{/);
  assert.match(source, /const playControlReleaseBounce = \(controlEl\) => \{/);
  assert.match(source, /boardWrapEl\.classList\.add\("history-board-pressing"\);/);
  assert.match(source, /boardWrapEl\.classList\.add\("history-board-release"\);/);
  assert.match(source, /actionEl\.classList\.add\("history-item-release"\);/);
  assert.match(source, /appEl\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*const controlEl = target\.closest\("button, \.button-link"\);[\s\S]*startControlPress\(controlEl\);/s);
  assert.match(source, /window\.addEventListener\("pointerup", \(event\) => \{[\s\S]*action === "jump-history" \|\| action === "return-live"[\s\S]*return;[\s\S]*clearHistoryPress\(\);\s*\}\);/s);
  assert.match(source, /appEl\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*action !== "jump-history" && action !== "return-live"[\s\S]*startHistoryPress\(actionEl\);/s);
  assert.match(source, /const animateHistoryDeselection = async \(actionEl\) => \{/);
  assert.match(source, /currentSelected\.classList\.add\("is-deselecting"\);/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*clearControlPress\(\);[\s\S]*clearHistoryPress\(\);[\s\S]*playHistoryReleaseBounce\(actionEl\);[\s\S]*await animateHistoryDeselection\(actionEl\);/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*clearHistoryPress\(\);[\s\S]*playHistoryReleaseBounce\(actionEl\);/s);
});
