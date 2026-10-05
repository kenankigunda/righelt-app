import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const source = readFileSync(join(testDir, "..", "shell", "app.js"), "utf8");
const syncStoreSource = readFileSync(join(testDir, "..", "shell", "sync-store.js"), "utf8");
const shellHostSource = readFileSync(join(testDir, "..", "board", "hosts", "shell-host.js"), "utf8");

const extractSourceSegment = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `expected start marker: ${startMarker}`);
  assert.notEqual(end, -1, `expected end marker: ${endMarker}`);
  return source.slice(start, end);
};

test("game controls do not render standalone record-move or end-turn buttons", () => {
  assert.doesNotMatch(source, /data-action="record-move"/);
  assert.doesNotMatch(source, /data-action="end-turn"/);
  assert.doesNotMatch(source, /getActionType:\s*\(\)\s*=>\s*"pass"/);
  assert.match(shellHostSource, /const turnChanged = state\?\.sideToMove !== snapshot\?\.sideToMove \|\| state\?\.turnIndex !== snapshot\?\.turnIndex;/);
  assert.match(shellHostSource, /type:\s*turnChanged\s*\?\s*"turn_ended"\s*:\s*"move_sent"/);
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
  assert.match(
    source,
    /<div class="section-followup">\s*\$\{historyBanner\}\s*<ol class="history-list"[^>]*>\$\{historyRows\}<\/ol>/s,
  );
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
});

test("history live-return control stays mounted without blocking through the global busy gate", () => {
  assert.match(source, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
  assert.doesNotMatch(source, /data-action="return-live"[^`]*\$\{busy \? "disabled" : ""\}/);
  assert.match(source, /if \(action === "jump-history"\) \{[\s\S]*transport\.selectHistoryMove\(\{ gameId, moveIndex \}\);[\s\S]*return;/s);
  assert.match(source, /if \(action === "return-live"\) \{[\s\S]*transport\.returnToLive\(\{ gameId \}\);[\s\S]*return;/s);
  assert.match(syncStoreSource, /selectHistoryMove: \(\{ gameId, moveIndex \}\) => operationManager.createCommitted/);
  assert.match(syncStoreSource, /returnToLive: \(\{ gameId \}\) => operationManager.createCommitted/);
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
  assert.match(source, /if \(read\.route\.name === "game"\) \{\s*resolvedInvite = null;\s*await read\.owner\.loadGame\(read\.route\.gameId, \{ openAsViewer: false \}\);\s*\}/s);
  assert.match(source, /const startRouteSync = \(\{ renderStart = true \} = \{\}\) => \{/);
  assert.match(source, /routeHydrated = false;\s*syncLiveChannels\(\);/s);
  assert.match(source, /const initialRender = async \(\) => \{[\s\S]*?routeHydrated = false;\s*render\(\{ animatePanels: false, includeBoard: false \}\);[\s\S]*?await account\.start\(\);/s);
  assert.match(source, /startRouteSync\(\{ renderStart: false \}\);/);
  assert.match(source, /routeHydrated = true;\s*render\(\{ animatePanels: false, includeBoard: false \}\);/s);
});

test("game route live sync connection is not gated by participant role", () => {
  assert.match(
    source,
    /const routeGameId =\s*shouldLiveSyncRoute\(currentRoute\)\s*&&/s,
  );
  assert.match(source, /syncStore\.setActiveGameId\(routeGameId\);/);
  assert.match(syncStoreSource, /const getLocalFailureMessage = \(game\) =>/);
  assert.match(syncStoreSource, /const isFailedLocalStub = \(game\) =>/);
  assert.match(syncStoreSource, /const activeGame =/);
  assert.match(syncStoreSource, /const desiredGameIds =[\s\S]*isFailedLocalStub\(activeGame\)/);
  assert.match(syncStoreSource, /liveSync\.disconnectGame\(gameId\);/);
  assert.match(syncStoreSource, /liveSync\.connectGame\(gameId\);/);
});

test("optimistic game creation and history branch actions bypass the blocking busy wrapper", () => {
  assert.match(source, /if \(action === "create-game" \|\| action === 'create-self-play'\) \{\s*gameSound\.play\('enter'\);\s*const handle = transport\.createGame\(\{ selfPlayMode: action === 'create-self-play' \}\);/s);
  assert.match(source, /startGameEntryRouteTransition\(handle\.result\.id, "home"\);/);
  assert.match(source, /navigateTo\(buildGameHash\(handle\.result\.id, null, getCurrentFlyoutState\(\)\)\);/);
  assert.match(source, /if \(action === "launch-history-branch"\) \{[\s\S]*const handle = transport\.launchHistoryBranch\(/s);
  assert.match(source, /const nextHash = buildGameHash\(handle\.result\.game\.id, null, \{/s);
  assert.doesNotMatch(source, /if \(action === "create-game"\) \{[\s\S]*await transport\.createGame/s);
});

test("home game-card links trigger the branded game-entry transition before same-tab navigation", () => {
  assert.match(source, /const gameLinkEl = target\.closest\("\.mini-board-card-link-surface\[data-game-id\]"\);/);
  assert.match(source, /gameLinkEl instanceof HTMLAnchorElement/);
  assert.match(source, /currentRoute\.name === "home"/);
  assert.match(source, /startGameEntryRouteTransition\(gameId, "home"\);/);
});

test("revert actions bypass the blocking busy wrapper and use optimistic sync-store handles", () => {
  assert.match(source, /if \(action === "accept-revert-request"\) \{[\s\S]*transport\.approveRevertRequest\(\{ gameId, requestId \}\);/s);
  assert.match(source, /if \(action === "reject-revert-request"\) \{[\s\S]*transport\.rejectRevertRequest\(\{ gameId, requestId \}\);/s);
  assert.match(source, /if \(action === "rescind-revert-request"\) \{[\s\S]*transport\.rescindRevertRequest\(\{ gameId, requestId \}\);/s);
  assert.match(source, /if \(action === "revert-to-move" \|\| action === "undo-last-move"\) \{[\s\S]*transport\.requestRevertToMove\(\{ gameId, targetMoveId: moveId \}\);/s);
  assert.doesNotMatch(source, /if \(action === "accept-revert-request"\) \{[\s\S]*await transport\.approveRevertRequest/s);
  assert.doesNotMatch(source, /if \(action === "revert-to-move" \|\| action === "undo-last-move"\) \{[\s\S]*await transport\.requestRevertToMove/s);
});

test("join, approval, and pending invite copy use localized button pending instead of the global busy gate", () => {
  assert.match(source, /const getJoinButtonKey = \(mode, gameId\) => `join:\$\{mode\}:\$\{gameId\}`;/);
  assert.match(source, /const getApproveRequestButtonKey = \(gameId, requesterIdentityId\) => `approve-request:\$\{gameId\}:\$\{requesterIdentityId\}`;/);
  assert.match(source, /const getCopyInviteButtonKey = \(gameId\) => `copy-invite:\$\{gameId\}`;/);
  assert.match(source, /const withPendingButton = async \(pendingKey, fn, \{ renderStart = true, renderEnd = true \} = \{\}\) => \{/);
  assert.match(source, /const renderButtonStateAttributes = \(\{ className = "", pendingKey = null, disabled = false \} = \{\}\) => \{/);
  assert.match(source, /data-testid="join-viewer"[^`]*renderButtonStateAttributes\(\{\s*className: "secondary",\s*pendingKey: joinViewerButtonKey,/s);
  assert.match(source, /data-testid="join-player"[^`]*renderButtonStateAttributes\(\{\s*pendingKey: joinPlayerButtonKey,/s);
  assert.match(source, /data-testid="approve-request-inline"[^`]*renderButtonStateAttributes\(/s);
  assert.match(source, /data-testid="copy-invite"[^`]*renderButtonStateAttributes\(\{\s*pendingKey: copyInviteButtonKey,/s);
  assert.match(source, /if \(action === "join-viewer" \|\| action === "accept-invite-viewer"\) \{[\s\S]*withPendingButton\(getJoinButtonKey\("viewer", gameId\), async \(\) => \{/s);
  assert.match(source, /if \(action === "join-player" \|\| action === "accept-invite-player"\) \{[\s\S]*withPendingButton\(getJoinButtonKey\("player", gameId\), async \(\) => \{/s);
  assert.match(source, /if \(action === "approve-request" \|\| action === "accept-request"\) \{[\s\S]*withPendingButton\(getApproveRequestButtonKey\(gameId, requester\), async \(\) => \{/s);
  assert.match(source, /if \(action === "copy-invite"\) \{[\s\S]*const gameHandle = transport\.getGameHandle\?\.\(gameId\) \?\? null;/s);
  assert.match(syncStoreSource, /getGameHandle: \(gameId\) => \{/);
  assert.match(syncStoreSource, /operationManager\.getHandle\(`create:\$\{gameId\}`\)/);
  assert.match(syncStoreSource, /operationManager\.getHandle\(`branch:\$\{gameId\}`\)/);
  assert.doesNotMatch(source, /data-testid="join-viewer"[^`]*busy \? "disabled" : ""/s);
  assert.doesNotMatch(source, /data-testid="join-player"[^`]*busy \? "disabled" : ""/s);
  assert.doesNotMatch(source, /data-testid="invite-join-player"[^`]*busy \? "disabled" : ""/s);
  assert.doesNotMatch(source, /data-testid="invite-join-viewer"[^`]*busy \? "disabled" : ""/s);
  assert.doesNotMatch(source, /data-testid="copy-invite"[^`]*busy \? "disabled" : ""/s);
});

test("scenario actions use localized pending controls instead of ad hoc button locking", () => {
  assert.match(source, /const SCENARIO_LOAD_PENDING_KEY = "scenario:load";/);
  assert.match(source, /const SCENARIO_UPDATE_PENDING_KEY = "scenario:update";/);
  assert.match(source, /const SCENARIO_SAVE_PENDING_KEY = "scenario:save";/);
  assert.match(source, /data-action="load-scenario"[^`]*renderButtonStateAttributes\(\{\s*pendingKey: SCENARIO_LOAD_PENDING_KEY,/s);
  assert.match(source, /data-action="update-scenario"[^`]*renderButtonStateAttributes\(\{\s*className: "secondary",\s*pendingKey: SCENARIO_UPDATE_PENDING_KEY,/s);
  assert.match(source, /data-action="save-scenario"[^`]*renderButtonStateAttributes\(\{\s*className: "secondary",\s*pendingKey: SCENARIO_SAVE_PENDING_KEY,/s);
  assert.match(source, /if \(action === "load-scenario"\) \{[\s\S]*await withPendingButton\(\s*SCENARIO_LOAD_PENDING_KEY,/s);
  assert.match(source, /if \(action === "update-scenario" \|\| action === "save-scenario"\) \{[\s\S]*withPendingButton\(\s*SCENARIO_UPDATE_PENDING_KEY,/s);
  assert.match(source, /if \(action === "update-scenario" \|\| action === "save-scenario"\) \{[\s\S]*withPendingButton\(\s*SCENARIO_SAVE_PENDING_KEY,/s);
});

test("home uses per-section pagination and renders the smoke section only in debug mode", () => {
  assert.match(source, /const isPlayerRole = \(role\) => role === "Player 1" \|\| role === "Player 2";/);
  assert.match(source, /const HOME_SECTION_SERVER_PAGE_SIZE = 4;/);
  assert.match(source, /const HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT = 3;/);
  assert.match(source, /const HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE = 4;/);
  assert.match(source, /const HOME_SECTION_CARD_MIN_WIDTH_REM = 22;/);
  assert.match(source, /const HOME_SECTION_CARD_GAP_REM = 0\.85;/);
  assert.match(source, /let homeSections = \{/);
  assert.match(source, /my: createHomeSectionState\("My games"\),/);
  assert.match(source, /other: createHomeSectionState\("Other games"\),/);
  assert.match(source, /smoke: createHomeSectionState\("Deploy smoke player"\),/);
  assert.match(source, /serverPage:\s*0,/);
  assert.match(source, /serverTotalPages:\s*0,/);
  assert.match(source, /serverPageGameIds:\s*\[\],/);
  assert.match(source, /serverPageGameIdsByPage:\s*\{\},/);
  assert.match(source, /visiblePageSize:\s*HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT,/);
  assert.match(source, /visibleColumnCount:\s*1,/);
  assert.match(source, /const getVisibleHomeSectionKeys = \(route = currentRoute\) => \(route\?\.debug \? \["my", "other", "smoke"\] : \["my", "other"\]\);/);
  assert.match(source, /const getHomeSectionCardMinWidthPx = \(\) => getRootFontSizePx\(\) \* HOME_SECTION_CARD_MIN_WIDTH_REM;/);
  assert.match(source, /const getHomeSectionCardGapPx = \(\) => getRootFontSizePx\(\) \* HOME_SECTION_CARD_GAP_REM;/);
  assert.match(source, /const carouselEl = appEl\?\.querySelector\?\.\(`\[data-home-carousel="\$\{sectionKey\}"\]`\);/);
  assert.match(source, /return carouselEl\.getBoundingClientRect\(\)\.width;/);
  assert.match(source, /const styles = window\.getComputedStyle\(sectionEl\);/);
  assert.match(source, /return Math\.max\(0, sectionEl\.clientWidth - paddingLeft - paddingRight\);/);
  assert.match(source, /const getHomeSectionColumnCount = \(sectionKey\) => \{/);
  assert.match(source, /Math\.max\(1, Math\.floor\(\(sectionWidth \+ gapWidth\) \/ \(cardWidth \+ gapWidth\)\)\)/);
  assert.match(source, /const getHomeSectionVisiblePageSize = \(sectionKey\) =>/);
  assert.match(source, /const columnCount = getHomeSectionColumnCount\(sectionKey\);/);
  assert.match(source, /if \(columnCount >= 3\) \{\s*return HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT;\s*\}/s);
  assert.match(source, /if \(columnCount === 2\) \{\s*return HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE;\s*\}/s);
  assert.match(source, /return HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT;/);
  assert.match(source, /HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE/);
  assert.match(source, /HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT/);
  assert.match(source, /const getHomeSectionRequiredServerPages = \(\{ totalGames, visiblePageSize, page \}\) => \{/);
  assert.match(source, /const getHomeSectionVisibleGameIdsFromCache = \(section, \{ page = section\.page, visiblePageSize = section\.visiblePageSize \} = \{\}\) => \{/);
  assert.match(source, /const getHomeSectionCachedGameIndex = \(section, gameId\) => \{/);
  assert.match(source, /data-action="home-page-prev"/);
  assert.match(source, /data-action="home-page-next"/);
  assert.match(source, /data-home-section="\$\{escapeHtml\(sectionKey\)\}"/);
  assert.match(source, /data-home-section-root="\$\{escapeHtml\(sectionKey\)\}"/);
  assert.match(source, /const renderHomeSectionControls = \(sectionKey, section, \{ placement \} = \{ placement: "header" \}\) =>/);
  assert.match(source, /const renderHomeStartButton = \(\) =>/);
  assert.match(source, /data-action="create-game"/);
  assert.match(source, /home-games-section-controls home-games-section-controls-\$\{escapeHtml\(placement\)\}/);
  assert.match(source, /const shouldAlwaysRender = sectionKey === "my";/);
  assert.match(source, /const showEmptyState = section\.totalGames === 0;/);
  assert.match(source, /const showHeaderPaging = showPaging && section\.visibleColumnCount > 1;/);
  assert.match(source, /const showFooterPaging = showPaging && section\.visibleColumnCount === 1;/);
  assert.match(source, /const hasHeaderAction = false;/);
  assert.match(
    source,
    /<div class="home-games-section-header" data-home-header-has-action="\$\{hasHeaderAction \? "true" : "false"\}" data-home-header-paging="\$\{showHeaderPaging \? "true" : "false"\}">/,
  );
  assert.match(source, /<div class="home-games-section-header-center">/);
  assert.match(source, /<div class="home-games-section-header-actions">/);
  assert.match(source, /<div class="home-games-section-heading">/);
  assert.match(
    source,
    /<div class="home-games-section-header-center">\s*\$\{showHeaderPaging \? renderHomeSectionControls\(sectionKey, section, \{ placement: "header" \}\) : ""\}\s*<\/div>/s,
  );
  assert.match(
    source,
    /<div class="home-games-section-header-actions">\s*\$\{hasHeaderAction \? renderHomeStartButton\(\) : ""\}\s*<\/div>/s,
  );
  assert.match(source, /renderHomeSectionControls\(sectionKey, section, \{ placement: "header" \}\)/);
  assert.match(source, /renderHomeSectionControls\(sectionKey, section, \{ placement: "footer" \}\)/);
  assert.match(source, /hasHeaderAction \? renderHomeStartButton\(\) : ""/);
  assert.match(source, /<p class="small home-games-empty">Your next good game starts here\.<\/p>/);
  assert.match(source, /const scrollHomeSectionToTop = \(sectionKey\) => \{/);
  assert.match(source, /if \(getShellLayoutMode\(\) !== "narrow" \|\| !\(appEl instanceof HTMLElement\)\) \{\s*return;\s*\}/s);
  assert.match(source, /sectionEl\.scrollIntoView\(\{\s*behavior: "smooth",\s*block: "start",\s*\}\);/s);
  assert.match(
    source,
    /const loadHomeSectionServerPage = async \(\s*sectionKey,\s*serverPage,\s*\{\s*visiblePageSize = getHomeSectionVisiblePageSize\(sectionKey\),\s*visibleColumnCount = getHomeSectionColumnCount\(sectionKey\),\s*\} = \{\},\s*\) => \{/s,
  );
  assert.match(source, /pageSize:\s*HOME_SECTION_SERVER_PAGE_SIZE,/);
  assert.match(source, /serverPageGameIdsByPage:\s*\{\s*\.\.\.previous\.serverPageGameIdsByPage,\s*\[normalizedServerPage\]: serverPageGameIds,/s);
  assert.match(source, /const syncResponsiveHomeSectionPageSizes = async \(\) => \{/);
  assert.match(source, /const nextVisibleColumnCount = getHomeSectionColumnCount\(sectionKey\);/);
  assert.match(source, /section\.visiblePageSize === nextVisiblePageSize && section\.visibleColumnCount === nextVisibleColumnCount/);
  assert.match(source, /visibleColumnCount:\s*nextVisibleColumnCount,/);
  assert.match(source, /const anchorGameId = section\.gameIds\[0\] \?\? null;/);
  assert.match(source, /const anchorIndex = getHomeSectionCachedGameIndex\(section, anchorGameId\);/);
  assert.match(source, /const nextPage = anchorIndex === null \? section\.page : Math\.floor\(anchorIndex \/ nextVisiblePageSize\);/);
  assert.match(source, /visiblePageSize:\s*getHomeSectionVisiblePageSize\(sectionKey\),/);
  assert.match(source, /visibleColumnCount:\s*getHomeSectionColumnCount\(sectionKey\),/);
  assert.match(source, /<div class="home-games-carousel" data-home-carousel="\$\{escapeHtml\(sectionKey\)\}">/);
  assert.match(source, /getVisibleHomeSectionKeys\(\)\.filter\(key=>key!=='my'\)\.map\(renderHomeGameSection\)\.join\(''\)/);
  assert.match(source, /<section class="panel home-games-section" data-home-section-root="\$\{escapeHtml\(sectionKey\)\}">/);
  assert.match(source, /<h2>\$\{escapeHtml\(section\.title\)\}<\/h2>/);
  assert.match(source, /<div class="mini-board-card-list" data-game-count="\$\{games\.length\}">/);
  assert.doesNotMatch(source, /class="panel home-start-panel"/);
  assert.doesNotMatch(source, /<h2>Active Games<\/h2>/);
  assert.doesNotMatch(source, /<h2>Preview Board/);
});

test("home visible page size maps 3/2/1 columns to 3/4/3 cards", () => {
  const match = source.match(/const getHomeSectionVisiblePageSize = \(sectionKey\) => \{([\s\S]*?)\n\};/);
  assert.ok(match, "expected getHomeSectionVisiblePageSize definition");

  const createVisiblePageSize = new Function(
    "getHomeSectionColumnCount",
    "HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT",
    "HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE",
    `return (sectionKey) => {${match[1]}\n};`,
  );

  const wideThreeColumn = createVisiblePageSize(() => 3, 3, 4);
  const twoColumn = createVisiblePageSize(() => 2, 3, 4);
  const oneColumn = createVisiblePageSize(() => 1, 3, 4);

  assert.equal(wideThreeColumn("my"), 3);
  assert.equal(twoColumn("my"), 4);
  assert.equal(oneColumn("my"), 3);
});

test("home visible game cache stitches 4-item server pages into 3-item single-column pages", () => {
  const helpers = extractSourceSegment("const getHomeSectionVisibleTotalPages", "const getHomeSectionCachedGameIndex");
  const createHelpers = new Function(
    "HOME_SECTION_SERVER_PAGE_SIZE",
    `${helpers}
    return {
      getHomeSectionVisibleGameIdsFromCache,
    };`,
  );
  const { getHomeSectionVisibleGameIdsFromCache } = createHelpers(4);
  const section = {
    totalGames: 7,
    page: 0,
    visiblePageSize: 3,
    serverPageGameIdsByPage: {
      0: ["a", "b", "c", "d"],
      1: ["e", "f", "g"],
    },
  };

  assert.deepEqual(getHomeSectionVisibleGameIdsFromCache(section, { page: 0, visiblePageSize: 3 }), ["a", "b", "c"]);
  assert.deepEqual(getHomeSectionVisibleGameIdsFromCache(section, { page: 1, visiblePageSize: 3 }), ["d", "e", "f"]);
  assert.deepEqual(getHomeSectionVisibleGameIdsFromCache(section, { page: 2, visiblePageSize: 3 }), ["g"]);
});

test("responsive home pagination reanchors from 2-column pages to 1-column pages using the leading visible game", async () => {
  const segment = extractSourceSegment("const syncResponsiveHomeSectionPageSizes = async () => {", "const syncHomeSections = async () => {");
  const createSyncResponsiveHomeSectionPageSizes = new Function(
    "getVisibleHomeSectionKeys",
    "getHomeSection",
    "getHomeSectionColumnCount",
    "getHomeSectionVisiblePageSize",
    "getHomeSectionCachedGameIndex",
    "getHomeSectionVisibleGameIdsFromCache",
    "setHomeSection",
    "loadHomeSectionPage",
    `${segment}
    return syncResponsiveHomeSectionPageSizes;`,
  );

  const section = {
    page: 1,
    totalGames: 8,
    totalPages: 2,
    gameIds: ["e", "f", "g", "h"],
    visiblePageSize: 4,
    visibleColumnCount: 2,
    serverPageGameIdsByPage: {
      0: ["a", "b", "c", "d"],
      1: ["e", "f", "g", "h"],
    },
  };
  const loadCalls = [];
  const setCalls = [];
  const syncResponsiveHomeSectionPageSizes = createSyncResponsiveHomeSectionPageSizes(
    () => ["my"],
    () => section,
    () => 1,
    () => 3,
    () => 4,
    () => null,
    (...args) => setCalls.push(args),
    async (...args) => {
      loadCalls.push(args);
    },
  );

  const updated = await syncResponsiveHomeSectionPageSizes();

  assert.equal(updated, true);
  assert.deepEqual(setCalls, []);
  assert.equal(loadCalls.length, 1);
  assert.deepEqual(loadCalls[0], [
    "my",
    {
      page: 1,
      direction: "none",
      visiblePageSize: 3,
      visibleColumnCount: 1,
    },
  ]);
});

test("responsive home pagination avoids reload when 3-column and 1-column modes both use 3 visible cards", async () => {
  const totalPagesHelpers = extractSourceSegment("const getHomeSectionVisibleTotalPages", "const getHomeSectionSafePage");
  const { getHomeSectionVisibleTotalPages } = new Function(
    `${totalPagesHelpers}
    return { getHomeSectionVisibleTotalPages };`,
  )();
  const segment = extractSourceSegment("const syncResponsiveHomeSectionPageSizes = async () => {", "const syncHomeSections = async () => {");
  const createSyncResponsiveHomeSectionPageSizes = new Function(
    "getVisibleHomeSectionKeys",
    "getHomeSection",
    "getHomeSectionColumnCount",
    "getHomeSectionVisiblePageSize",
    "getHomeSectionVisibleTotalPages",
    "getHomeSectionCachedGameIndex",
    "getHomeSectionVisibleGameIdsFromCache",
    "setHomeSection",
    "loadHomeSectionPage",
    `${segment}
    return syncResponsiveHomeSectionPageSizes;`,
  );

  const section = {
    page: 1,
    totalGames: 8,
    totalPages: 3,
    gameIds: ["d", "e", "f"],
    visiblePageSize: 3,
    visibleColumnCount: 3,
    serverPageGameIdsByPage: {
      0: ["a", "b", "c", "d"],
      1: ["e", "f", "g", "h"],
    },
  };
  const loadCalls = [];
  const setCalls = [];
  const syncResponsiveHomeSectionPageSizes = createSyncResponsiveHomeSectionPageSizes(
    () => ["my"],
    () => section,
    () => 1,
    () => 3,
    getHomeSectionVisibleTotalPages,
    () => 3,
    (_section, { page, visiblePageSize }) => {
      if (page === 1 && visiblePageSize === 3) {
        return ["d", "e", "f"];
      }
      return null;
    },
    (...args) => setCalls.push(args),
    async (...args) => {
      loadCalls.push(args);
    },
  );

  const updated = await syncResponsiveHomeSectionPageSizes();

  assert.equal(updated, true);
  assert.deepEqual(loadCalls, []);
  assert.equal(setCalls.length, 1);
  assert.deepEqual(setCalls[0], [
    "my",
    {
      ...section,
      page: 1,
      totalPages: 3,
      gameIds: ["d", "e", "f"],
      visibleColumnCount: 1,
    },
  ]);
});
