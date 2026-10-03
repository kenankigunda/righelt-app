import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const syncStoreSource = readFileSync(join(testDir, "..", "shell", "sync-store.js"), "utf8");

test("shell render patches same-route game updates without replacing the board panel", () => {
  assert.match(source, /FLYOUT_KEYS,/);
  assert.match(source, /let lastRenderedMarkup = "";/);
  assert.match(source, /let lastRenderedTransitionPhaseKey = "idle";/);
  assert.match(source, /let stickyLayoutFrame = 0;/);
  assert.match(source, /const SHELL_WIDE_SCREEN_MIN_WIDTH = 901;/);
  assert.match(source, /const FLYOUT_MOTION_MS = 180;/);
  assert.match(source, /const GAME_ENTRY_ROUTE_TRANSITION_MS = 320;/);
  assert.match(source, /const GAME_ENTRY_ROUTE_TRANSITION_COVER_MS = 160;/);
  assert.match(source, /const GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS = 200;/);
  assert.match(source, /appEl\.setAttribute\("data-shell-layout-mode", "narrow"\);/);
  assert.match(source, /const renderGameShellFrame = \(game\) =>/);
  assert.match(source, /const renderScenarioFlyout = \(\) =>/);
  assert.match(source, /const renderDebugFlyout = \(\) =>/);
  assert.match(source, /<section class="panel debug-panel scenario-panel scenario-panel-load">/);
  assert.match(source, /<section class="panel debug-panel scenario-panel scenario-panel-create">/);
  assert.match(source, /const renderFlyout = \(\{ title, variant, closeAction, body \}\) =>/);
  assert.match(source, /class="shell-flyout-scroll shell-flyout-scroll-\$\{variant\}"/);
  assert.match(source, /closeAction:\s*"close-debug"/);
  assert.match(source, /closeAction:\s*"close-scenarios"/);
  assert.match(source, /class="secondary\$\{currentRoute\.scenarios \? " is-active" : ""\}"/);
  assert.match(source, /data-action="\$\{currentRoute\.scenarios \? "close-scenarios" : "open-scenarios"\}"/);
  assert.match(source, /aria-pressed="\$\{currentRoute\.scenarios \? "true" : "false"\}"/);
  assert.match(source, /class="secondary\$\{currentRoute\.debug \? " is-active" : ""\}"/);
  assert.match(source, /data-action="\$\{currentRoute\.debug \? "close-debug" : "open-debug"\}"/);
  assert.match(source, /aria-pressed="\$\{currentRoute\.debug \? "true" : "false"\}"/);
  assert.match(source, /title: "Debug mode"/);
  assert.match(source, /Scenarios/);
  assert.match(source, /<h1><a class="shell-header-title-link" href="\$\{buildHomeHash\(getCurrentFlyoutState\(\)\)\}" data-flyout-link="home">Righelt<\/a><\/h1>/);
  assert.match(source, /const renderHeaderWideActions = \(\) =>/);
  assert.match(source, /const renderHeaderNarrowMenu = \(\) =>/);
  assert.match(source, /const renderHeaderAlertZone = \(\) => \{/);
  assert.match(source, /const alertStackRotationByGameId = new Map\(\);/);
  assert.match(source, /const getGameAlertItems = \(game\) => \{/);
  assert.match(source, /const renderGameAlertStackCard = \(\{ gameId, item, stackIndex, totalAlerts \}\) => \{/);
  assert.match(source, /const isActive = stackIndex === 0;/);
  assert.match(source, /data-action="cycle-game-alert-stack"/);
  assert.doesNotMatch(source, /data-action="cycle-game-alert-stack" data-game-id="\$\{escapeHtml\(gameId\)\}" role="button" tabindex="0"/);
  assert.match(source, /: isActive\s*\? 'tabindex="-1"'/);
  assert.match(source, /: 'aria-hidden="true" tabindex="-1"'/);
  assert.match(source, /const viewedGameId = getCurrentViewedGameId\(\);/);
  assert.match(source, /data-shell-alert-zone="\$\{gameAlerts \? "active" : "idle"\}"/);
  assert.match(source, /data-action="toggle-header-menu"/);
  assert.match(source, /data-header-menu-open="\$\{headerMenuOpen \? "true" : "false"\}"/);
  assert.match(source, /const menuId = "shell-header-menu";/);
  assert.match(source, /aria-controls="\$\{menuId\}"/);
  assert.match(source, /data-header-menu-close="true"/);
  assert.match(source, /class="shell-header-menu-panel\$\{headerMenuOpen \? " is-open" : ""\}"/);
  assert.match(source, /aria-hidden="\$\{headerMenuOpen \? "false" : "true"\}"/);
  assert.match(source, /tabindex="\$\{headerMenuOpen \? "0" : "-1"\}"/);
  assert.doesNotMatch(source, /renderHeaderHomeAction/);
  assert.doesNotMatch(source, />Home<\/(?:a|span)>/);
  assert.match(source, /const renderDebugContent = \(\) => \{[\s\S]*?<h2>Live Sync<\/h2>[\s\S]*?<h2>Engine Status<\/h2>[\s\S]*?<h2>Actions Diagnostics<\/h2>/s);
  assert.match(source, /const getDocumentTitle = \(\) => \{\s*const gameId = getCurrentViewedGameId\(\);\s*if \(gameId\) \{\s*return `\$\{formatDisplayGameId\(gameId\)\} \| Righelt`;\s*\}\s*return "Righelt";\s*\};/s);
  assert.match(source, /const failedOperations = transport\.getFailedOperations\?\.\(game\.id\) \?\? \[\];/);
  assert.match(source, /const getFailedOperationsKey = \(gameId\) =>/);
  assert.match(source, /failedOperationsKey: getFailedOperationsKey\(game\.id\)/);
  assert.match(source, /const failedOperationsKey = getFailedOperationsKey\(game\.id\);/);
  assert.match(source, /testId:\s*"sync-failure-banner"/);
  assert.match(source, /data-action="dismiss-failed-operation"/);
  assert.match(source, /let isBuildingGameAlerts = false;/);
  assert.match(source, /const renderGameAlertsHtml = \(game, inviteFromRole = null\) => \{[\s\S]*isBuildingGameAlerts = true;[\s\S]*finally \{\s*isBuildingGameAlerts = false;\s*\}/s);
  assert.match(source, /if \(!isBuildingGameAlerts\) \{\s*render\(\{ animatePanels: false, includeBoard: false \}\);\s*\}/s);
  assert.doesNotMatch(source, /failedOperations\.length === 0 && game\.rollbackNotice/);
  assert.doesNotMatch(source, /rollbackNotice: game\.rollbackNotice/);
  assert.match(source, /const rotation = getAlertStackRotation\(game\.id,\s*items\.length\);/);
  assert.match(source, /renderGameAlertStackCard\(\{/);
  assert.match(source, /<div class="shell-header-status" data-shell-alert-zone="\$\{gameAlerts \? "active" : "idle"\}">/);
  assert.match(source, /id="shell-game-alerts"/);
  assert.match(source, /data-game-shell-root data-game-id=/);
  assert.match(source, /data-game-shell-track/);
  assert.match(source, /data-mobile-panel="players"/);
  assert.match(source, /data-mobile-panel="board"/);
  assert.match(source, /data-mobile-panel="history"/);
  assert.match(source, /data-action="switch-game-panel"/);
  assert.match(source, /data-shell-sticky-target="left" data-sticky-enabled="false"/);
  assert.match(source, /data-shell-sticky-target="board" data-sticky-enabled="false"/);
  assert.match(source, /data-game-panel="history"/);
  assert.match(source, /const updateMountedGameShell = \(\{ game, inviteFromRole = null, inviteToken = null, includeBoard = true \} = \{\}\) => \{/);
  assert.match(source, /if \(includeBoard \|\| mountedBoardGameId === game\.id\) \{\s*mountBoardForGame\(game\);\s*\}/s);
  assert.match(source, /const getMountedHeaderEl = \(\) =>/);
  assert.match(source, /const updateMountedHeader = \(\) => \{/);
  assert.match(source, /currentHeaderEl\.replaceWith\(nextHeaderEl\);/);
  assert.match(source, /const doesMountedFlyoutStateMatchRoute = \(\) => \{/);
  assert.match(source, /return FLYOUT_KEYS\.every\(\(flyoutKey\) => \{/);
  assert.match(source, /const shouldEnableStickyShellColumn = \(\{ matchesWideScreen, columnHeight, viewportHeight \}\) =>/);
  assert.match(source, /const getCurrentFlyoutState = \(\) => \(\{\s*\.\.\.Object\.fromEntries\(FLYOUT_KEYS\.map\(\(key\) => \[key, currentRoute\[key\] === true\]\)\),\s*\}\);/s);
  assert.match(source, /const getCurrentGameHashState = \(panel = getGamePanel\(\)\) => \(\{\s*\.\.\.getCurrentFlyoutState\(\),\s*panel,\s*\}\);/s);
  assert.match(source, /const getBaseRouteRenderKey = \(route = currentRoute\) => \{/);
  assert.match(source, /const getRouteRenderKey = \(route = currentRoute\) =>/);
  assert.match(source, /const getRouteTransitionPhaseKey = \(\) => routeTransition\?\.phase \|\| "idle";/);
  assert.match(source, /const getRouteTransitionRenderKey = \(\) =>/);
  assert.match(source, /const isGameEntryRouteTransitionActive = \(route = currentRoute\) =>/);
  assert.match(source, /const startGameEntryRouteTransition = \(gameId, fromRoute = currentRoute\?\.name \|\| "unknown"\) => \{/);
  assert.match(source, /const maybeRevealRouteTransition = \(\) => \{/);
  assert.match(source, /const syncRouteTransitionForCurrentRoute = \(\) => \{/);
  assert.match(source, /const isFlyoutOnlyRouteChange = \(previousRoute, nextRoute\) =>/);
  assert.match(source, /let flyoutRenderOrder = FLYOUT_KEYS\.filter\(\(key\) => currentRoute\[key\] === true\);/);
  assert.match(source, /const syncFlyoutRenderOrder = \(route = currentRoute\) => \{/);
  assert.match(source, /const setFlyoutOpenState = \(key, isOpen\) => \{/);
  assert.match(source, /const getOpenFlyoutCount = \(route = currentRoute\) => FLYOUT_KEYS\.reduce\(\(count, key\) => count \+ Number\(route\?\.\[key\] === true\), 0\);/);
  assert.match(source, /const getWideFlyoutWidth = \(viewportWidth = window\.innerWidth\) => \{/);
  assert.match(source, /const getAvailableShellContentWidth = \(viewportWidth = window\.innerWidth, route = currentRoute\) => \{/);
  assert.match(source, /const SHELL_VIEWPORT_GUTTER_PX = 16;/);
  assert.match(source, /const totalHorizontalGutter = SHELL_VIEWPORT_GUTTER_PX \* 2;/);
  assert.match(source, /return Math\.max\(0, viewportWidth - totalHorizontalGutter\);/);
  assert.match(source, /return Math\.max\(0, viewportWidth - \(getWideFlyoutWidth\(viewportWidth\) \* openFlyoutCount\) - totalHorizontalGutter\);/);
  assert.match(source, /const getShellLayoutModeForRoute = \(route = currentRoute, viewportWidth = window\.innerWidth\) =>/);
  assert.match(source, /getAvailableShellContentWidth\(viewportWidth, route\) >= SHELL_WIDE_SCREEN_MIN_WIDTH \? "wide" : "narrow"/);
  assert.match(source, /const getShellLayoutMode = \(viewportWidth = window\.innerWidth\) => getShellLayoutModeForRoute\(currentRoute, viewportWidth\);/);
  assert.match(source, /const scrollHomeSectionToTop = \(sectionKey\) => \{/);
  assert.match(source, /window\.requestAnimationFrame\(\(\) => \{\s*scrollHomeSectionToTop\(sectionKey\);\s*\}\);/s);
  assert.match(source, /const syncShellLayoutMode = \(\) => \{/);
  assert.match(source, /appEl\.setAttribute\("data-shell-layout-mode", layoutMode\);/);
  assert.match(source, /appEl\.setAttribute\("data-shell-route", currentRoute\?\.name \|\| "unknown"\);/);
  assert.match(source, /appEl\.setAttribute\("data-shell-transition", routeTransition\?\.type \|\| "none"\);/);
  assert.match(source, /appEl\.setAttribute\("data-shell-transition-active", isGameEntryRouteTransitionActive\(\) \? "true" : "false"\);/);
  assert.match(source, /appEl\.setAttribute\("data-shell-transition-phase", getRouteTransitionPhaseKey\(\)\);/);
  assert.match(source, /appEl\.style\.setProperty\("--shell-game-panel-index", String\(getGamePanelIndex\(activeGamePanel\)\)\);/);
  assert.match(source, /FLYOUT_KEYS\.forEach\(\(key\) => \{\s*appEl\.setAttribute\(`data-\$\{key\}-open`, currentRoute\[key\] \? "true" : "false"\);\s*\}\);/s);
  assert.match(source, /appEl\.setAttribute\("data-flyout-count", String\(getOpenFlyoutCount\(\)\)\);/);
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
  assert.match(source, /const getAnimatedFlyoutEls = \(layoutMode = getShellLayoutMode\(\)\) => \{/);
  assert.match(source, /const mainContentEl = layoutMode === "wide" \? appEl\.querySelector\("\.shell-main-content"\) : null;/);
  assert.match(source, /const getAnimatedFlyoutKey = \(element\) => \{/);
  assert.match(source, /const getCssPixelValue = \(value, fallback = 0\) => \{/);
  assert.match(source, /const getFlyoutContentGapPx = \(\) =>/);
  assert.match(source, /const getShellMainMaxWidthPx = \(\) =>/);
  assert.match(source, /const getWideShellPaddingRightPx = \(openFlyoutCount, viewportWidth = window\.innerWidth\) => \{/);
  assert.match(source, /const getWideMainContentWidthPx = \(openFlyoutCount, viewportWidth = window\.innerWidth\) => \{/);
  assert.match(source, /const captureFlyoutRects = \(layoutMode = getShellLayoutMode\(\)\) =>/);
  assert.match(source, /const animateFlyoutShift = \(element, \{ deltaX = 0, deltaY = 0, fromOpacity = 1, fromWidth = null, toWidth = null \} = \{\}\) => \{/);
  assert.match(source, /const animateFlyoutPositionChanges = \(previousRects\) => \{/);
  assert.doesNotMatch(source, /previousRects\.size === 0/);
  assert.match(source, /const clearCoordinatedFlyoutMotionStyles = \(\) => \{/);
  assert.match(source, /const hasWidthChange = Number\.isFinite\(fromWidth\) && Number\.isFinite\(toWidth\) && Math\.abs\(toWidth - fromWidth\) >= 1;/);
  assert.match(source, /element\.style\.width = `\$\{fromWidth\}px`;/);
  assert.match(source, /element\.style\.maxWidth = `\$\{fromWidth\}px`;/);
  assert.match(source, /element\.style\.transition = `transform \$\{FLYOUT_MOTION_MS\}ms ease, opacity \$\{FLYOUT_MOTION_MS\}ms ease, width \$\{FLYOUT_MOTION_MS\}ms ease, max-width \$\{FLYOUT_MOTION_MS\}ms ease`;/);
  assert.match(source, /element\.style\.width = `\$\{toWidth\}px`;/);
  assert.match(source, /element\.style\.maxWidth = `\$\{toWidth\}px`;/);
  assert.match(source, /const capturePanelHeights = \(\) =>/);
  assert.match(source, /const shouldPatchFlyoutsOnly = shouldPatchMountedFlyouts\(routeKey, baseRouteKey\);/);
  assert.match(source, /const previousPanelHeights = animatePanels && !shouldPatchFlyoutsOnly \? capturePanelHeights\(\) : \[\];/);
  assert.match(source, /const previousFlyoutRects = animatePanels \? captureFlyoutRects\(\) : new Map\(\);/);
  assert.match(source, /const animatePanelHeightChange = \(panelEl, fromHeight\) => \{/);
  assert.match(source, /const animatePanelHeightChanges = \(previousPanelHeights\) => \{/);
  assert.match(source, /const getMountedShellPageEl = \(\) =>/);
  assert.match(source, /const getFlyoutAwareHref = \(element\) => \{/);
  assert.match(source, /const syncFlyoutAwareLinks = \(\) => \{/);
  assert.match(source, /const syncCopyInviteLinks = \(\) => \{/);
  assert.match(source, /const updateMountedFlyouts = \(\) => \{/);
  assert.match(source, /const shouldPatchMountedFlyouts = \(routeKey = getRouteRenderKey\(\), baseRouteKey = getBaseRouteRenderKey\(\)\) =>/);
  assert.match(source, /getRouteTransitionPhaseKey\(\) === lastRenderedTransitionPhaseKey/);
  assert.match(source, /const syncRenderedMarkupSnapshot = \(\) => \{/);
  assert.match(source, /lastRenderedMarkup = `<div class="shell-page-shell">\$\{lastRenderedMainMarkup\}\$\{lastRenderedFlyoutMarkup\}<\/div>`;/);
  assert.match(source, /lastRenderedTransitionPhaseKey = getRouteTransitionPhaseKey\(\);/);
  assert.match(source, /const ensureRouteTransitionLayer = \(\) => \{/);
  assert.match(source, /const routeTransitionLayerEl = ensureRouteTransitionLayer\(\);/);
  assert.match(source, /routeTransitionLayerEl\.setAttribute\("data-active", routeTransition \? "true" : "false"\);/);
  assert.match(source, /routeTransitionLayerEl\.setAttribute\("data-transition", routeTransition\?\.type \|\| "none"\);/);
  assert.match(source, /routeTransitionLayerEl\.setAttribute\("data-phase", routeTransition\?\.phase \|\| "idle"\);/);
  assert.match(source, /routeTransitionLayerEl\.style\.setProperty\("--shell-game-entry-transition-ms", `\$\{GAME_ENTRY_ROUTE_TRANSITION_MS\}ms`\);/);
  assert.match(source, /routeTransitionLayerEl\.style\.setProperty\("--shell-game-entry-cover-ms", `\$\{GAME_ENTRY_ROUTE_TRANSITION_COVER_MS\}ms`\);/);
  assert.match(source, /routeTransitionLayerEl\.style\.setProperty\("--shell-game-entry-reveal-ms", `\$\{GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS\}ms`\);/);
  assert.match(source, /const FLYOUT_RENDERERS = \{/);
  assert.match(source, /const renderFlyoutBodyByKey = \(flyoutKey\) => \{/);
  assert.match(source, /scenarios:\s*\(\) => renderScenarioFlyout\(\)/);
  assert.match(source, /debug:\s*\(\) => renderDebugFlyout\(\)/);
  assert.match(source, /fromWidth: previousRect\.width,/);
  assert.match(source, /toWidth: nextRect\.width,/);
  assert.match(source, /getAnimatedFlyoutEls\(layoutMode\)\.forEach\(\(element\) => \{/);
  assert.match(source, /deltaX: layoutMode === "wide" \? nextRect\.width : 0,/);
  assert.match(source, /deltaY: layoutMode === "wide" \? 0 : nextRect\.height,/);
  assert.match(source, /querySelectorAll\("\.panel"\)/);
  assert.match(source, /class="panel" data-shell-panel="board"/);
  assert.match(source, /scheduleGameShellStickyLayout\(\);/);
  assert.match(source, /const scheduleResponsiveHomeSectionPageSizes = \(\) => \{/);
  assert.match(source, /window\.cancelAnimationFrame\(homeSectionResizeFrame\);/);
  assert.match(source, /homeSectionResizeFrame = window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(source, /const didUpdate = await syncResponsiveHomeSectionPageSizes\(\);/);
  assert.match(source, /render\(\{ animatePanels: false, includeBoard: false \}\);/);
  assert.match(source, /window\.addEventListener\("resize", \(\) => \{\s*scheduleGameShellStickyLayout\(\);\s*scheduleResponsiveHomeSectionPageSizes\(\);\s*\}\);/s);
  assert.match(source, /window\.addEventListener\("load", \(\) => \{\s*scheduleGameShellStickyLayout\(\);\s*scheduleResponsiveHomeSectionPageSizes\(\);\s*\}\);/s);
  assert.match(source, /syncFlyoutRenderOrder\(currentRoute\);/);
  assert.match(source, /if \(isFlyoutOnlyRouteChange\(previousRoute, nextRoute\)\) \{[\s\S]*render\(\);\s*return;\s*\}/s);
  assert.match(source, /if \(isFlyoutOnlyRouteChange\(previousRoute, currentRoute\)\) \{[\s\S]*render\(\);\s*return;\s*\}/s);
  assert.match(source, /setFlyoutOpenState\("debug", true\);/);
  assert.match(source, /setFlyoutOpenState\("scenarios", true\);/);
  assert.match(source, /const animateFlyoutClose = async \(flyoutKey, closeFlyout\) => \{/);
  assert.match(source, /const mainContentEl = appEl\?\.querySelector\?\.\("\.shell-main-content"\);/);
  assert.match(source, /const layoutMode = getShellLayoutMode\(\);/);
  assert.match(source, /if \(layoutMode === "wide"\) \{/);
  assert.match(source, /const nextFlyoutCount = Math\.max\(0, getOpenFlyoutCount\(\) - 1\);/);
  assert.match(source, /const currentAppPaddingRight = window\.getComputedStyle\(appEl\)\.paddingRight;/);
  assert.match(source, /const nextAppPaddingRight = getWideShellPaddingRightPx\(nextFlyoutCount\);/);
  assert.match(source, /appEl\.style\.transition = `padding-right \$\{FLYOUT_MOTION_MS\}ms ease`;/);
  assert.match(source, /const nextMainWidth = getWideMainContentWidthPx\(nextFlyoutCount\);/);
  assert.match(source, /mainContentEl\.style\.transition = `width \$\{FLYOUT_MOTION_MS\}ms ease, max-width \$\{FLYOUT_MOTION_MS\}ms ease`;/);
  assert.match(source, /flyoutEl\.classList\.add\("is-closing"\);/);
  assert.match(source, /await delay\(FLYOUT_MOTION_MS\);/);
  assert.match(source, /clearCoordinatedFlyoutMotionStyles\(\);/);
  assert.match(source, /const nextMarkup = `<div class="shell-page-shell"><div class="shell-main-content">\$\{renderHeader\(\)\}\$\{body\}<\/div>\$\{renderFlyouts\(\)\}<\/div>`;/);
  assert.match(source, /document\.title = getDocumentTitle\(\);/);
  assert.match(source, /if \(shouldPatchFlyoutsOnly\) \{\s*updateMountedHeader\(\);\s*updateMountedFlyouts\(\);\s*syncFlyoutAwareLinks\(\);\s*syncCopyInviteLinks\(\);\s*updateHeaderFields\(\);\s*syncMountedGameShellPanelUi\(\);\s*reconcileMiniBoardPreviews\(\);[\s\S]*syncRenderedMarkupSnapshot\(\);\s*return;\s*\}/s);
  assert.match(source, /shouldUseIncrementalGameShell\(\) &&[\s\S]*getRouteTransitionPhaseKey\(\) === lastRenderedTransitionPhaseKey[\s\S]*updateMountedHeader\(\);\s*updateHeaderFields\(\);\s*syncScenarioAuthoringControls\(\);\s*updateMountedGameShell\(/s);
  assert.match(source, /if \(nextMarkup !== lastRenderedMarkup\) \{\s*appEl\.innerHTML = nextMarkup;\s*lastRenderedMarkup = nextMarkup;[\s\S]*lastRenderedRouteKey = routeKey;[\s\S]*if \(animatePanels\) \{\s*animatePanelHeightChanges\(previousPanelHeights\);\s*animateFlyoutPositionChanges\(previousFlyoutRects\);\s*\}\s*\}/s);
  assert.equal((source.match(/appEl\.innerHTML\s*=/g) || []).length, 1);
  assert.match(source, /data-flyout-link="home"/);
  assert.match(source, /flyoutLink \? `data-flyout-link="\$\{escapeHtml\(flyoutLink\)\}"` : ""/);
  assert.doesNotMatch(source, /data-flyout-link="tutorial"/);
  assert.match(source, /data-action="copy-invite" data-game-id=/);
  assert.doesNotMatch(source, /replaceWith\(previousBoardPanel\)/);
});

test("live sync applies authoritative pushed game payloads before render", () => {
  assert.match(syncStoreSource, /payload\?\.type === "state_sync"/);
  assert.match(syncStoreSource, /payload\?\.type === "event_appended"/);
  assert.match(syncStoreSource, /transport\.applyLiveGameUpdate\(\{\s*game: payload\.game,\s*eventSeq: payload\.eventSeq,\s*clientCommandId: payload\.clientCommandId \?\? null,\s*commandOutcome: payload\.commandOutcome \?\? null,\s*\}\);/s);
  assert.match(source, /if \(document\.getElementById\("shell-debug-last-event"\)\) \{\s*updateHeaderFields\(\);\s*\} else \{\s*render\(\{ animatePanels: false, includeBoard: false \}\);\s*\}/s);
});

test("live sync status renders are deduplicated by stable status key", () => {
  assert.match(source, /let lastWsStatusKey = toStableKey\(wsStatus\);/);
  assert.match(source, /const statusKey = toStableKey\(status\);/);
  assert.match(source, /if \(statusKey === lastWsStatusKey\) \{\s*return;\s*\}/s);
  assert.match(source, /lastWsStatusKey = statusKey;\s*wsStatus = status;\s*if \(status\.state === "closed" && status\.reconnectAttempts >= 3\) \{\s*void syncRouteDataPassive\(\);\s*\}[\s\S]*updateHeaderFields\(\);/s);
  assert.match(source, /if \(document\.getElementById\("shell-debug-live-sync"\)\) \{\s*updateHeaderFields\(\);\s*\} else \{\s*render\(\{ animatePanels: false, includeBoard: false \}\);\s*\}/s);
});

test("sync store manages subscriptions through the active route game id", () => {
  assert.match(source, /syncStore\.setActiveGameId\(routeGameId\);/);
  assert.match(syncStoreSource, /let activeGameId = null;/);
  assert.match(syncStoreSource, /const getLocalFailureMessage = \(game\) =>/);
  assert.match(syncStoreSource, /const isFailedLocalStub = \(game\) =>/);
  assert.match(syncStoreSource, /const getRollbackFailureHandle = \(gameId\) =>/);
  assert.match(syncStoreSource, /const activeGame =/);
  assert.match(syncStoreSource, /const desiredGameIds =[\s\S]*isFailedLocalStub\(activeGame\)/);
  assert.match(syncStoreSource, /for \(const gameId of liveSync\.getDesiredGameIds\(\)\) \{/);
  assert.match(syncStoreSource, /liveSync\.disconnectGame\(gameId\);/);
  assert.match(syncStoreSource, /liveSync\.connectGame\(gameId\);/);
});

test("history renderer emits move-only rows without visible turn wrappers", () => {
  assert.doesNotMatch(source, /class="history-turn"/);
  assert.doesNotMatch(source, /class="history-turn-header"/);
  assert.doesNotMatch(source, /class="history-turn-list"/);
  assert.match(source, /const getControlSeatForTurn = \(state, turnOwnerSeat\) => \{/);
  assert.match(source, /if \(continuation\.type === "push" && continuation\.phase === "retreat"\) \{\s*return getNextSeat\(turnOwnerSeat\);/s);
  assert.match(source, /const moveRowsChronological = \(Array\.isArray\(game\.moves\) \? game\.moves : \[\]\)\.map/);
  assert.match(source, /const pendingRows = \(Array\.isArray\(game\.pendingMoves\) \? game\.pendingMoves : \[\]\)\.map/);
  assert.match(source, /const reverseChronologicalMoveRows = \[\];/);
  assert.match(source, /data-action="toggle-undone-group"/);
  assert.match(source, /history-item history-item-undone-group is-undone/);
  assert.match(source, /const reverseChronologicalPendingRows = \[\.\.\.pendingRows\]\.reverse\(\);/);
  assert.match(source, /const branchButton = game\.inHistoryMode && game\.historyIndex === move\.index && move\.undone !== true/);
  assert.match(source, /const revertButton = game\.inHistoryMode && game\.historyIndex === move\.index && move\.undone !== true/);
  assert.match(source, /data-action="revert-to-move"/);
  assert.match(source, /data-action="undo-last-move"/);
  assert.match(source, /class="history-item history-item-pending/);
  assert.match(source, /data-testid="history-pending-move-item"/);
  assert.match(source, /aria-busy="true"/);
  assert.match(source, /Pending<\/span>/);
  assert.match(source, /const liveContinuationText =[\s\S]*Live: Waiting for \$\{controlSeat \|\| "next player"\} to continue\.\.\./s);
  assert.match(source, /const liveWaitingText =[\s\S]*Live: Waiting on \$\{activeTurn\.playerSeat \|\| "next player"\} to move\.\.\./s);
  assert.match(source, /const liveStatusText = liveContinuationText \?\? liveWaitingText;/);
  assert.match(source, /class="history-item history-item-waiting history-empty-line/);
  assert.match(source, /return `\$\{reverseChronologicalPendingRows\.join\(""\)\}\$\{reverseChronologicalMoveRows\.join\(""\)\}`;/);
  assert.doesNotMatch(source, /if \(game\.inHistoryMode && activeTurn\.moveIndexes\.length > 0\) \{/);
  assert.match(source, /if \(!game\.inHistoryMode && !liveStatusItem && activeTurn\.moveIndexes\.length > 0\) \{\s*return `\$\{reverseChronologicalPendingRows\.join\(""\)\}\$\{reverseChronologicalMoveRows\.join\(""\)\}`;\s*\}/s);
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
  assert.match(source, /return `\$\{emptyTurnItem\}\$\{undoLastMoveItem\}\$\{reverseChronologicalPendingRows\.join\(""\)\}\$\{reverseChronologicalMoveRows\.join\(""\)\}`;/);
  assert.match(source, /const hasHistoryMoves = Array\.isArray\(game\.moves\) && game\.moves\.length > 0;/);
  assert.match(source, /data-action="launch-history-branch"/);
  assert.match(source, /Create new game at this move/);
  assert.match(source, /Incoming live moves will appear at top\./);
  assert.match(source, /: hasHistoryMoves\s*\? '<p class="small">You are on the live view\.<\/p><p class="small">Click moves below to see historical state\.<\/p>'\s*: '<p class="small">You are on the live view\.<\/p>'/);
});

test("transport subscriptions drive immediate game-shell updates", () => {
  assert.match(source, /transport\.subscribe\(\(change\) => \{[\s\S]*render\(\{\s*animatePanels: false,\s*includeBoard: change\?\.type !== "optimistic_enqueue",\s*\}\);\s*\}\);/s);
  assert.match(source, /const canHydrateRouteFromLocalState = \(route = currentRoute\) => \{/);
  assert.match(source, /return Boolean\(transport\.getGameViewModel\(route\.gameId\)\);/);
  assert.match(source, /const shouldUseIncrementalGameShell = \(gameId = currentRoute\.gameId\) => \{/);
  assert.match(source, /return !getActiveApprovalRequest\(game\) && !getActiveRevertRequest\(game\) && !getActivePendingRevertRequest\(game\) && doesMountedFlyoutStateMatchRoute\(\);/);
  assert.match(source, /updateMountedGameShell\(\{\s*game: transport\.getGameViewModel\(currentRoute\.gameId\),[\s\S]*includeBoard,\s*\}\);/s);
  assert.match(source, /if \(currentRoute\.name === "game"\) \{\s*if \(shouldUseIncrementalGameShell\(\)\) \{\s*updateMountedGameShell\(\{/s);
  assert.match(source, /const game = transport\.getGameViewModel\(gameId\);\s*if \(!routeHydrated && !game\) \{/s);
  assert.match(source, /if \(canHydrateRouteFromLocalState\(currentRoute\)\) \{\s*routeHydrated = true;\s*syncLiveChannels\(\);\s*render\(\);\s*maybeRevealRouteTransition\(\);\s*return;\s*\}/s);
});

test("scenario selector labels use titles without visible ids", () => {
  assert.match(source, /`\$\{scenario\.title\}\$\{scenario\.incorrect \? " \[incorrect\]" : ""\}`/);
  assert.doesNotMatch(source, /`\$\{scenario\.id\} - \$\{scenario\.title\}/);
  assert.match(source, /scenarioId:\s*crypto\.randomUUID\(\),/);
  assert.doesNotMatch(source, /window\.prompt\("Scenario title:", "Saved scenario"\)/);
  assert.match(source, /data-scenario-editable="title"/);
  assert.match(source, /data-scenario-editable="description"/);
  assert.match(source, /contenteditable="plaintext-only" role="textbox" aria-label="Scenario title"/);
  assert.match(source, /contenteditable="plaintext-only" role="textbox" aria-label="Scenario description"/);
  assert.match(source, /data-action="update-scenario"/);
  assert.match(source, /data-scenario-save-field="title"/);
  assert.match(source, /data-scenario-save-field="description"/);
  assert.match(source, /Load a scenario/);
  assert.match(source, /Create a scenario/);
  assert.match(source, /Update to match current board/);
  assert.match(source, /Save current board as new scenario/);
  assert.match(source, /canAuthorScenariosLocally\(\)/);
  assert.match(source, /const canSaveScenario = canAuthorScenarios && Boolean\(saveDraft\.title && saveDraft\.description\);/);
  assert.match(source, /const title = getScenarioEditableFieldText\("title"\);/);
  assert.match(source, /const description = getScenarioEditableFieldText\("description"\);/);
  assert.match(source, /appEl\.addEventListener\("focusout", \(event\) => \{/);
  assert.match(source, /target\.hasAttribute\("data-scenario-editable"\)/);
  assert.match(source, /window\.setTimeout\(async \(\) => \{/);
  assert.match(source, /includeCurrentBoard:\s*false,/);
  assert.match(source, /Scenario \$\{scenario\.id\} details saved\./);
  assert.doesNotMatch(source, /downloadScenarioCatalog/);
});

test("debug flyout persists locally while scenario-created games close the scenarios flyout", () => {
  assert.match(source, /import \{ loadDebugFlyoutOpen, saveDebugFlyoutOpen, saveTutorialCompleted \} from "\.\/persistence\.js";/);
  assert.match(source, /const getPersistedDebugFlyoutOpen = \(\) => loadDebugFlyoutOpen\(storage\);/);
  assert.match(source, /const routeWithPersistedPreferences = \{\s*\.\.\.route,\s*debug: getPersistedDebugFlyoutOpen\(\),\s*panel: route\.name === "game" \? normalizeGamePanel\(route\.panel\) : route\.panel,\s*\};/s);
  assert.match(source, /return \{\s*\.\.\.routeWithPersistedPreferences,\s*\.\.\.resolveFlyoutState\(routeWithPersistedPreferences,/s);
  assert.doesNotMatch(source, /toggleDebugHash/);
  assert.match(source, /if \(action === "open-debug"\) \{[\s\S]*saveDebugFlyoutOpen\(storage, true\);[\s\S]*currentRoute = normalizeRouteFlyoutState\(\{ \.\.\.currentRoute, debug: true \}, \{ preferredFlyoutKey: "debug" \}\);[\s\S]*(startRouteSync\(\{ renderStart: false \}\)|render\(\{ animatePanels: false, includeBoard: false \}\));/s);
  assert.match(source, /if \(action === "close-debug"\) \{[\s\S]*saveDebugFlyoutOpen\(storage, false\);[\s\S]*currentRoute = normalizeRouteFlyoutState\(\{ \.\.\.currentRoute, debug: false \}\);[\s\S]*(startRouteSync\(\{ renderStart: false \}\)|render\(\{ animatePanels: false, includeBoard: false \}\));/s);
  assert.match(source, /if \(action === "close-scenarios"\) \{[\s\S]*navigateTo\(toggleScenariosHash\(window\.location\.hash\)\);[\s\S]*\}/s);
  assert.match(source, /const nextHash = buildGameHash\(result\.game\.id, null, \{\s*\.\.\.getCurrentFlyoutState\(\),\s*scenarios: false,\s*\}\);/s);
});

test("history branch launch keeps the source tab stable while opening a new tab", () => {
  assert.match(source, /if \(action === "launch-history-branch"\) \{[\s\S]*buildHistoryBranchSeedFromGame\(activeGame, moveIndex\);[\s\S]*transport\.launchHistoryBranch\(/s);
  assert.match(source, /const handle = transport\.launchHistoryBranch\(/);
  assert.match(source, /window\.open\(`\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{nextHash\}`,\s*"_blank",\s*"noopener"\);/);
  assert.match(source, /const initialSelectionHydration = resolveInitialSelectionHydration\(/);
  assert.match(source, /const hydratedSelectionAction = scenarioSelectionHydration\.selectionAction \?\? initialSelectionHydration\.selectionAction;/);
  assert.match(source, /selectionAction: hydratedSelectionAction,/);
});

test("history navigation stays local-first without the removed global busy wrapper", () => {
  assert.doesNotMatch(source, /const shouldRenderBusyStateStart =/);
  assert.doesNotMatch(source, /const shouldRenderBusyStateEnd =/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*transport\.selectHistoryMove\(\{ gameId, moveIndex \}\);[\s\S]*return;/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*transport\.returnToLive\(\{ gameId \}\);[\s\S]*return;/s);
  assert.doesNotMatch(source, /if \(action === "jump-history"\) \{[\s\S]*await transport\.selectHistoryMove/s);
  assert.doesNotMatch(source, /if \(action === "return-live"\) \{[\s\S]*await transport\.returnToLive/s);
});

test("shell renders durable browser E2E selectors for core workflow surfaces", () => {
  assert.match(source, /data-testid="home-create-game"/);
  assert.match(source, /data-testid="game-role"/);
  assert.match(source, /data-testid="copy-invite"/);
  assert.match(source, /data-testid="participants-list"/);
  assert.match(source, /data-testid="game-board"/);
  assert.match(source, /data-testid="history-list"/);
  assert.match(source, /data-testid="history-move-item"/);
  assert.match(source, /data-testid="history-pending-move-item"/);
  assert.match(source, /data-testid="history-destruction-item"/);
  assert.match(source, /data-testid="history-return-live"/);
  assert.match(source, /data-testid="approval-gate"/);
  assert.match(source, /data-testid="accept-request"/);
  assert.match(source, /data-testid="ignore-request"/);
  assert.match(source, /data-testid="invite-gate"/);
  assert.match(source, /data-testid="invite-join-player"/);
  assert.match(source, /data-testid="invite-join-viewer"/);
});

test("shell renders and reconciles mini board previews for home and debug surfaces", () => {
  assert.match(source, /const miniBoardPreviewRegistry = new Map\(\);/);
  assert.match(source, /const renderedMiniBoardPreviewPayloads = new Map\(\);/);
  assert.match(source, /const renderMiniBoardPreviewRoot = \(\{[\s\S]*previewId,[\s\S]*snapshot,[\s\S]*selection = null,[\s\S]*previewKey,[\s\S]*sizeVariant = "compact"[\s\S]*\}\) => \{/);
  assert.match(source, /data-mini-board-preview data-preview-id=/);
  assert.match(source, /const reconcileMiniBoardPreviews = \(\) => \{/);
  assert.match(source, /syncMiniBoardPreviews\(\{/);
  assert.match(source, /const getStaticCardPreviewSnapshot = \(card\) => card\?\.previewSnapshot \?\? null;/);
  assert.match(source, /const getStaticCardPreviewPayload = \(card\) => \(\{/);
  assert.match(source, /const scenarioPreviewPayload = selectedScenario \? buildScenarioStaticPreviewModel\(selectedScenario\) : null;/);
  assert.match(source, /previewId: `\$\{variant\}:\$\{card\.id\}`/);
  assert.match(source, /class="mini-board-card"/);
  assert.match(source, /class="mini-board-card-link-surface"[\s\S]*href=/);
  assert.match(source, /data-game-id="\$\{escapeHtml\(game\.id\)\}"/);
  assert.match(source, /Last move on \$\{escapeHtml\(formatClientDateTime\(game\.lastMoveAt \|\| game\.createdAt\)\)\}/);
  assert.match(
    source,
    /const recoveryChip =[\s\S]*game\.syncStatus === "desynced" \|\| game\.syncStatus === "confirming"[\s\S]*'<span class="status-chip">Recovering<\/span>' : "";/,
  );
  assert.match(source, /const isDualSeatIdentity = \(game\) =>/);
  assert.match(source, /return '<strong class="player-tone-both">both players<\/strong>';/);
  assert.match(source, /const renderConnectionStatusIcon = \(status, label\) =>/);
  assert.match(source, /const renderPlayerSlotStatus = \(seat, participant, \{ verbose = false \} = \{\}\) =>/);
  assert.match(source, /return `<span class="mini-board-card-connection-item">\$\{renderSeatLabel\(seat\)\}\$\{renderConnectionStatusIcon\(\s*"open",\s*statusLabel,\s*\)\}<\/span>`;/s);
  assert.match(source, /const shouldUseVerboseHomeConnectionCopy = \(game\) =>/);
  assert.match(source, /const renderHomeRoleLine = \(game\) =>/);
  assert.doesNotMatch(source, /renderConnectionStatusIcon\(Boolean\(game\?\.myConnectionConnected\),/);
  assert.match(source, /if \(game\?\.myRole === "Guest"\) \{\s*return game\?\.canJoinAsPlayer \? "Open to join as player" : "Open to view";\s*\}/);
  assert.match(source, /const renderHomeSeatConnectionLine = \(game\) =>/);
  assert.match(source, /return `<p class="small mini-board-card-connection-line">\$\{connectionSummary\}<\/p>`;/);
  assert.match(source, /return '<p class="small mini-board-card-connection-line is-placeholder" aria-hidden="true"><span>&nbsp;<\/span><\/p>';/);
  assert.doesNotMatch(source, /You are connected here|You are not connected here/);
  assert.match(source, /const seatConnectionLine = renderHomeSeatConnectionLine\(game\);/);
  assert.match(source, /const renderHomeConnectionSummary = \(game\) =>/);
  assert.match(source, /const filteredSlots = isDualSeatIdentity\(game\) && isPlayerRole\(game\?\.myRole\)/);
  assert.match(source, /renderPlayerSlotStatus\(entry\.seat, entry\.participant, \{ verbose: shouldUseVerboseHomeConnectionCopy\(game\) \}\)/);
  assert.match(source, /<div class="mini-board-card-copy">/);
  assert.match(source, /<div class="mini-board-card-meta mini-board-card-meta-primary">/);
  assert.match(source, /<span>\$\{renderHomeRoleLine\(game\)\}<\/span>/);
  assert.match(source, /\$\{seatConnectionLine\}/);
  assert.match(source, /const moveLabel = `Move \$\{game\.moveCount \+ 1\}`;/);
  assert.match(source, /reconcileMiniBoardPreviews\(\);\s*syncMountedGameShellPanelUi\(shellRoot\);\s*scheduleGameShellStickyLayout\(\);/);
});

test("app uses route skeleton sync and localized loading instead of a global busy wrapper", () => {
  assert.doesNotMatch(source, /const withBusy = async/);
  assert.doesNotMatch(source, /let busy = false;/);
  assert.match(source, /const pendingHomeSectionKeys = new Set\(\);/);
  assert.match(source, /const SCENARIO_LOAD_PENDING_KEY = "scenario:load";/);
  assert.match(source, /const startRouteSync = \(\{ renderStart = true \} = \{\}\) => \{/);
  assert.match(source, /routeHydrated = false;\s*syncLiveChannels\(\);/s);
  assert.match(source, /const initialRender = async \(\) => \{\s*routeHydrated = false;\s*render\(\{ animatePanels: false, includeBoard: false \}\);[\s\S]*?await account\.start\(\);/s);
  assert.match(source, /startRouteSync\(\{ renderStart: false \}\);/);
  assert.match(source, /renderGameViewSkeleton\(\)/);
  assert.match(source, /renderInvitePageSkeleton\(\)/);
  assert.match(
    source,
    /else if \(currentRoute\.name === "invite"\) \{\s*if \(!routeHydrated\) \{\s*body = renderInvitePageSkeleton\(\);/s,
  );
  assert.match(source, /renderHomeSectionSkeleton/);
  assert.match(
    source,
    /if \(target\.closest\("\[data-header-menu-close='true'\]"\)\) \{\s*closeHeaderMenu\(\);\s*if \(isNarrowHeaderMode\(\)\) \{\s*syncNarrowHeaderMenuDom\(\);\s*\}\s*\}/s,
  );
  assert.match(
    source,
    /if \(action === "toggle-header-menu"\) \{\s*headerMenuOpen = !headerMenuOpen;\s*if \(isNarrowHeaderMode\(\)\) \{\s*syncNarrowHeaderMenuDom\(\);\s*\} else \{\s*render\(\{ animatePanels: false, includeBoard: false \}\);\s*\}\s*return;\s*\}/s,
  );
  assert.match(
    source,
    /window\.addEventListener\("click", \(event\) => \{[\s\S]*if \(target\.closest\("\[data-header-menu-root\]"\)\) \{\s*return;\s*\}[\s\S]*closeHeaderMenu\(\);[\s\S]*syncNarrowHeaderMenuDom\(\);/s,
  );
  assert.match(
    source,
    /window\.addEventListener\("keydown", \(event\) => \{[\s\S]*target\.matches\('\[data-action="cycle-game-alert-stack"\]'\)[\s\S]*event\.key === "Enter" \|\| event\.key === " "[\s\S]*cycleGameAlertStack\(gameId, target\);[\s\S]*event\.key !== "Escape"[\s\S]*closeHeaderMenu\(\);[\s\S]*syncNarrowHeaderMenuDom\(\);/s,
  );
  assert.match(
    source,
    /const cycleGameAlertStack = \(gameId, actionEl = null\) => \{[\s\S]*const alertCount = getGameAlertItems\(game\)\.length;[\s\S]*refreshMountedAlertHeader\(gameId, actionEl\);/s,
  );
  assert.match(
    source,
    /const refreshMountedAlertHeader = \(gameId = null, actionEl = null\) => \{[\s\S]*render\(\{ animatePanels: false, includeBoard: false \}\);[\s\S]*syncRenderedMarkupSnapshot\(\);[\s\S]*focusCurrentAlertStackCard\(gameId\);/s,
  );
  assert.match(source, /const renderFeedbackReveal = \(message\) =>/);
  assert.match(source, /feedback-reveal\$\{message \? " is-visible" : ""\}/);
  assert.match(source, /const setInviteFeedback = \(message\) => \{\s*inviteFeedback = message;\s*render\(\{ animatePanels: false, includeBoard: false \}\);/s);
});

test("scenario flyout alone forces click target selection on hover-capable boards", () => {
  assert.match(source, /const forceClickTargetSelection = currentRoute\.scenarios;/);
  assert.match(source, /selectionState: scenarioSelectionHydration\.selectionState,[\s\S]*forceClickTargetSelection,[\s\S]*\}\);/s);
  assert.match(source, /getForceClickTargetSelection: \(\) => Boolean\(currentRoute\.scenarios\),/);
  assert.match(
    source,
    /if \(shouldPatchFlyoutsOnly\) \{[\s\S]*if \(includeBoard\) \{[\s\S]*if \(currentRoute\.name === "game"\) \{[\s\S]*mountBoardForGame\(transport\.getGameViewModel\(currentRoute\.gameId\)\);[\s\S]*\} else if \(currentRoute\.name === "invite" && resolvedInvite\?\.gameId\) \{[\s\S]*mountBoardForGame\(transport\.getGameViewModel\(resolvedInvite\.gameId\)\);[\s\S]*\}[\s\S]*\}[\s\S]*return;/s,
  );
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
  assert.match(source, /appEl\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*const controlEl = target\.closest\("button, \.button-link, \.mini-board-card-link-surface"\);[\s\S]*startControlPress\(controlEl\);/s);
  assert.match(source, /window\.addEventListener\("pointerup", \(event\) => \{[\s\S]*action === "jump-history" \|\| action === "return-live"[\s\S]*return;[\s\S]*clearHistoryPress\(\);\s*\}\);/s);
  assert.match(source, /appEl\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*action !== "jump-history" && action !== "return-live"[\s\S]*startHistoryPress\(actionEl\);/s);
  assert.match(source, /const animateHistoryDeselection = async \(actionEl\) => \{/);
  assert.match(source, /currentSelected\.classList\.add\("is-deselecting"\);/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*clearControlPress\(\);[\s\S]*clearHistoryPress\(\);[\s\S]*playHistoryReleaseBounce\(actionEl\);[\s\S]*await animateHistoryDeselection\(actionEl\);/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*clearHistoryPress\(\);[\s\S]*playHistoryReleaseBounce\(actionEl\);/s);
  assert.doesNotMatch(source, /jump-destruction/);
});
