import {icon} from '../shell/ui.js';
import {createConfirmedRemovalPresentation,presentRemovalTransportChange} from '../shell/removal-presentation.js';
import {createDestinationRouteOwner,readGameDestination} from '../shell/destination-route-owner.js';
import {createDestinationRecovery} from '../shell/destination-recovery.js';
import {createGameAlertItems,renderGameAlertStackCard,renderRecoveryActions} from '../shell/game-alert-presentation.js';
import {createMiniPreviewRendering} from '../shell/mini-preview-payloads.js';
import {createHomeCardRendering,getStaticCardPreviewSnapshot,getStaticCardPreviewPayload} from '../shell/home-card-rendering.js';
import {escapeDebug} from '../shell/computer-view.js';
import {renderHomeCardIdentity,renderHomeCardTurn} from '../shell/home-card-identity.js';
import {createHomeSectionReads,createHomeSectionState} from '../shell/home-section-reads.js';
import {historyRenderingFixture} from './support/history-rendering-context.mjs';
import {groupUndoHistory,renderUndoHistoryGroups} from '../shell/history-undo-groups.js';
import {selectedHistoryPresentation} from '../shell/history-narration.js';
import {recordedMoveNumber,visibleRecordedMoves} from '../shell/recorded-narration.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
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
  assert.match(source, /const renderGameShellFrame = \(game, \{ loading = false \} = \{\}\) =>/);
  assert.match(source, /const renderScenarioFlyout = \(\) =>/);
  assert.match(source, /const renderDebugFlyout = \(\) =>/);
  assert.match(source, /<section class="panel debug-panel scenario-panel scenario-panel-load">/);
  assert.match(source, /<section class="panel debug-panel scenario-panel scenario-panel-create">/);
  assert.match(source, /const renderFlyout = \(\{ title, variant, closeAction, body \}\) =>/);
  assert.match(source, /class="shell-flyout-scroll shell-flyout-scroll-\$\{variant\}"/);
  assert.match(source, /closeAction:\s*"close-debug"/);
  assert.match(source, /closeAction:\s*"close-scenarios"/);
  assert.match(source, /class="secondary header-icon-action header-utility-action\$\{currentRoute\.scenarios \? " is-active" : ""\}"/);
  assert.match(source, /data-action="\$\{currentRoute\.scenarios \? "close-scenarios" : "open-scenarios"\}"/);
  assert.match(source, /aria-pressed="\$\{currentRoute\.scenarios \? "true" : "false"\}"/);
  assert.match(source, /class="secondary header-icon-action header-utility-action\$\{currentRoute\.debug \? " is-active" : ""\}"/);
  assert.match(source, /data-action="\$\{currentRoute\.debug \? "close-debug" : "open-debug"\}"/);
  assert.match(source, /aria-pressed="\$\{currentRoute\.debug \? "true" : "false"\}"/);
  assert.match(source, /title: "Debug mode"/);
  assert.match(source, /Scenarios/);
  assert.match(source, /<h1><a class="shell-header-title-link" href="\$\{buildHomeHash\(getCurrentFlyoutState\(\)\)\}" data-flyout-link="home">\$\{renderWordmark\(brand\.getState\(\)\)\}<\/a><\/h1>/);
  assert.match(source, /const renderHeaderWideActions = \(\) =>/);
  assert.match(source, /const renderHeaderNarrowMenu = \(\) =>/);
  assert.match(source, /const renderHeaderAlertZone = \(\) => \{/);
  assert.match(source, /const notificationStack = createNotificationStack\(\);/);
  const stackCard=options=>renderGameAlertStackCard({gameId:'g',item:{key:'item',html:''},totalAlerts:2,...options},String);
  const active=stackCard({stackIndex:0}),inactive=stackCard({stackIndex:1});
  assert.match(active,/data-action="cycle-game-alert-stack"/);assert.match(active,/tabindex="0"/);assert.doesNotMatch(active,/role="button"/);
  assert.match(inactive,/aria-hidden="true" tabindex="-1" inert/);
  assert.match(stackCard({stackIndex:0,totalAlerts:1}),/tabindex="-1"/);
  const items=createGameAlertItems(()=>({transport:{getFailedOperations:()=>[{id:'failure',error:{message:'Failed'}}]},maybeUpdateUndoRequestOutcomeFeedback(){},presentedRecoveryMessage:()=>null,needsRecoveryAction:()=>false,recoveryPresentationOptions:()=>({}),issueDiagnostics:{list:()=>[],capture:()=> 'incident'},isDiagnosticOpen:()=>false,dismissedRecoveryNotices:new Map(),escapeHtml:String,playbackRecoveryWait:{update:()=>0},viewingScope:()=> 'g',liveBoardVisible:()=>true,SYNC_TIMING:{reconnectAlertMs:4000,confirmationBudgetMs:15000},renderComputerProgress:()=>'',computerSession:{snapshot:()=>({})},getActiveRevertRequest:()=>null,getActivePendingRevertRequest:()=>null,undoRequestFeedback:null,undoRequestFeedbackGameId:null,boardContextScope(){},boardContexts:{items:()=>[]},contextReplayEnabled:()=>false}))({id:'g'});
  assert.match(items[0].html,/data-testid="sync-failure-banner"/);assert.match(items[0].html,/data-action="dismiss-failed-operation"/);

  assert.match(source, /const viewedGameId = getCurrentViewedGameId\(\);/);
  assert.match(source, /data-shell-alert-zone="\$\{gameAlerts \|\| startupStatus \? "active" : "idle"\}"/);
  assert.match(source, /data-action="toggle-header-menu"/);
  assert.match(source, /data-header-menu-open="\$\{headerMenuOpen \? "true" : "false"\}"/);
  assert.match(source, /const menuId = "shell-header-menu";/);
  assert.match(source, /aria-controls="\$\{menuId\}"/);
  assert.match(source, /data-header-menu-close="true"/);
  assert.match(source, /class="shell-header-menu-panel\$\{headerMenuOpen \? " is-open" : ""\}"/);
  assert.match(source, /aria-hidden="\$\{headerMenuOpen \? "false" : "true"\}"/);
  assert.match(source, /tabindex="\$\{headerMenuOpen \? "0" : "-1"\}"/);
  assert.doesNotMatch(source, /renderHeaderHomeAction/);
  assert.doesNotMatch(source.slice(source.indexOf("const renderHeader ="), source.indexOf("const renderHome =")), />Home<\/(?:a|span)>/);
  assert.match(source, /const renderDebugContent = \(\) => \{[\s\S]*return renderDecisionDebug/s);
  assert.match(source, /const getFailedOperationsKey = \(gameId\) =>/);
  assert.match(source, /failedOperationsKey: getFailedOperationsKey\(game\.id\)/);
  assert.match(source, /const failedOperationsKey = getFailedOperationsKey\(game\.id\);/);
  assert.match(source, /let isBuildingGameAlerts = false;/);
  assert.match(source, /const renderGameAlertsHtml = \(game, inviteFromRole = null\) => \{[\s\S]*isBuildingGameAlerts = true;[\s\S]*finally \{\s*isBuildingGameAlerts = false;\s*\}/s);
  assert.match(source, /if \(!isBuildingGameAlerts\) \{\s*render\(\{ animatePanels: false, includeBoard: false \}\);\s*\}/s);
  assert.doesNotMatch(source, /failedOperations\.length === 0 && game\.rollbackNotice/);
  assert.doesNotMatch(source, /rollbackNotice: game\.rollbackNotice/);
  assert.match(source, /const items = getHeaderAlertItems\(game\);\s*const scope=game\?\.id \?\? `loading:\$\{loadingContextScope\(\)\}`;\s*const orderedItems = notificationStack\.order\(scope, items\);/);
  assert.match(source, /renderGameAlertStackCard\(\{/);
  assert.match(source, /<div class="shell-header-status" data-shell-alert-zone="\$\{gameAlerts \|\| startupStatus \? "active" : "idle"\}">/);
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
  assert.match(source, /const updateMountedGameShell = \(\{ game, inviteFromRole = null, inviteToken = null, includeBoard = true, animatePanels = false \} = \{\}\) => \{/);
  assert.match(source, /if \(includeBoard \|\| mountedBoardGameId === game\.id \|\| !document\.querySelector\("#shell-board \.cell"\)\) \{\s*mountBoardForGame\(game\);\s*\}/s);
  assert.match(source, /const getMountedHeaderEl = \(\) =>/);
  assert.match(source, /const updateMountedHeader = \(\) => \{/);
  assert.match(source, /patchNotificationTree\(currentHeaderEl, nextHeaderEl\);/);
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
  assert.match(source, /const startGameEntryRouteTransition = \(gameId, fromRoute = currentRoute\?\.name \|\| "unknown", toRoute = 'game', direction = toRoute === 'home' \? 'back' : 'forward'\) => \{/);
  assert.match(source, /const maybeRevealRouteTransition = \(\) => \{/);
  assert.match(source, /const syncRouteTransitionForCurrentRoute = \(\) => \{/);
  assert.match(source, /const isFlyoutOnlyRouteChange = \(previousRoute, nextRoute\) =>/);
  assert.match(source, /let flyoutRenderOrder = FLYOUT_KEYS\.filter\(\(key\) => currentRoute\[key\] === true\);/);
  assert.match(source, /const syncFlyoutRenderOrder = \(route = currentRoute\) => \{/);
  assert.match(source, /const setFlyoutOpenState = \(key, isOpen\) => \{/);
  assert.match(source, /const getOpenFlyoutCount = \(route = currentRoute\) => document\.documentElement\.dataset\.accountFlyout === "true" \? 1 : FLYOUT_KEYS\.reduce\(\(count, key\) => count \+ Number\(route\?\.\[key\] === true\), 0\);/);
  assert.match(source, /const getWideFlyoutWidth = \(viewportWidth = window\.innerWidth\) => \{/);
  assert.match(source, /const getAvailableShellContentWidth = \(viewportWidth = window\.innerWidth, route = currentRoute\) => \{/);
  assert.match(source, /const SHELL_VIEWPORT_GUTTER_PX = 16;/);
  assert.match(source, /const totalHorizontalGutter = SHELL_VIEWPORT_GUTTER_PX \* 2;/);
  assert.match(source, /return Math\.max\(0, viewportWidth - totalHorizontalGutter\);/);
  assert.match(source, /return remaining >= SHELL_WIDE_SCREEN_MIN_WIDTH \? remaining : Math\.max\(0, viewportWidth - totalHorizontalGutter\);/);
  assert.match(source, /const getShellLayoutModeForRoute = \(route = currentRoute, viewportWidth = window\.innerWidth\) =>/);
  assert.match(source, /getAvailableShellContentWidth\(viewportWidth, route\) >= SHELL_WIDE_SCREEN_MIN_WIDTH \? "wide" : "narrow"/);
  assert.match(source, /const getShellLayoutMode = \(viewportWidth = window\.innerWidth\) => getShellLayoutModeForRoute\(currentRoute, viewportWidth\);/);
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
  assert.match(source, /const shouldPatchFlyoutsOnly = !hadResultView && activeResultGameId !== currentRoute\.gameId && shouldPatchMountedFlyouts\(routeKey, baseRouteKey\);/);
  assert.match(source, /const previousPanelHeights = animatePanels && !shouldPatchFlyoutsOnly && baseRouteKey === lastRenderedBaseRouteKey && !routeTransition \? capturePanelHeights\(\) : \[\];/);
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
  assert.match(source, /deltaX: getCssPixelValue\(style\.getPropertyValue\('--flyout-offset-x'\)\) \* rect\.width \/ 100,/);
  assert.match(source, /deltaY: getCssPixelValue\(style\.getPropertyValue\('--flyout-offset-y'\)\) \* rect\.height \/ 100,/);
  assert.match(source, /querySelectorAll\("\.panel"\)/);
  assert.match(source, /class="panel" data-shell-panel="board"/);
  assert.match(source, /scheduleGameShellStickyLayout\(\);/);
  assert.match(source, /render\(\{ animatePanels: false, includeBoard: false \}\);/);
  assert.match(source, /window\.addEventListener\("resize", \(\) => \{[\s\S]*?normalizeRouteFlyoutState\(currentRoute,[\s\S]*?scheduleGameShellStickyLayout\(\);\s*scheduleResponsiveHomeSectionPageSizes\(\);\s*\}\);/s);
  assert.match(source, /window\.addEventListener\("load", \(\) => \{\s*scheduleGameShellStickyLayout\(\);\s*scheduleResponsiveHomeSectionPageSizes\(\);\s*\}\);/s);
  assert.match(source, /syncFlyoutRenderOrder\(currentRoute\);/);
  assert.match(source, /if \(isFlyoutOnlyRouteChange\(previousRoute, nextRoute\)\) \{[\s\S]*render\(\);\s*return;\s*\}/s);
  assert.match(source, /if \(!routeReadChanged && isFlyoutOnlyRouteChange\(previousRoute, currentRoute\)\) \{[\s\S]*render\(\);\s*return;\s*\}/s);
  const routeChange = source.slice(source.indexOf('window.addEventListener("hashchange"'), source.indexOf('let previousLayoutMode ='));
  assert.match(routeChange, /const previousRouteEpoch = hydrateRoute\.currentEpoch\(\);\s*const routeReadChanged = captureRouteRead\(\)\.epoch !== previousRouteEpoch;/);
  assert.ok(routeChange.indexOf('const routeReadChanged =') < routeChange.indexOf('const normalizedHash ='), 'Observe the route before normalization can skip hydration');
  assert.ok(routeChange.indexOf('const routeReadChanged =') < routeChange.indexOf('if (canHydrateRouteFromLocalState(currentRoute))'), 'Observe the route before cached games can skip hydration');
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
  assert.match(source, /if \(shouldPatchFlyoutsOnly\) \{\s*updateMountedHeader\(\);\s*updateMountedFlyouts\(\);\s*restoreScenarioDraftFocus\?\.\(\);\s*syncFlyoutAwareLinks\(\);\s*syncCopyInviteLinks\(\);\s*updateHeaderFields\(\);\s*syncMountedGameShellPanelUi\(\);\s*reconcileMiniBoardPreviews\(\);[\s\S]*syncRenderedMarkupSnapshot\(\);\s*return;\s*\}/s);
  assert.match(source, /shouldUseIncrementalGameShell\(\) &&[\s\S]*getRouteTransitionPhaseKey\(\) === lastRenderedTransitionPhaseKey[\s\S]*updateMountedHeader\(\);\s*updateHeaderFields\(\);\s*syncScenarioAuthoringControls\(\);\s*updateMountedGameShell\(/s);
  assert.match(source, /data-flyout-link="home"/);

  assert.doesNotMatch(source, /data-flyout-link="tutorial"/);
  assert.match(source, /data-action="copy-invite" data-game-id=/);
  assert.doesNotMatch(source, /replaceWith\(previousBoardPanel\)/);
});

test("live sync applies authoritative pushed game payloads before render", () => {
  assert.match(syncStoreSource, /payload\?\.type === "state_sync"/);
  assert.match(syncStoreSource, /payload\?\.type === "event_appended"/);
  assert.match(syncStoreSource, /transport\.applyLiveGameUpdate\(\{\s*game: payload\.game,\s*eventSeq: payload\.eventSeq,\s*clientCommandId: payload\.clientCommandId \?\? null,\s*commandOutcome: payload\.commandOutcome \?\? null,\s*\.\.\.\(payload\.type === "state_sync" \? \{ baseline: true \} : \{\}\),\s*\.\.\.\(payload\.actionContractVersion !== undefined \? \{ actionContractVersion: payload\.actionContractVersion \} : \{\}\),\s*\}\);/s);
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
  assert.match(source, /syncStore\.setActiveGameId\(routeGameId \|\| null\);/);
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

test("history renderer orders turns newest first and keeps native selection targets", () => {
 const {renderTurnHistory}=historyRenderingFixture();
 const game={id:'accepted-game',inHistoryMode:true,historyIndex:0,myRoles:['Player 1'],moves:[
  {moveId:'first',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',notation:'First'},
  {moveId:'second',index:1,turnIndex:1,turnMoveIndex:0,actorSide:'P2',notation:'Second'}]};
 const html=renderTurnHistory(game);
 assert.deepEqual([...html.matchAll(/data-testid="history-turn" aria-label="Turn (\d+) ·/g)].map(match=>Number(match[1])),[2,1]);
 assert.match(html,/data-action="jump-history-turn"/);
 assert.match(html,/data-action="revert-to-move"/);
 const groups=groupUndoHistory('accepted-game',[{moveId:'accepted-move',index:0,turnIndex:0,undone:true,undoEventSeq:17}]);
 const undo=renderUndoHistoryGroups('accepted-game',groups,()=>'<li>Recorded move</li>',new Set(),String);
 assert.match(undo,/data-action="toggle-undone-group"/);
 assert.match(undo,/data-undo-event-seq="17"/);
 assert.match(undo,/aria-expanded="false"/);
});

test("transport subscriptions drive immediate game-shell updates", () => {
  const events=[];let confirmed={id:'g',moves:[],board:{state:{pieces:[{id:'A',position:{row:4,col:2}}]}}};
  const presentation=createConfirmedRemovalPresentation({getScope:()=> 'owner:g',eligible:()=>true,present:()=>events.push('visual'),pending:()=>{},clear:()=>{},consume:()=>{},cue:()=>events.push('cue'),cancelSound:()=>{}});
  const deps={render:options=>events.push(options),presentation,transport:{getAuthoritativeGame:()=>confirmed,getLastEventSeq:()=>2},gameId:'g',view:confirmed,frozen:false};
  presentRemovalTransportChange({...deps,change:{baseline:true}});events.length=0;
  presentRemovalTransportChange({...deps,change:{type:'optimistic_enqueue'}});assert.deepEqual(events,[{animatePanels:false,includeBoard:false}]);events.length=0;
  presentRemovalTransportChange({...deps,change:{type:'maintenance_projection_changed'}});assert.deepEqual(events,[{animatePanels:false,includeBoard:false}]);events.length=0;
  confirmed={id:'g',moves:[{moveId:'accepted',destroyedPieces:[{pieceId:'A',eventId:'accepted:A',position:{row:4,col:2},reason:'no_retreat'}]}],board:{state:{pieces:[]}}};
  presentRemovalTransportChange({...deps,view:confirmed,change:{type:'authoritative_update'}});assert.deepEqual(events,[{animatePanels:false,includeBoard:true},'visual','cue']);presentation.dispose();
  assert.match(source, /const canHydrateRouteFromLocalState = \(route = currentRoute\) => \{/);
  assert.match(source, /return Boolean\(transport\.getGameViewModel\(route\.gameId\)\);/);
  assert.match(source, /const shouldUseIncrementalGameShell = \(gameId = currentRoute\.gameId\) => \{/);
  assert.match(source, /return !game\.pendingPlayerRequestSeat && activeResultGameId !== game\.id && hostInvite\?\.gameId !== game\.id && !getActiveApprovalRequest\(game\) && doesMountedFlyoutStateMatchRoute\(\);/);
  assert.match(source, /updateMountedGameShell\(\{\s*game: transport\.getGameViewModel\(currentRoute\.gameId\),[\s\S]*includeBoard,\s*animatePanels,\s*\}\);/s);
  assert.match(source, /if \(currentRoute\.name === "game"\) \{\s*if \(shouldUseIncrementalGameShell\(\)\) \{\s*(?:if \()?updateMountedGameShell\(\{/s);
  assert.match(source, /if \(!routeHydrated && !game\) \{\s*return renderGameViewSkeleton\(\);/s);
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
  assert.match(source, /Capture a position/);
  assert.match(source, /Replace position with capture/);
  assert.match(source, /Save capture as new scenario/);
  assert.match(source, /canAuthorScenariosLocally\(\)/);
  assert.match(source, /const canSaveScenario = canAuthorScenarios && capturing && Boolean\(saveDraft\.title && saveDraft\.description\);/);
  assert.match(source, /const title = getScenarioEditableFieldText\("title"\);/);
  assert.match(source, /const description = getScenarioEditableFieldText\("description"\);/);
  assert.doesNotMatch(source, /appEl\.addEventListener\("focusout"/);
  assert.match(source, /target\.hasAttribute\("data-scenario-editable"\)/);
  assert.match(source, /action === 'save-scenario-details'/);
  assert.match(source, /includeCurrentBoard:\s*false,/);
  assert.match(source, /feedbackMessage: \(\) => 'Details saved.'/);
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
  assert.match(source, /branchDialog\.open/);
  assert.match(source, /sourceDecisionId: decisionId \?\? selected\?\.moveId/);
  assert.match(source, /const handle = transport\.launchHistoryBranch\(/);
  assert.match(source, /window\.open\(`\$\{window\.location\.pathname\}\$\{window\.location\.search\}\$\{nextHash\}`,\s*["']_blank["'],\s*["']noopener["']\);/);
  assert.match(source, /const initialSelectionHydration = resolveInitialSelectionHydration\(/);
  assert.match(source, /const hydratedSelectionAction = frozenCapture \? null : scenarioSelectionHydration\.selectionAction \?\? initialSelectionHydration\.selectionAction;/);
  assert.match(source, /selectionAction: hydratedSelectionAction,/);
});

test("history navigation stays local-first without the removed global busy wrapper", () => {
  assert.doesNotMatch(source, /const shouldRenderBusyStateStart =/);
  assert.doesNotMatch(source, /const shouldRenderBusyStateEnd =/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*const moveId=actionEl\.getAttribute\("data-move-id"\)\?\?actionEl\.closest\("\.history-item\[data-move-id\]"\)\?\.getAttribute\("data-move-id"\)\?\?null;[\s\S]*await historySelectionTransition\.run\([\s\S]*return transport\.selectHistoryMove\(\{ gameId, moveIndex, moveId \}\);[\s\S]*return;/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*await historySelectionTransition\.run\([\s\S]*return transport\.returnToLive\(\{ gameId \}\);[\s\S]*return;/s);
  assert.doesNotMatch(source, /if \(action === "jump-history"\) \{[\s\S]*await transport\.selectHistoryMove/s);
  assert.doesNotMatch(source, /if \(action === "return-live"\) \{[\s\S]*await transport\.returnToLive/s);
});

test("shell renders durable browser E2E selectors for core workflow surfaces", () => {
  assert.match(source, /data-testid="home-create-game"/);
  assert.match(readFileSync(join(testDir,"..","shell","panel-loading.js"),"utf8"), /data-testid="game-role"/);
  assert.match(source, /data-testid="copy-invite"/);
  assert.match(source, /renderPlayersPanel\(game,/);
  assert.match(readFileSync(join(testDir, "..", "shell", "players-panel.js"), "utf8"), /data-testid="participants-list"/);
  assert.match(source, /data-testid="game-board"/);
  assert.match(readFileSync(join(testDir,"..","shell","panel-loading.js"),"utf8"), /data-testid="history-list"/);
  const {renderTurnHistory}=historyRenderingFixture();
  const recorded={moveId:'recorded',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',notation:'Pass',action:{type:'pass'},selectionSnapshot:{pieces:[]},snapshot:{pieces:[]},destroyedPieces:[{ownerSeat:'p2',position:{row:2,col:3}}]};
  const history=renderTurnHistory({id:'native-selectors',myRoles:['Player 1'],inHistoryMode:true,historyIndex:0,moves:[recorded],pendingMoves:[{...recorded,moveId:'pending',index:1,turnMoveIndex:1}]});
  assert.match(history, /data-testid="history-move-item"/);
  assert.match(history, /data-testid="history-pending-move-item"/);
  assert.match(history, /data-testid="history-destruction-item"/);
  assert.match(history, /data-testid="history-return-live"/);
  assert.match(source, /data-testid="approval-gate"/);
  assert.match(source, /data-testid="accept-request"/);
  assert.match(source, /data-testid="ignore-request"/);
  for(const approval of [false,true]){
    const request={requestId:'undo',targetMoveId:'move'};
    const getItems=createGameAlertItems(()=>({transport:{getFailedOperations:()=>[]},maybeUpdateUndoRequestOutcomeFeedback(){},presentedRecoveryMessage:()=>null,needsRecoveryAction:()=>false,recoveryPresentationOptions:()=>({}),issueDiagnostics:{list:()=>[]},dismissedRecoveryNotices:new Map(),escapeHtml:String,playbackRecoveryWait:{update:()=>0},viewingScope:()=> 'g',liveBoardVisible:()=>true,SYNC_TIMING:{reconnectAlertMs:4000,confirmationBudgetMs:15000},renderComputerProgress:()=>'',computerSession:{snapshot:()=>({})},getActiveRevertRequest:()=>approval?request:null,getActivePendingRevertRequest:()=>approval?null:request,undoApprovalActorSide:()=>null,undoRequestFeedback:null,boardContextScope(){},boardContexts:{items:()=>[]}}));
    const html=getItems({id:'g'})[0].html;
    assert.match(html,new RegExp(`data-testid="${approval?'undo-approval-notice':'undo-waiting-notice'}"`));
    assert.match(html,new RegExp(`data-action="${approval?'accept-revert-request':'rescind-revert-request'}"`));
  }
  assert.match(source, /data-testid="invite-join-player"/);
  assert.match(source, /data-testid="invite-join-viewer"/);
});

test("shell renders and reconciles mini board previews for home and debug surfaces", () => {
  const payloads=new Map();
  const mini=createMiniPreviewRendering({payloads,escapeHtml:escapeDebug});
  const snapshot={sideToMove:'P2',outcome:{status:'ongoing'}},registered=[];
  const card={id:'card',eventSeq:8,gameplayRevision:3,confirmedOutcomeStatus:'ongoing',myRole:'Player 1',myRoles:['Player 1'],moveCount:4,createdAt:'2026-10-01',previewSnapshot:snapshot,player1:{identityId:'me',profile:{displayName:'Kenan'}},player2:{identityId:'other',profile:{displayName:'Ada'}}};
  assert.equal(getStaticCardPreviewSnapshot(card),snapshot);assert.equal(getStaticCardPreviewSnapshot(null),null);
  assert.equal(getStaticCardPreviewPayload(card).snapshot,snapshot);
  const presenter=createHomeCardRendering({getTransport:()=>({getIdentityId:()=> 'me'}),escapeHtml:escapeDebug,toStableKey:JSON.stringify,buildGameHash:id=>`#/game/${id}`,getCurrentFlyoutState:()=>({}),formatDisplayGameId:String,formatClientDateTime:String,renderMiniBoardPreviewRoot:value=>{registered.push(value);return mini.renderMiniBoardPreviewRoot(value);}});
  const html=presenter.renderHomeGameCard(card);
  assert.equal(registered[0].previewId,'home:card');assert.equal(registered[0].snapshot,snapshot);
  assert.equal(payloads.get('home:card').snapshot,snapshot);
  assert.match(html,/data-mini-board-preview data-preview-id="home:card"/);
  assert.match(html,/class="mini-board-card"/);assert.match(html,/class="mini-board-card-link-surface"[\s\S]*href="#\/game\/card"/);assert.match(html,/data-game-id="card"/);assert.match(html,/data-flyout-link="game"/);assert.match(html,/Last move on 2026-10-01/);
  for(const syncStatus of ['desynced','confirming'])assert.match(presenter.renderHomeGameCard({...card,syncStatus}),/<span class="status-chip">Recovering<\/span>/);
  assert.match(presenter.renderHomeGameCard({...card,pendingPreviewSnapshot:snapshot}),/Update pending/);
  assert.match(html,/<div class="mini-board-card-copy">/);assert.match(html,/<div class="mini-board-card-meta mini-board-card-meta-primary">/);assert.match(html,/Move 5/);
  const completed=presenter.renderHomeGameCard({...card,confirmedOutcomeStatus:'p2_win'});assert.match(completed,/4 moves/);assert.match(completed,/Review game/);
  assert.match(source, /const scenarioPreviewPayload = selectedScenario \? buildScenarioStaticPreviewModel\(selectedScenario\) : null;/);
  const named={myRole:'Player 1',player1:{identityId:'me',profile:{displayName:'Kenan'}},player2:{identityId:'other',profile:{displayName:'Ada'}}};
  const quiet=renderHomeCardIdentity(named,{identityId:'me',quiet:true});
  assert.match(quiet,/<bdi>You<\/bdi>/);assert.match(quiet,/<bdi>Ada<\/bdi>/);assert.doesNotMatch(quiet,/connection-status-icon/);
  assert.match(renderHomeCardTurn(named,{sideToMove:'P2'}),/Blue: <\/span><bdi>Ada<\/bdi><\/strong> to play/);
  assert.doesNotMatch(source, /renderHomeSeatConnectionLine|renderHomeConnectionSummary|renderHomeRoleLine/);
  assert.match(source, /reconcileMiniBoardPreviews\(\);\s*syncMountedGameShellPanelUi\(shellRoot\);\s*initializeDesktopBoardFit\(\);\s*scheduleGameShellStickyLayout\(\);/);
});

test("app uses route skeleton sync and localized loading instead of a global busy wrapper", async () => {
  assert.doesNotMatch(source, /const withBusy = async/);
  assert.doesNotMatch(source, /let busy = false;/);
  const mount=source.slice(source.indexOf('mountLoadingFeedback(document,{'),source.indexOf('const currentReplayContext='));
  assert.match(mount,/getScope:loadingContextScope/);
  assert.match(mount,/onContextsChange:contexts=>\{\s*slowLoadingContexts=contexts;/);
  assert.match(mount,/if\(updateMountedHeader\(\)\)syncRenderedMarkupSnapshot\(\);/);
  assert.doesNotMatch(mount,/\brender\(/);
  assert.ok(source.indexOf('mountLoadingFeedback(document,{')>source.indexOf('let transport = syncStore;'),'Loading callbacks mount after authoritative scope initialization');
  assert.match(source, /const pendingHomeSectionKeys = new Set\(\);/);
  assert.match(source, /const SCENARIO_LOAD_PENDING_KEY = "scenario:load";/);
  const state={routeSyncRequestId:0,routeHydrated:true},renders=[],read={route:{name:'game',gameId:'g'},generation:1,epoch:1,routeKey:'g',owner:{}};
  let release;const pending=new Promise(resolve=>release=resolve),recovery=createDestinationRecovery();
  const owner=createDestinationRouteOwner(()=>({state,captureRouteRead:()=>read,routeReadIsCurrent:value=>value===read,canHydrateRouteFromLocalState:()=>false,destinationRecovery:recovery,
    syncDestinationNotice(){},syncLiveChannels(){},render:options=>renders.push(options),syncRouteDataAndLiveChannels:()=>pending,
    issueDiagnostics:{resolve(){}},cancelPendingBoardContextReplay(){},window:{},invitationLoadFailureKind:()=> 'retry',maybeRevealRouteTransition(){}}));
  owner.start();assert.equal(state.routeHydrated,false);assert.deepEqual(renders,[{animatePanels:false,includeBoard:false}]);
  release();await new Promise(setImmediate);assert.equal(state.routeHydrated,true);assert.equal(renders.length,2);recovery.reset();
  assert.match(source, /const initialRender = async \(\) => \{[\s\S]*?routeHydrated = false;\s*render\(\{ animatePanels: false, includeBoard: false \}\);[\s\S]*?await account\.start\(\);/s);
  assert.match(source, /startRouteSync\(\{ renderStart: false \}\);/);
  assert.match(source, /renderGameViewSkeleton\(\)/);
  assert.match(source, /renderInvitePageSkeleton\(\)/);
  const inviteRender = source.slice(source.indexOf('  } else if (currentRoute.name === "invite") {'), source.indexOf('  } else if (currentRoute.name === "tutorial") {'));
  assert.match(inviteRender, /if \(inviteLoadState && routeReadIsCurrent\(inviteLoadState\.read\) && \(inviteLoadState\.status === "error" \|\| inviteLoadState\.retrying\)\) \{/);
  assert.match(inviteRender, /body = renderInvitationSurface\(\{\s*content: renderInviteLoadRecovery\([\s\S]*?background: renderGameViewSkeleton\(\),\s*\}\);\s*\} else if \(!routeHydrated\) \{\s*body = renderInvitePageSkeleton\(\);/s);
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
    /const cycleGameAlertStack = \(gameId, actionEl = null\) => \{[\s\S]*if\(gameId!==scope\)return;\s*const items = getHeaderAlertItems\(game\);[\s\S]*notificationStack\.advance\(scope, items\)[\s\S]*refreshMountedAlertHeader\(gameId, actionEl\);/s,
  );
  assert.match(
    source,
    /const refreshMountedAlertHeader = \(gameId = null, actionEl = null\) => \{[\s\S]*render\(\{ animatePanels: false, includeBoard: false \}\);[\s\S]*syncRenderedMarkupSnapshot\(\);[\s\S]*focusCurrentAlertStackCard\(gameId\);/s,
  );
  assert.match(source, /const renderFeedbackReveal = \(message\) =>/);
  assert.match(source, /feedback-reveal\$\{message \? " is-visible" : ""\}/);
  assert.match(source, /const setInviteFeedback = \(message\) => \{\s*inviteFeedback = message;\s*render\(\{ animatePanels: false, includeBoard: false \}\);/s);
});

test("only an explicit scenario capture forces click target selection", () => {
  assert.match(source, /const forceClickTargetSelection = Boolean\(capturing\);/);
  assert.match(source, /selectionState: hydratedSelectionState,[\s\S]*forceClickTargetSelection,[\s\S]*\}\);/s);
  assert.match(source, /getForceClickTargetSelection: \(\) => Boolean\(currentRoute\.scenarios && scenarioCapture\?\.gameId === game\.id\),/);
  assert.match(
    source,
    /if \(shouldPatchFlyoutsOnly\) \{[\s\S]*if \(includeBoard\) \{[\s\S]*if \(currentRoute\.name === "game"\) \{[\s\S]*mountBoardForGame\(transport\.getGameViewModel\(currentRoute\.gameId\)\);[\s\S]*\} else if \(currentRoute\.name === "invite" && resolvedInvite\?\.gameId\) \{[\s\S]*mountBoardForGame\(transport\.getGameViewModel\(resolvedInvite\.gameId\)\);[\s\S]*\}[\s\S]*\}[\s\S]*return;/s,
  );
});

test("history navigation shares the native control press and release owner", () => {
  assert.match(source, /const startControlPress = \(controlEl\) => \{/);
  assert.match(source, /const clearControlPress = \(\) => \{/);
  assert.match(source, /const playControlReleaseBounce = \(controlEl\) => \{/);
  assert.match(source, /appEl\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*const controlEl = target\.closest\("button, \.button-link, \.mini-board-card-link-surface"\);[\s\S]*startControlPress\(controlEl\);/s);
  assert.match(source, /window\.addEventListener\("pointerup", \(\) => \{[\s\S]*playControlReleaseBounce\(pressedControlEl\);[\s\S]*clearControlPress\(\);\s*\}\);/s);
  assert.doesNotMatch(source, /startHistoryPress|clearHistoryPress|playHistoryReleaseBounce|history-board-pressing|history-board-release/);
  assert.doesNotMatch(source, /jump-destruction/);
});

test("upgrade fencing keeps a static recovery notice without discarding viewing context", () => {
 const subscriber=source.slice(source.indexOf('const subscribeToTransport'),source.indexOf('subscribeToTransport();'));
 assert.doesNotMatch(subscriber,/location\.reload|sync-v2-refresh/);
 const upgrade=renderRecoveryActions({game:{id:'g',upgradeRequired:true},dismissed:false,recoveryNeedsAction:true,escapeHtml:String});
 assert.match(upgrade,/<button class="secondary[^"\n]*" data-action="refresh-game">[\s\S]*?Reload game<\/button>/);
 assert.match(upgrade,/<a[^>]+href="#\/">[\s\S]*?Home<\/a>/);assert.doesNotMatch(upgrade,/reconnect-safely/);
 const cold=readGameDestination({gameId:'g',transport:{getGameViewModel:()=>null,isUpgradeRequired:()=>true},presentation:null,icon}).markup;
 assert.match(cold,/data-action="refresh-game"/);assert.match(cold,/>Reload game<\/button>/);assert.match(cold,/href="#\/"/);assert.doesNotMatch(cold,/reconnect-safely/);
});

test("loading frames and guest invitation surfaces never enter the loaded-shell patch path", () => {
 const gate=source.slice(source.indexOf('const shouldUseIncrementalGameShell'),source.indexOf('const renderGameContent'));
 assert.match(gate,/\[data-game-shell-root\]\[data-testid="game-shell"\]/);
 assert.match(gate,/getInviteContextForGame\(game, "game"\)\) return false/);
 assert.doesNotMatch(gate,/game-loading-shell/);
});


test('startup progress and bootstrap retry stay in the out-of-flow header status zone',()=>{
 const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 const zone=source.slice(source.indexOf('const renderHeaderAlertZone ='),source.indexOf('const syncShellLayoutMode ='));
 const header=source.slice(source.indexOf('const renderHeader ='),source.indexOf('const setSelectedScenarioFeedback ='));
 assert.match(zone,/loadingAttributes\("account-startup"/);assert.match(zone,/role="status">Connecting/);assert.match(zone,/role="alert"/);assert.match(zone,/data-action="retry-account-startup"/);assert.match(zone,/\$\{startupStatus\}/);
 assert.doesNotMatch(header,/loadingAttributes\("account-startup"|data-action="retry-account-startup"/);
});

test('home loading metadata matches the consolidated identity title without an obsolete presence row',()=>{
 const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');const skeleton=source.slice(source.indexOf('const renderHomeCardSkeleton ='),source.indexOf('const renderHomeSectionSkeleton ='));
 assert.match(skeleton,/mini-board-card-meta mini-board-card-meta-primary/);assert.doesNotMatch(skeleton,/mini-board-card-connection-line/);
 assert.match(skeleton,/length:100/);assert.match(skeleton,/mini-board-preview-status/);
});


test('all history undo/create actions belong to moves and the top keeps only Return to live',()=>{
 const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');const panel=source.slice(source.indexOf('const renderHistoryPanel ='),source.indexOf('const renderBoardPanel ='));
 assert.doesNotMatch(panel,/data-action="(?:launch-history-branch|revert-to-move|undo-last-move)"/);
 assert.doesNotMatch(source,/data-action="undo-last-move"/);
 const {renderTurnHistory}=historyRenderingFixture();
 const moves=renderTurnHistory({id:'move-actions',myRoles:['Player 1'],inHistoryMode:true,historyIndex:0,moves:[{moveId:'selected',index:0,turnIndex:0,turnMoveIndex:0,actorSide:'P1',notation:'Pass',action:{type:'pass'},selectionSnapshot:{pieces:[]},snapshot:{pieces:[]}}]});
 const returnLine=moves.match(/<li class="history-empty-line history-return-live">[\s\S]*?<\/li>/)?.[0];
 assert.ok(returnLine,'The native Return to live line must exist');assert.match(returnLine,/data-testid="history-return-live"/);
 assert.doesNotMatch(returnLine,/data-action="(?:launch-history-branch|revert-to-move|undo-last-move)"/);
 const selectedRow=moves.match(/<li class="history-item [^"]*"[^>]*data-move-id="selected"[\s\S]*?<\/li>/)?.[0];
 assert.ok(selectedRow,'The selected move row must exist');assert.match(selectedRow,/history-item-actions/);assert.match(selectedRow,/data-action="launch-history-branch"/);assert.match(selectedRow,/data-action="revert-to-move"/);
 const css=readFileSync(new URL('../shell/shell.css',import.meta.url),'utf8');assert.match(css,/\.shell-header-menu-button \{\s*display: flex;\s*align-items: center;\s*justify-content: center;/);
});

test('Home responsive frames cancel stale scheduling and page navigation scrolls after settled publication',async()=>{
 let frameId=0;const frames=new Map(),cancelled=[],events=[];
 const window={requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>{cancelled.push(id);frames.delete(id);}};
 const owner={getHomeListRevision:()=>null},read={owner,homeDebug:false};
 const state={homeSections:{my:{...createHomeSectionState('My games'),loaded:true,totalGames:8,totalPages:3,gameIds:['a','b','c'],visiblePageSize:3,visibleColumnCount:3,serverPageGameIdsByPage:{0:['a','b','c','d'],1:['e','f','g','h']}}},currentRoute:{name:'home'},homeReadVisit:1,homeSectionResizeFrame:0,lastHomeBatchRevision:null,transport:owner};
 const pending=new Set(),controller=createHomeSectionReads({state,window,getVisibleHomeSectionKeys:()=>['my'],getHomeSection:key=>state.homeSections[key],setHomeSection:(key,value)=>state.homeSections[key]=value,
 getHomeSectionVisiblePageSize:()=>3,getHomeSectionColumnCount:()=>1,captureRouteRead:()=>read,assertCurrentRouteRead:value=>assert.equal(value,read),routeReadIsCurrent:value=>value===read,
 pendingHomeSectionKeys:pending,isHomeSectionPending:key=>pending.has(key),render:()=>events.push(['render',pending.size]),syncLiveChannels:()=>events.push(['sync']),gameSound:{play(){}},scrollHomeSectionToTop:key=>events.push(['scroll',key]),saveHomeVisit:()=>events.push(['save-visit'])});
 controller.scheduleResponsive();const old=state.homeSectionResizeFrame;controller.scheduleResponsive();assert(cancelled.includes(old));assert.equal(frames.size,1);
 await [...frames.values()][0]();frames.clear();assert.equal(state.homeSectionResizeFrame,0);assert.equal(state.homeSections.my.visibleColumnCount,1);assert.deepEqual(events,[['sync'],['render',0]]);
 events.length=0;await controller.next('my');assert.deepEqual(events,[['render',1],['sync'],['render',0]]);assert.equal(pending.size,0);assert.equal(frames.size,1);[...frames.values()][0]();assert.deepEqual(events.slice(-2),[['scroll','my'],['save-visit']]);
});
