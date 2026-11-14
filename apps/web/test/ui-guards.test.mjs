import {destinationLiveGameId} from '../shell/destination-route-owner.js';
import {scrollHomeSectionIntoView} from '../shell/home-section-reads.js';
import {HOME_SECTION_SERVER_PAGE_SIZE,HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT,HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE,createHomeSectionReads,createHomeSectionState,homeSectionVisiblePageSize,getHomeSectionVisibleGameIdsFromCache,homeSectionIsEmpty} from '../shell/home-section-reads.js';
import {historyRenderingFixture} from './support/history-rendering-context.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {renderSummarySlots,renderHistorySlots} from '../shell/panel-loading.js';

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

test("opponent introduction waits for session readiness and respects a cancelled continuation", async () => {
  const handler = extractSourceSegment("  if (action === 'opponent-story')", '  if (action === "create-game" ||');
  for (const allowed of [true, false]) {
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const events = [];
    const context = { waitForAccountGate: () => ready,
      gameSound: { play: cue => events.push(cue) },
      storyDialog: { open: opponent => events.push(opponent) },
      prepareOpponent: (mode, opponent) => events.push(`${mode}:${opponent}`),
      actionEl: { dataset: { opponent: 'babs' } } };
    runInNewContext(`globalThis.open = async () => { const action = 'opponent-story'; ${handler} };`, context);
    const opening = context.open();
    await Promise.resolve();
    assert.deepEqual(events, [], "no sound, dialog or preparation before readiness");
    release(allowed);
    await opening;
    assert.deepEqual(events, allowed ? ['intro', 'babs', 'intro:babs'] : []);
  }
});

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
  assert.match(extractSourceSegment('const renderHistoryPanel =','const renderBoardPanel ='), /return renderHistorySlots\(\{rows:historyRows/);
  const summary=renderSummarySlots({title:'Game',started:'Started',role:'Role',turn:'Turn',latest:'Latest'});
  assert.match(summary, /class="section-stack"/);
  assert.match(summary, /<div class="section-followup"><p class="small"[^>]*>Turn<\/p><p class="small">Latest<\/p>/);
  assert.match(renderHistorySlots({rows:'<li>Move</li>'}), /<div class="section-followup"><ol class="history-list"[^>]*><li>Move<\/li><\/ol>/);
  const returned=historyRenderingFixture().renderTurnHistory({id:'return-live',inHistoryMode:true,moves:[]});
  assert.match(returned, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
});

test("history live-return control stays mounted without blocking through the global busy gate", () => {
  const returned=historyRenderingFixture().renderTurnHistory({id:'return-live',inHistoryMode:true,moves:[]});
  assert.match(returned, /history-empty-line history-return-live"><button class="secondary" data-action="return-live"/);
  const blocked=historyRenderingFixture({busy:true}).renderTurnHistory({id:'return-live',inHistoryMode:true,sharedMutationsBlocked:true,moves:[]});
  const control=blocked.match(/<button class="secondary" data-action="return-live"[^>]*>/)?.[0];
  assert.ok(control,'Return to live must be present while shared mutations are blocked');
  assert.doesNotMatch(control,/\bdisabled\b|aria-disabled="true"/);
  assert.match(syncStoreSource, /selectHistoryMove: \(\{ gameId, moveIndex, moveId = null \}\) => operationManager.createCommitted/);
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
  assert.match(source, /if \(read\.route\.name === "game"\) \{\s*resolvedInvite = null;\s*await read\.owner\.loadGame\(read\.route\.gameId, \{ openAsViewer: false, positionFirst: true \}\);\s*\}/s);
  assert.match(source, /const initialRender = async \(\) => \{[\s\S]*?routeHydrated = false;\s*render\(\{ animatePanels: false, includeBoard: false \}\);[\s\S]*?await account\.start\(\);/s);
  assert.match(source, /startRouteSync\(\{ renderStart: false \}\);/);
});

test("game route live sync connection is not gated by participant role", () => {
  for(const myRole of [null,'Viewer','Player 1']){
    const transport={getGameViewModel:()=>({id:'g',myRole})};
    assert.equal(destinationLiveGameId({route:{name:'game',gameId:'g'},transport,presentation:{kind:'auth'}}),'g');
  }
  assert.equal(destinationLiveGameId({route:{name:'game',gameId:'g'},transport:{getGameViewModel:()=>null},presentation:{kind:'missing'}}),null);
  assert.equal(destinationLiveGameId({route:{name:'game',gameId:'g'},transport:{getGameViewModel:()=>null},presentation:{kind:'retry'}}),'g');
  assert.match(source, /syncStore\.setActiveGameId\(routeGameId \|\| null\);/);
  assert.match(syncStoreSource, /const getLocalFailureMessage = \(game\) =>/);
  assert.match(syncStoreSource, /const isFailedLocalStub = \(game\) =>/);
  assert.match(syncStoreSource, /const activeGame =/);
  assert.match(syncStoreSource, /const desiredGameIds =[\s\S]*isFailedLocalStub\(activeGame\)/);
  assert.match(syncStoreSource, /liveSync\.disconnectGame\(gameId\);/);
  assert.match(syncStoreSource, /liveSync\.connectGame\(gameId\);/);
});

test("optimistic game creation and history branch actions bypass the blocking busy wrapper", () => {
  assert.match(source, /if \(action === "create-game" \|\| action === 'create-self-play'\) \{[\s\S]*storyDialog\.open\('friend'[\s\S]*const handle = transport\.createGame\(\{ selfPlayMode: action === 'create-self-play' \}\);/s);
  assert.match(source, /startGameEntryRouteTransition\(handle\.result\.id, "home"\);/);
  assert.match(source, /navigateTo\(buildGameHash\(handle\.result\.id, null, getCurrentFlyoutState\(\)\)\);/);
  assert.match(source, /const branchDialog = createRematchDialog\([\s\S]*const handle = transport\.launchHistoryBranch\(/s);
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
  assert.match(source, /if \(action === "revert-to-move" \|\| action === "undo-last-move"\) \{[\s\S]*undoTransport\.requestRevertToMove\(\{ gameId, targetMoveId \}\);/s);
  assert.doesNotMatch(source, /if \(action === "accept-revert-request"\) \{[\s\S]*await transport\.approveRevertRequest/s);
  assert.doesNotMatch(source, /if \(action === "revert-to-move" \|\| action === "undo-last-move"\) \{[\s\S]*await undoTransport\.requestRevertToMove/s);
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
  assert.match(source, /pendingKey:copyInviteButtonKey,disabled:!game.canInvite/);
  assert.match(source, /if \(action === "join-viewer" \|\| action === "accept-invite-viewer"\) \{[\s\S]*withPendingButton\(getJoinButtonKey\("viewer", gameId\), async \(\) => \{/s);
  assert.match(source, /if \(action === "join-player" \|\| action === "accept-invite-player"\) \{[\s\S]*withPendingButton\(getJoinButtonKey\("player", gameId\), async \(\) => \{/s);
  assert.match(source, /if \(action === "approve-request" \|\| action === "accept-request"\) \{[\s\S]*withPendingButton\(getApproveRequestButtonKey\(gameId, requester\), async \(\) => \{/s);
  assert.match(source, /withPendingButton\(getCopyInviteButtonKey\(gameId\),\(\)=>copyGameInvitation/);
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
  assert.equal(HOME_SECTION_SERVER_PAGE_SIZE,4);
  assert.equal(HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT,3);
  assert.equal(HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE,4);
  assert.match(source, /const HOME_SECTION_CARD_MIN_WIDTH_REM = 22;/);
  assert.match(source, /const HOME_SECTION_CARD_GAP_REM = 0\.85;/);
  assert.match(source, /let homeSections = \{/);
  assert.match(source, /my: createHomeSectionState\("My games"\),/);
  assert.match(source, /other: createHomeSectionState\("Other games"\),/);
  assert.match(source, /smoke: createHomeSectionState\("Deploy smoke player"\),/);
  const initial=createHomeSectionState('My games');
  assert.equal(initial.serverPage,0);assert.equal(initial.serverTotalPages,0);
  assert.deepEqual(initial.serverPageGameIds,[]);assert.deepEqual(initial.serverPageGameIdsByPage,{});
  assert.equal(initial.visiblePageSize,3);assert.equal(initial.visibleColumnCount,1);
  assert.match(source, /const getVisibleHomeSectionKeys = \(route = currentRoute\) => \(route\?\.debug \? \["my", "completed", "other", "smoke"\] : \["my", "completed", "other"\]\);/);
  assert.match(source, /const getHomeSectionCardMinWidthPx = \(\) => getRootFontSizePx\(\) \* HOME_SECTION_CARD_MIN_WIDTH_REM;/);
  assert.match(source, /const getHomeSectionCardGapPx = \(\) => getRootFontSizePx\(\) \* HOME_SECTION_CARD_GAP_REM;/);
  assert.match(source, /const carouselEl = appEl\?\.querySelector\?\.\(`\[data-home-carousel="\$\{sectionKey\}"\]`\);/);
  assert.match(source, /return carouselEl\.getBoundingClientRect\(\)\.width;/);
  assert.match(source, /const styles = window\.getComputedStyle\(sectionEl\);/);
  assert.match(source, /return Math\.max\(0, sectionEl\.clientWidth - paddingLeft - paddingRight\);/);
  assert.match(source, /const getHomeSectionColumnCount = \(sectionKey\) => \{/);
  assert.match(source, /Math\.max\(1, Math\.floor\(\(sectionWidth \+ gapWidth\) \/ \(cardWidth \+ gapWidth\)\)\)/);
  assert.equal(homeSectionVisiblePageSize(3),3);
  assert.equal(homeSectionVisiblePageSize(2),4);
  assert.equal(homeSectionVisiblePageSize(1),3);
  assert.match(source, /data-action="home-page-prev"/);
  assert.match(source, /data-action="home-page-next"/);
  assert.match(source, /data-home-section="\$\{escapeHtml\(sectionKey\)\}"/);
  assert.match(source, /data-home-section-root="\$\{escapeHtml\(sectionKey\)\}"/);
  assert.match(source, /const renderHomeSectionControls = \(sectionKey, section, \{ placement \} = \{ placement: "header" \}\) =>/);
  assert.match(source, /const renderHomeStartButton = \(\) =>/);
  assert.match(source, /data-action="create-game"/);
  assert.match(source, /home-games-section-controls home-games-section-controls-\$\{escapeHtml\(placement\)\}/);
  assert.equal(homeSectionIsEmpty({totalGames:0},[{}]),true);
  assert.equal(homeSectionIsEmpty({totalGames:1},[]),true);
  assert.equal(homeSectionIsEmpty({totalGames:1},[{}]),false);
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
  assert.match(source, /<div class="home-games-carousel" data-home-carousel="\$\{escapeHtml\(sectionKey\)\}">/);
  assert.match(source, /getVisibleHomeSectionKeys\(\)\.filter\(key=>key!=='my'\)\.map\(renderHomeGameSection\)\.join\(''\)/);
  assert.match(source, /<section class="panel home-games-section" data-loading-context-group data-home-section-root="\$\{escapeHtml\(sectionKey\)\}">/);
  assert.match(source, /<h2>\$\{sectionKey === "my" \? "Continue playing" : escapeHtml\(section\.title\)\}<\/h2>/);
  assert.match(source, /<div class="mini-board-card-list" data-game-count="\$\{games\.length\}">/);
  assert.doesNotMatch(source, /class="panel home-start-panel"/);
  assert.doesNotMatch(source, /<h2>Active Games<\/h2>/);
  assert.doesNotMatch(source, /<h2>Preview Board/);
});

test("home visible page size maps 3/2/1 columns to 3/4/3 cards", () => {
  assert.equal(homeSectionVisiblePageSize(3),3);
  assert.equal(homeSectionVisiblePageSize(2),4);
  assert.equal(homeSectionVisiblePageSize(1),3);
});

test("home visible game cache stitches 4-item server pages into 3-item single-column pages", () => {
 const section={totalGames:7,page:0,visiblePageSize:3,serverPageGameIdsByPage:{0:['a','b','c','d'],1:['e','f','g']}};
 assert.deepEqual(getHomeSectionVisibleGameIdsFromCache(section,{page:0,visiblePageSize:3}),['a','b','c']);
 assert.deepEqual(getHomeSectionVisibleGameIdsFromCache(section,{page:1,visiblePageSize:3}),['d','e','f']);
 assert.deepEqual(getHomeSectionVisibleGameIdsFromCache(section,{page:2,visiblePageSize:3}),['g']);
});

for(const initialSize of [4,3])test(initialSize===4
 ? "responsive home pagination reanchors from 2-column pages to 1-column pages using the leading visible game"
 : "responsive home pagination avoids reload when 3-column and 1-column modes both use 3 visible cards",async()=>{
 const original={...createHomeSectionState('My games'),page:1,totalGames:8,totalPages:initialSize===4?2:3,
  gameIds:initialSize===4?['e','f','g','h']:['d','e','f'],visiblePageSize:initialSize,visibleColumnCount:initialSize===4?2:3,
  serverPageGameIdsByPage:{0:['a','b','c','d'],1:['e','f','g','h']}};
 let section=original;const publications=[],requests=[];
 const owner={getHomeListRevision:()=>null,loadGamesPage:options=>{requests.push(options);assert.fail('All required pages are already cached');}};
 const read={owner,homeDebug:false};
 const state={homeSections:{my:section},homeReadVisit:1};
 const controller=createHomeSectionReads({state,getVisibleHomeSectionKeys:()=>['my'],getHomeSection:()=>section,
 setHomeSection:(key,value)=>{section=value;publications.push([key,value]);},getHomeSectionColumnCount:()=>1,getHomeSectionVisiblePageSize:()=>3,
 captureRouteRead:()=>read,assertCurrentRouteRead:value=>assert.equal(value,read),gameSound:{play(){}},
 });
 assert.equal(await controller.syncResponsive(),true);assert.equal(requests.length,0);assert.equal(publications.length,1);
 assert.equal(section.page,1);assert.equal(section.totalPages,3);assert.equal(section.visiblePageSize,3);assert.equal(section.visibleColumnCount,1);
 assert.deepEqual(section.gameIds,['d','e','f']);
 if(initialSize===3)assert.deepEqual(publications[0],['my',{...original,page:1,totalPages:3,gameIds:['d','e','f'],visibleColumnCount:1}]);
});

test('Home section scrolling uses the native reduced-motion choice and refuses wide or missing destinations',()=>{
 class Element{};
 for(const reduced of [false,true]){
  const calls=[],section=new Element();section.scrollIntoView=options=>calls.push(options);
  const appEl=new Element();appEl.querySelector=()=>section;
  scrollHomeSectionIntoView({getShellLayoutMode:()=> 'narrow',appEl,HTMLElement:Element,prefersReducedMotion:()=>reduced},'my');
  assert.deepEqual(calls,[{behavior:reduced?'instant':'smooth',block:'start'}]);
  scrollHomeSectionIntoView({getShellLayoutMode:()=> 'wide',appEl,HTMLElement:Element,prefersReducedMotion:()=>reduced},'my');assert.equal(calls.length,1);
  appEl.querySelector=()=>null;scrollHomeSectionIntoView({getShellLayoutMode:()=> 'narrow',appEl,HTMLElement:Element,prefersReducedMotion:()=>reduced},'my');assert.equal(calls.length,1);
 }
});
