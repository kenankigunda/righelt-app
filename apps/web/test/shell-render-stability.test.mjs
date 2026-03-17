import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");

test("shell render patches same-route game updates without replacing the board panel", () => {
  assert.match(source, /let lastRenderedMarkup = "";/);
  assert.match(source, /let stickyLayoutFrame = 0;/);
  assert.match(source, /const SHELL_WIDE_SCREEN_MIN_WIDTH = 901;/);
  assert.match(source, /appEl\.setAttribute\("data-shell-layout-mode", "narrow"\);/);
  assert.match(source, /const renderGameShellFrame = \(game\) =>/);
  assert.match(source, /const renderDebugFlyout = \(\) =>/);
  assert.match(source, /data-debug-flyout/);
  assert.match(source, /Debug mode/);
  assert.match(source, /id="shell-game-alerts"/);
  assert.match(source, /data-game-shell-root data-game-id=/);
  assert.match(source, /data-shell-sticky-target="left" data-sticky-enabled="false"/);
  assert.match(source, /data-shell-sticky-target="board" data-sticky-enabled="false"/);
  assert.match(source, /data-game-panel="history"/);
  assert.match(source, /const updateMountedGameShell = \(\{ game, inviteFromRole = null, inviteToken = null, includeBoard = true \} = \{\}\) => \{/);
  assert.match(source, /const shouldEnableStickyShellColumn = \(\{ matchesWideScreen, columnHeight, viewportHeight \}\) =>/);
  assert.match(source, /const getWideDebugFlyoutWidth = \(viewportWidth = window\.innerWidth\) => \{/);
  assert.match(source, /const getAvailableShellContentWidth = \(viewportWidth = window\.innerWidth\) => \{/);
  assert.match(source, /const SHELL_VIEWPORT_GUTTER_PX = 16;/);
  assert.match(source, /const totalHorizontalGutter = SHELL_VIEWPORT_GUTTER_PX \* 2;/);
  assert.match(source, /return Math\.max\(0, viewportWidth - totalHorizontalGutter\);/);
  assert.match(source, /return Math\.max\(0, viewportWidth - getWideDebugFlyoutWidth\(viewportWidth\) - totalHorizontalGutter\);/);
  assert.match(source, /const getShellLayoutMode = \(viewportWidth = window\.innerWidth\) =>/);
  assert.match(source, /getAvailableShellContentWidth\(viewportWidth\) >= SHELL_WIDE_SCREEN_MIN_WIDTH \? "wide" : "narrow"/);
  assert.match(source, /const syncShellLayoutMode = \(\) => \{/);
  assert.match(source, /appEl\.setAttribute\("data-shell-layout-mode", layoutMode\);/);
  assert.match(source, /appEl\.setAttribute\("data-shell-content-width", String\(Math\.round\(getAvailableShellContentWidth\(\)\)\)\);/);
  assert.match(source, /const applyGameShellStickyLayout = \(\) => \{/);
  assert.match(source, /const scheduleGameShellStickyLayout = \(\) => \{/);
  assert.match(source, /window\.cancelAnimationFrame\(stickyLayoutFrame\);/);
  assert.match(source, /stickyLayoutFrame = window\.requestAnimationFrame\(\(\) => \{\s*stickyLayoutFrame = 0;\s*applyGameShellStickyLayout\(\);\s*\}\);/s);
  assert.match(source, /const layoutMode = syncShellLayoutMode\(\);/);
  assert.match(source, /const matchesWideScreen = layoutMode === "wide";/);
  assert.match(source, /const columnHeight = Math\.round\(targetEl\.getBoundingClientRect\(\)\.height\);/);
  assert.match(source, /targetEl\.setAttribute\("data-sticky-enabled", stickyEnabled \? "true" : "false"\);/);
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
  assert.match(source, /scheduleGameShellStickyLayout\(\);/);
  assert.match(source, /window\.addEventListener\("resize", \(\) => \{\s*scheduleGameShellStickyLayout\(\);\s*\}\);/s);
  assert.match(source, /window\.addEventListener\("load", \(\) => \{\s*scheduleGameShellStickyLayout\(\);\s*\}\);/s);
  assert.match(source, /const nextMarkup = `<div class="shell-page-shell"><div class="shell-main-content">\$\{renderHeader\(\)\}\$\{body\}<\/div>\$\{renderDebugFlyout\(\)\}<\/div>`;/);
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
  assert.match(source, /const getControlSeatForTurn = \(state, turnOwnerSeat\) => \{/);
  assert.match(source, /if \(continuation\.type === "push" && continuation\.phase === "retreat"\) \{\s*return getNextSeat\(turnOwnerSeat\);/s);
  assert.match(source, /const moveRows = game\.turns\.flatMap/);
  assert.match(source, /const pendingRows = \(Array\.isArray\(game\.pendingMoves\) \? game\.pendingMoves : \[\]\)\.map/);
  assert.match(source, /const reverseChronologicalMoveRows = \[\.\.\.moveRows\]\.reverse\(\);/);
  assert.match(source, /const reverseChronologicalPendingRows = \[\.\.\.pendingRows\]\.reverse\(\);/);
  assert.match(source, /class="history-item history-item-pending/);
  assert.match(source, /Pending<\/span>/);
  assert.match(source, /const liveContinuationText =[\s\S]*Live: Waiting for \$\{controlSeat \|\| "next player"\} to continue\.\.\./s);
  assert.match(source, /const liveWaitingText =[\s\S]*Live: Waiting on \$\{activeTurn\.playerSeat \|\| "next player"\} to move\.\.\./s);
  assert.match(source, /const liveStatusText = liveContinuationText \?\? liveWaitingText;/);
  assert.match(source, /class="history-item history-item-waiting history-empty-line/);
  assert.match(source, /return `\$\{reverseChronologicalPendingRows\.join\(""\)\}\$\{reverseChronologicalMoveRows\.join\(""\)\}`;/);
  assert.doesNotMatch(source, /if \(game\.inHistoryMode && activeTurn\.moveIndexes\.length > 0\) \{/);
  assert.match(source, /if \(!game\.inHistoryMode && !liveStatusItem && activeTurn\.moveIndexes\.length > 0\) \{\s*return `\$\{reverseChronologicalPendingRows\.join\(""\)\}\$\{reverseChronologicalMoveRows\.join\(""\)\}`;\s*\}/s);
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
  assert.match(source, /return `\$\{emptyTurnItem\}\$\{reverseChronologicalPendingRows\.join\(""\)\}\$\{reverseChronologicalMoveRows\.join\(""\)\}`;/);
  assert.match(source, /const hasHistoryMoves = Array\.isArray\(game\.moves\) && game\.moves\.length > 0;/);
  assert.match(source, /Incoming live moves will appear at top\./);
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
