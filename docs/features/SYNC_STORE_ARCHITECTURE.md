# Sync Store Architecture Plan

## Context

Righelt's client currently has two active stores (`createLiveTransportStore` + `createLiveSyncClient`) and a dead one (`createShellStore`). The orchestrator `app.js` manually glues transport and WebSocket layers together, manages online/offline transitions across both, and routes different code paths for local vs live games. A global `busy` flag in `app.js` disables **all** buttons during **any** async operation, making the UI feel sluggish for operations like game creation, invites, join flows, history branching, scenario imports, and revert requests.

The goal is to unify all client-server communication behind a single **sync store** that:

- Acts as the sole proxy for all client-server communication
- Returns immediate optimistic results + operation status (pending/committed/failed) + a commitment promise
- Handles retries internally; only surfaces failures after exhaustion
- Makes pending vs committed a styling-only concern (lighter opacity / pulsing, but fully interactable)
- Supports full offline operation for anything not involving another player
- Provides a "reset to previous state" + alert banner on unrecoverable failure
- **Eliminates the global `busy` flag** — operations return immediately, so the UI is never blocked

## Branch implementation status (`codex/client-local-sync-store`)

This document started as a forward-looking implementation plan. The branch now contains a substantial partial implementation, so this section records what has already landed here versus what still remains.

### Completed on this branch

- **Phase 1 complete**: `createSyncStore()` is the active facade used by `app.js`, and it owns the live-sync/WebSocket coordination that used to be wired in the app layer.
- **Phase 2 complete for the core optimistic command path**: `OperationHandle` and `operation-manager.js` back move and end-turn flows, and `shell-host.js` adapts to handle-backed results.
- **Phase 3 complete**: optimistic client-generated IDs are implemented for create-game and history-branch flows, including stable route/API/request/response ID contracts and queueing of follow-up commands until creation commits.
- **Phase 4 complete**: revert request / approve / reject / rescind flows now use optimistic local prediction through the sync store, including client-generated revert request ids, rollback on failure, and browser coverage for both auto-approve and approval-required cases.
- **Phase 5 complete**: localized pulsing pending-button behavior now covers join-viewer, join-player, accept-invite variants, approve-request, play-as-both-players, and pending-game invite copy without blocking the rest of the shell UI.
- **Phase 6 partially complete**: the global `busy` gate has been bypassed for create-game, history-branch, revert actions, and the localized pending-button operations that now own their own in-place loading state.
- **Phase 7 complete**: pending history rows now remain clickable while visually pending, and the history UI exposes localized busy state instead of disabling interaction through the global shell lock.
- **Phase 8 partially complete**: failed optimistic create-game flows now surface an alert-style banner and preserve a failed local stub instead of collapsing into a broken route.
- **Phase 9 complete**: history jump and return-to-live now project locally first and reconcile with the server in the background, including latching history selection while live updates append underneath.
- **Testing hardening complete for implemented phases**: the branch adds unit, integration, and E2E contract coverage for optimistic game IDs, optimistic revert flows, localized pending controls, history branching, and local-first history navigation so these behaviors are no longer dependent on manual verification.

### Still remaining

- **Phase 6 not complete**: the app still has a broader `busy` architecture and does not yet implement the full pulsing-button / skeleton system across all remaining operations.
- **Phase 8 not complete**: failed-operation UX is still split between newer failure handling and older `rollbackNotice` behavior; there is not yet a single unified failed-operation banner/reset flow for all operation types.
- **Phase 10 not started**: `live-sync.js` still exists as a distinct module rather than being fully absorbed into `sync-store.js`.
- **Phase 11 not started**: dead store cleanup and final simplification have not happened yet.
- **Phase 12 deferred**: offline support has not been reintroduced.

### Current practical milestone

The branch has delivered the sync-store foundation plus the two highest-value optimistic workflows:

- optimistic creation / branching with stable client-generated IDs
- optimistic revert flows with rollback-safe local prediction
- local-first history navigation with clickable pending history rows

The next biggest remaining product milestone is to finish removing the global `busy` architecture for the remaining non-optimistic actions and replace it with localized pulsing/skeleton states.

---

## Recent codebase changes to account for

### Offline mode removed (commit 1686f2f — "Remove incomplete offline mode implementation")

This is a **major simplification** that removes ~625 lines from live-transport.js. The app is now purely online-first with no local fallback. Removed:

- **All offline state**: `offline` flag, `offlinePendingByGameId`, `persistenceWarningCode`, `OFFLINE_PROGRESS_WARNING`
- **All local game support**: `createLocalGame()`, `createLocalGameId()`, `decorateLocalGame()`, `goOnlineGame()`
- **All offline policy helpers**: `isLocallyPlayableGame()`, `shouldUseLocalOfflineExecution()`, `canReplayOfflineMutations()`, `shouldPersistOfflineGame()`, `canLocallyEndTurn()`
- **Offline persistence**: `persistLocalState()`, `flushOfflineQueue()`, `buildPromotionScenario()`, `removeGame()`
- **Public API methods removed**: `setOffline()`, `goOnlineGame()`, `refreshGames()`
- **Service worker**: `offline-sw.js` and `offline/bootstrap.js` deleted
- **DB**: `offline_local` column dropped from `live_games` table
- **UI actions removed**: `create-offline-playground`, `toggle-offline`
- **`createGame()` simplified**: now takes only `{ selfPlayMode }` (no `offlineLocal`, `playgroundMode` renamed)

**What remains**: `persistence.js` still has `loadLiveTransportState()`/`saveLiveTransportState()` but they are currently unused.

**Impact on the plan**: The offline-first requirement in the original goals ("any operation that does not involve another player should run fully offline") will need to be **re-implemented** as part of the sync store, rather than preserved from existing code. The sync store will be the place where offline support is properly built — using the game engine for local execution, `persistence.js` for storage, and the operation manager for queuing.

### New DB migration: home page pagination metadata (0008)
Rebuilds `live_games` table schema with denormalized player identity columns and optimized indexes for home section queries. `loadGamesPage()` in transport uses this.

### Shared constants and validation consolidation
- `MAX_HISTORY` moved to `packages/shared-types/src/history.ts` (shared across web + api)
- `isUuidV4()` moved to `packages/shared-types/src/validation.js` (shared across scenarios.js + api)
- `persistence.js` storage keys are now exported (was internal constants) — useful for test access
- History renumbering and `displayMoveNumber` logic refined in `shell-live-core.ts`

### Playground surface removed (PR #54 — "Remove deprecated playground surface")

The standalone playground mode was removed and renamed to **self-play**:

- **`playgroundMode` → `selfPlayMode`** throughout: `live-transport.js` (`createGame({ selfPlayMode })`), `store.js`, `shell-live-core.ts` (`LiveGame.selfPlayMode`), `game-room-do.ts` (accepts both for backwards compat)
- **`playground-host.js` deleted** — all board interactions now exclusively through `shell-host.js`
- **`engine-playground-adapter.js` → `engine-board-adapter.js`** — same contract, only naming changed
- **`store.js` adds `normalizeGame()`** — migrates legacy `playgroundMode` to `selfPlayMode` in stored games
- **`game-room-do.ts`** accepts both `selfPlayMode` and legacy `playgroundMode` in request bodies for backwards compat
- **`docs/SHELL_PORTABILITY.md`** (new) — documents shell architecture, adapter surfaces, and live authority responsibilities including self-play seat ownership
- **Test file changes**: `playground.test.mjs` → `self-play.test.mjs` (expanded), `playground-host.test.mjs` deleted, `e2e-flow.test.mjs` and `route-contracts.test.mjs` deleted, self-play regression coverage added

**Impact on the plan**: References to `playgroundMode` throughout should use `selfPlayMode`. The single board host path (`shell-host.js`) simplifies Phase 2's adaptation. Self-play is now explicitly a game state mode, not a separate surface.

### Optimistic turn settlement parity (PR #60 — "Fix optimistic live turn settlement parity")

Turn finalization logic extracted into shared helper `finalizeResolvedTurn()` in `packages/shared-types/src/shell-live-turn.js` (50 lines), used by both:
- **Client**: `optimistic-live.js` (now 220 lines, down from ~250 after extraction)
- **Server**: `shell-live-core.ts`

Additional helpers exported from `shell-live-turn.js`: `getNextSeat()`, `getSideForSeat()`, `getControlSeatForTurn()`, `clearTransientTurnFlags()`, `buildNextTurn()`.

New test coverage in `live-transport.test.mjs` (~227 new lines): verifies optimistic turn-ending actions settle turns immediately and match server state across normal and branched-history scenarios.

**Impact on the plan**: The sync store does **not** need to reimplement turn settlement — `optimistic-live.js` handles it via the shared helper, and the sync store delegates to it. The `commandResults` map returned by `projectOptimisticGame()` is the mechanism for per-command status, which aligns with the OperationHandle pattern.

### Rush/push supply and rush blocker previews (PR #61)

Game engine changes for rush/push continuation supply resolution. Board runtime now shows rush blocker preview chips. New `selection-hydration.js` (32 lines) guards against replaying stale selection actions when games are branched or reopened.

**Impact on the plan**: These are board-runtime and engine-level changes. The sync store is unaffected — it propagates game state including `continuation` fields, and the board runtime handles rendering. `selection-hydration.js` is consumed by `app.js` and is independent of the sync store.

### CI parallelization (PR #59)

CI checks split into parallel lanes with JUnit output. No impact on the sync store.

### Other recent changes
- **Panel swipe navigation** (app.js) — narrow-screen touch swipe between game panels. Pure local state, Tier 1.
- **Narrow header menu** (app.js) — hamburger menu for Scenarios/Debug. Pure local state, Tier 1.
- **`runtime-sync.js`** (73 lines) — board selection reset logic, consumed by app.js, unaffected by sync store.
- **`selection-hydration.js`** (32 lines) — one-shot selection replay guard per game, consumed by app.js, independent of sync store.
- **`shell-host.test.mjs`** (291 lines) — contract tests for shell-host.js. Must pass after Phase 2.
- **Rush/push continuation highlighting** — board-runtime.js changes to overlay phases, rush blocker chip, coordinate coloring. Unaffected.
- **New test files**: `history.test.mjs`, `scenario-export.test.mjs` (expanded), `ci-workflow.test.mjs`, `self-play.test.mjs`, `selection-hydration.test.mjs`

### Current file sizes
- `live-transport.js`: **~839 lines** (down from ~1420 after offline removal)
- `app.js`: **~4033 lines**
- `live-sync.js`: ~416 lines (unchanged)
- `optimistic-live.js`: **~220 lines** (down from ~250 after turn settlement extraction)
- `shell-host.js`: ~88 lines (unchanged, now sole board host after playground-host.js deletion)
- `persistence.js`: ~41 lines (keys now exported)
- `store.js`: ~432 lines (dead code, now includes `normalizeGame()` for legacy migration)
- `selection-hydration.js`: ~32 lines (new — one-shot selection replay guard)
- `shell-live-turn.js` (shared-types): ~50 lines (new — shared turn settlement helpers)

---

## Comprehensive operation classification

Every user-initiated operation in the app, classified by how the sync store should handle it. This table drives the design of all subsequent phases.

### Tier 1: Instant (local-only, no server round-trip)

These return a **committed** `OperationHandle` synchronously. No pulsing, no loading.

| Operation | Action in app.js | Current behavior | Why instant |
|-----------|-----------------|------------------|-------------|
| History jump | `jump-history` (3676) | Async POST to server | All snapshots already client-side; server sync is fire-and-forget |
| Return to live | `return-live` (3689) | Async POST to server | Same as above |
| Toggle undone group | `toggle-undone-group` (3652) | Local state toggle | Pure local UI state |
| Toggle header menu | `toggle-header-menu` (3440) | Local | Pure local UI state |
| Open/close debug | `open-debug`/`close-debug` (3449/3468) | Local | Pure local UI state (route sync is fire-and-forget) |
| Open/close scenarios | `open-scenarios`/`close-scenarios` (3461/3481) | Local | Pure local UI state |
| Switch game panel | `switch-game-panel` (3490) | Local | Pure local UI state |
| Tutorial next/skip | `tutorial-next`/`tutorial-skip` (3738) | Local | Client-side tutorial controller, no server |
| Tutorial complete | `tutorial-complete` (3743) | Local + navigate | localStorage save + navigate |
| Ignore join request | `ignore-request` (3614) | Local | Hides request in local UI only |
| Save/update scenario | `save-scenario`/`update-scenario` (3785) | Local | Writes to local JSON, no server |
| Copy invite (committed game) | `copy-invite` (3664) | Clipboard API | Direct clipboard write, no server |
| Switch game panel | `switch-game-panel` (3498) | Route hash change | Pure local panel navigation (narrow screen) |
| Panel swipe | touch gesture (3996-4052) | Route hash change | Pure local touch-driven panel navigation |

### Tier 2: Optimistic with client-generated IDs (instant UI, background commit)

These return a **pending** `OperationHandle` synchronously. The UI renders immediately with the optimistic result. Server commit happens in background. URL is stable because the client generates the ID.

| Operation | Action in app.js | Current behavior | New behavior |
|-----------|-----------------|------------------|-------------|
| Create game | `create-game` (3502) | Blocks UI ~200-500ms waiting for server | Client generates `game-{hex}` ID, creates local stub with initial board state, navigates instantly. Server POST in background. |
| Launch history branch | `launch-history-branch` (3700) | Blocks UI, opens new tab after server responds | Client generates new game ID, builds scenario from history locally (`buildHistoryBranchSeedFromGame`), opens new tab immediately with the ID. Server creates game in background via `POST /api/shell/history/branch`. |
| Live game moves | board interaction | Optimistic (already) | Same optimistic pattern, now wrapped in OperationHandle |
| End turn | board interaction | Optimistic (already) | Same, wrapped in OperationHandle |

### Tier 3: Optimistic with local state prediction (instant UI, server confirms)

These return a **pending** `OperationHandle` synchronously. The local state is updated optimistically to show the predicted result. Server confirms or rolls back.

| Operation | Action in app.js | Current behavior | New behavior |
|-----------|-----------------|------------------|-------------|
| Revert request | `revert-to-move`/`undo-last-move` (3727) | Blocks UI | Optimistically set `game.pendingRevertRequest` locally. Server confirms. |
| Rescind revert | `rescind-revert-request` (3643) | Blocks UI | Optimistically clear `game.pendingRevertRequest` locally. Server confirms. |
| Approve revert | `accept-revert-request` (3623) | Blocks UI | Optimistically apply revert to local game state. Server confirms. |
| Reject revert | `reject-revert-request` (3633) | Blocks UI | Optimistically clear `game.pendingRevertRequest` locally. Server confirms. |

### Tier 4: Pulsing button (server required, localized pending state)

These return `Promise<OperationHandle>`. The clicked button shows a **pulsing** animation. Other UI remains fully interactive.

| Operation | Action in app.js | Current behavior | New behavior |
|-----------|-----------------|------------------|-------------|
| Join as viewer | `join-viewer`/`accept-invite-viewer` (3557) | Blocks all UI | Join button pulses; rest interactive. Resolves when server confirms. |
| Join as player | `join-player`/`accept-invite-player` (3575) | Blocks all UI | Join button pulses; rest interactive. May show "Pending approval" feedback. |
| Play as both | `play-as-both-players` (3596) | Blocks all UI | Button pulses; rest interactive. |
| Approve join request | `approve-request` (3604) | Blocks all UI | Approve button pulses; rest interactive. |
| Copy invite (pending game) | `copy-invite` (3664) | N/A (button disabled) | Invite button pulses "Creating invite..."; awaits `handle.committed`; copies link. |

### Tier 5: Loading skeletons (server required, view-level loading)

These load an entire view that depends on server data. Show **pulsing loading skeletons** matching the expected content layout.

| Operation | Trigger | Current behavior | New behavior |
|-----------|---------|------------------|-------------|
| Resolve invite | Route navigation to `#/invite/{token}` | Blocks entire UI with busy state | Invite page shows skeleton layout (board placeholder, player info blocks, action button placeholders) with pulsing animation. Header/navigation remain interactive. |
| Load game | Route navigation to `#/game/{id}` | Blocks entire UI | Game view shows skeleton layout (board area, history sidebar, player panels) with pulsing animation. Header remains interactive. |
| Scenario import | `load-scenario` (3751) | Blocks UI | Scenario panel shows pulsing placeholder. Board stays visible with current state. Once server responds, board transitions to new state. |
| Home page pagination | `home-page-prev`/`home-page-next` (3508) | Blocks UI | Game list section shows skeleton rows (matching card layout) with pulsing. Other sections and header remain interactive. |

---

## Phase 1: Create sync-store facade (no behavior change)

**Status on this branch:** Completed

Wrap existing `createLiveTransportStore` + `createLiveSyncClient` into a single `createSyncStore()` that absorbs all glue code currently in `app.js`.

### Files

| Action | File | What changes |
|--------|------|-------------|
| Create | `apps/web/shell/sync-store.js` | Facade that internally creates transport + liveSync, wires `onEvent`/`onStatus`/`onMetric` callbacks, manages online/offline transitions |
| Modify | `apps/web/shell/app.js` | Replace `transport` + `liveSync` imports with single `syncStore` import. Remove lines ~3162-3250 (syncLiveChannels, liveSync creation, WS callback wiring) and lines ~3312-3328 (online/offline handlers). Replace `transport.*` calls with `syncStore.*` (mechanical rename). Replace `syncLiveChannels()` with `syncStore.setActiveGameId(routeGameId)` |

### Key details

- `sync-store.js` exposes the same method signatures as `transport` today, so the `app.js` change is a pure rename
- `setActiveGameId(gameId)` replaces `syncLiveChannels()` — the sync store internally manages which WebSocket connections are open
- Browser `online`/`offline` event listeners move inside the sync store (currently `app.js` uses `navigator.onLine` to gate WS connections via `shouldDisableLiveSync()`)
- The sync store listens to WS events internally and calls `transport.applyLiveGameUpdate()` itself (absorbing `app.js:3200-3213`)
- The `runtime-sync.js` helpers (`shouldResetBoardSelection`, `shouldSkipBoardRuntimeReload`) are consumed directly by `app.js` and are not affected by the sync store facade
- Note: offline mode was recently removed from the codebase. The transport no longer has `setOffline()`, `goOnlineGame()`, or local game support. The sync store will eventually re-introduce offline capabilities (see Phase 12).

### Guard tests to update
- `ui-guards.test.mjs`: regex patterns referencing `transport\.loadGame`, `transport\.` methods → `syncStore\.`; syncLiveChannels regex → `syncStore.setActiveGameId`
- `shell-render-stability.test.mjs`: `activeLiveGameIds`, `desiredGameIds`, `liveSync.disconnectGame`, `liveSync.connectGame` patterns → point at `sync-store.js` source instead of `app.js`; `transport.` method patterns → `syncStore.`

### Verification
- **Unit tests**: `createSyncStore()` returns an object with the same method signatures as `transport`
- **Unit tests**: `setActiveGameId()` correctly manages WS connect/disconnect calls
- **Unit tests**: Online/offline transitions are handled internally (no external event listener needed)
- **Integration test**: All existing tests pass with syncStore swapped in
- **Integration test**: real API-backed sync-store tests prove optimistic route ids stay equal across request body, response body, local route id, and first follow-up mutation target
- **E2E test**: browser workflow verifies create-game route id equals the server response id and the first `/apply` request uses that same id
- **E2E test**: browser workflow verifies history-branch popup route id equals the server response id and the first branch `/apply` request uses that same id
- Manual testing may be used for exploratory confidence, but the verification gate for these contracts is automated

---

## Phase 2: Introduce OperationHandle + operation manager

**Status on this branch:** Completed for move/end-turn and reused by later optimistic flows

Add a promise-based operation lifecycle to ALL store operations.

### New concept: OperationHandle

```js
{
  id: string,                    // clientCommandId
  status: 'pending' | 'committed' | 'failed',  // mutates over time
  result: T,                     // optimistic result, available immediately
  committed: Promise<T>,         // resolves on server confirm, rejects on failure
  error: Error | null,           // populated when status === 'failed'
}
```

**Return patterns by tier (see operation classification above):**

| Tier | Return type | `status` on return | `committed` on return |
|------|------------|--------------------|-----------------------|
| 1 (Instant) | `OperationHandle` | `'committed'` | Already resolved |
| 2 (Client-generated ID) | `OperationHandle` | `'pending'` | Pending promise |
| 3 (Local prediction) | `OperationHandle` | `'pending'` | Pending promise |
| 4 (Pulsing button) | `Promise<OperationHandle>` | `'pending'` when promise resolves | Pending promise |
| 5 (Loading skeleton) | `Promise<OperationHandle>` | `'committed'` when promise resolves | Already resolved |

### Files

| Action | File | What changes |
|--------|------|-------------|
| Create | `apps/web/shell/operation-manager.js` | `OperationRecord` with promise infrastructure. Methods: `enqueue()`, `confirm(id, finalResult)`, `fail(id, error)`, `dismiss(id)`, `getHandle(id)`, `getPendingOperations(gameId)`, `getFailedOperations(gameId)` |
| Modify | `apps/web/shell/sync-store.js` | Wire OperationManager into `applyGameAction()` and `endTurn()` first (Tier 2 operations). On enqueue: create record, return handle. On server confirm (HTTP response or WS `event_appended` with matching `clientCommandId`): call `confirm()`. On rollback/rejection: call `fail()`. |
| Modify | `apps/web/board/hosts/shell-host.js` | `applyAction()` and `endTurn()` adapt to OperationHandle — extract `.result` for the board runtime response (same shape as today) |

### Verification
- **Unit tests (operation-manager.js)**:
  - `enqueue()` creates a record with `status: 'pending'` and a pending `committed` promise
  - `confirm(id, result)` transitions status to `'committed'` and resolves the promise
  - `fail(id, error)` transitions status to `'failed'` and rejects the promise
  - `dismiss(id)` removes the record
  - `getPendingOperations(gameId)` returns only pending operations for that game
  - `getFailedOperations(gameId)` returns only failed operations
  - Handles created for local operations start as `'committed'` with resolved promise
- **Integration tests**:
  - `applyAction()` returns handle → mock server confirms → `handle.committed` resolves
  - `applyAction()` returns handle → mock server rejects → `handle.committed` rejects, status is `'failed'`
  - Board runtime receives same response shape as before (via shell-host.js adaptation)
  - All 7 existing `shell-host.test.mjs` tests pass (contract: shell-host prefers transport's canonical game view)
  - All existing `live-transport.test.mjs` tests pass (~1345 lines of coverage including optimistic handoff, turn settlement parity)
  - Client-generated-id workflows assert identifier stability end to end: request body id, response body id, local route id, and first follow-up mutation game id must all match
- **Manual test**: board interactions feel identical (optimistic result is same object)

---

## Phase 3: Optimistic game creation and history branching (client-generated IDs)

**Status on this branch:** Completed

Make game creation and history branching feel instant. The client generates game IDs upfront so URLs are stable.

### Why client-generated IDs work
- The server's `/create` endpoint in `game-room-do.ts:199-215` already accepts `gameId` from the request body and uses it directly (`const gameId = asIdentity(body.gameId)`)
- The server's `nextGameId()` in `shell-live-core.ts:151` is just `game-{random hex}` using `crypto.getRandomValues`
- The `game_id` column is `TEXT PRIMARY KEY` in the DB — collision is astronomically unlikely with 128+ bits of randomness
- No URL rewriting needed, no local→server ID swapping, no race conditions with moves referencing stale IDs

### ID format
All games now use `game-{hex}` format. The previous `local-{timestamp}-{random}` format and `offlineLocal` flag were removed along with offline mode. Client-generated IDs follow the same format as the server's `nextGameId()` in `shell-live-core.ts:151`.

### 3a: Optimistic game creation

**Current**: Click "Start new game" → `withBusy()` → all buttons disabled → POST `/api/shell/games` → wait → navigate

**New**: `syncStore.createGame()` synchronously generates `game-{hex}` ID, creates local game stub with initial board state (via game engine's `createInitialState()`), returns `OperationHandle` with `status: 'pending'`. `app.js` navigates to the game ID immediately. Server POST fires in background. Board is playable instantly.

### 3b: Optimistic history branching

**Current**: Click "Create new game at this move" → `withBusy()` → builds scenario seed from history locally (`buildHistoryBranchSeedFromGame` in `scenarios.js:195-228`) → POST `/api/shell/history/branch` → wait → open new tab

**New**: `syncStore.launchHistoryBranch()` synchronously generates new game ID, builds scenario seed locally (already client-side), returns `OperationHandle` with `status: 'pending'`. `app.js` opens new tab immediately with the new game ID. Server creates the game in background. When the new tab loads, the game is either already committed (fast server) or shows the optimistic local state (pending).

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/sync-store.js` | `createGame()` and `launchHistoryBranch()` generate game IDs client-side, create local stubs, return OperationHandle synchronously. Background HTTP POST commits. |
| Modify | `apps/web/shell/app.js` | `create-game` and `launch-history-branch` handlers: no `await`, use `handle.result.id` to navigate immediately. |
| Modify | `apps/web/shell/live-transport.js` | Add `createLocalGameStub({ gameId, identityId, selfPlayMode })` and `createLocalBranchStub({ gameId, scenario, identityId })` for local game state generation. |

### Edge cases
- **Server failure**: Game transitions to `failed`. Banner shows. User can dismiss and return to home.
- **Moves before commit**: Game ID is stable, so moves queue normally. Server processes them after game creation commits.
- **History branch tab**: If user loads the new tab before server commits, the new tab's sync store sees a pending game and renders the optimistic state. Once committed, it transitions seamlessly.

### Verification
- **Unit tests**: `createGame()` returns handle with valid game ID format `game-{hex}`, `status: 'pending'`, game stub with initial board
- **Unit tests**: `launchHistoryBranch()` returns handle with new game ID, scenario-derived initial state
- **Integration test**: create game → make moves before commit → server commits → moves applied
- **Integration test**: history branch → new game loads in new tab → server commits → game state matches
- **Automated contract tests now present on this branch**: request body id, response body id, local route id, and first follow-up mutation game id must all match for both create-game and history-branch workflows

---

## Phase 4: Optimistic revert operations (local state prediction)

**Status on this branch:** Completed

Make revert requests, approvals, rejections, and rescissions feel instant with local state prediction.

### Current behavior
All revert operations (`revert-to-move`, `accept-revert-request`, `reject-revert-request`, `rescind-revert-request`) block the entire UI via `withBusy()` while waiting for server round-trip.

### New behavior

| Operation | Optimistic local state change | Server call |
|-----------|------------------------------|-------------|
| Request revert (`revert-to-move`, `undo-last-move`) | Set `game.pendingRevertRequest` locally with the target move. Show the revert-pending UI immediately. | POST `/api/shell/games/{id}/revert-request` confirms in background. |
| Approve revert (`accept-revert-request`) | Apply revert to local game state (mark moves after target as `undone`, update board to target snapshot). | POST `/api/shell/games/{id}/revert-approve` confirms in background. |
| Reject revert (`reject-revert-request`) | Clear `game.pendingRevertRequest` locally. | POST `/api/shell/games/{id}/revert-reject` confirms in background. |
| Rescind revert (`rescind-revert-request`) | Clear `game.pendingRevertRequest` locally. | POST `/api/shell/games/{id}/revert-rescind` confirms in background. |

All return `OperationHandle` with `status: 'pending'`. If server rejects (e.g., opponent already rejected), the optimistic state rolls back and the handle transitions to `'failed'`.

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/sync-store.js` | `requestRevertToMove()`, `approveRevertRequest()`, `rejectRevertRequest()`, `rescindRevertRequest()` apply local state prediction, return pending OperationHandle, POST to server in background. |
| Modify | `apps/web/shell/live-transport.js` | Preserve client-generated revert request ids in transport requests; sync-store performs the local optimistic mutation. |
| Modify | `apps/web/shell/app.js` | Revert action handlers: no `await`, use handle.result for immediate UI update. Remove busy gating. |

### Verification
- **Unit tests**: Each revert operation returns pending handle with correct optimistic state
- **Unit tests**: Server rejection triggers rollback to pre-revert state
- **Integration tests now present on this branch**:
  - request revert with open seat → optimistic local revert uses client request id and committed game stays aligned
  - request revert with a second player present → pending request keeps the same client request id through server commit
- **E2E tests now present on this branch**:
  - undo-last-move applies optimistically before the delayed revert response returns
  - approval-required undo preserves the same client-generated revert request id in both the request payload and rendered controls

---

## Phase 5: Optimistic invite flow

**Status on this branch:** Not started

Make invites feel responsive while ensuring the clipboard gets a valid (committed) link.

### Current behavior
- Invite button exists on game view, copies a link using an `inviteToken` from the server response
- Gated by `busy` flag during game creation — can't invite until game is committed

### New behavior
1. Invite button is visible as soon as the game view renders (even for pending games)
2. If game is still `pending` (no committed invite token yet):
   - User clicks "Invite" → the invite button transitions to a **pulsing** "Creating invite..." state
   - Internally, `await handle.committed` to wait for the server to confirm (providing the invite token)
   - Once committed: copy the real invite link to clipboard → show "Invite link copied" feedback
   - The pulsing state resolves to the normal copied-feedback state
3. If game is already `committed`:
   - Clipboard copy is immediate as it is today

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/app.js` | `copy-invite` action: if game has no committed invite token yet, add `.button-pending` class (triggers pulse animation), `await syncStore.getGameHandle(gameId).committed`, then copy. Remove `.button-pending` after. |
| Modify | `apps/web/shell/sync-store.js` | Expose `getGameHandle(gameId)` to retrieve the active OperationHandle for a game. |

### Verification
- **Unit test**: `getGameHandle()` returns pending handle for uncommitted game, committed for committed
- **Integration test**: invite click on pending game → awaits committed → clipboard gets valid invite link
- **Manual test**: click invite on committed game → immediate clipboard copy
- **Manual test**: click invite on pending game → button pulses → clipboard copy when committed

---

## Phase 6: Eliminate the global `busy` flag + add pulsing/skeletons

**Status on this branch:** Partially complete

Remove the `busy` flag and `withBusy()` pattern from `app.js`. Replace with localized pending states.

### Pulsing animation and loading skeletons

All pending states use a consistent **subtle pulse animation** (CSS `@keyframes pulse` with opacity oscillation):

- **`.button-pending`**: Applied to buttons awaiting an operation. Shows the button text at reduced opacity with a gentle pulse. Button remains styled as a button (not grayed out), signaling "in progress" rather than "disabled."
- **`.skeleton-pulse`**: Applied to placeholder blocks for loading skeletons. Rectangular blocks matching the approximate size/position of the expected content. Uses a shimmer/pulse effect.
- Loading skeletons are used when an entire view section is waiting for data (invite resolution, initial game load, pagination). They preview the layout so the content transition feels seamless.

### Complete operation-to-UI mapping

**No loading state needed** (Tier 1 + 2 + 3 — operations return instantly):
- `create-game` → instant navigate, no busy
- `launch-history-branch` → instant new tab, no busy
- `jump-history`, `return-live` → instant, no busy
- All board moves / end turn → instant optimistic, no busy
- All revert operations → instant optimistic, no busy
- `toggle-header-menu`, `open/close-debug`, `open/close-scenarios`, `switch-game-panel` → instant, no busy
- `tutorial-next`, `tutorial-skip`, `tutorial-complete` → instant, no busy
- `ignore-request`, `toggle-undone-group` → instant, no busy
- `save-scenario`, `update-scenario` → instant local write, no busy
- `copy-invite` (committed game) → instant clipboard, no busy

Implemented so far on this branch:
- `create-game`
- `launch-history-branch`
- all revert operations

Still remaining on this branch:
- join/invite/player-request flows
- scenario import skeletons
- home pagination skeletons
- removing the remaining global `busy` plumbing entirely

**Pulsing button** (Tier 4 — specific button pulses, rest interactive):
- `join-viewer`, `join-player`, `accept-invite-viewer`, `accept-invite-player` → join button pulses
- `play-as-both-players` → button pulses
- `approve-request`, `accept-request` → approve button pulses
- `copy-invite` (pending game) → invite button pulses "Creating invite..."

**Loading skeletons** (Tier 5 — view-level pulsing placeholders):
- Route to `#/invite/{token}` → invite page skeleton (board placeholder, player info blocks, action button placeholders)
- Route to `#/game/{id}` (first load) → game view skeleton (board area, history sidebar, player panels)
- `load-scenario` (scenario import) → scenario panel shows pulsing placeholder; board stays with current state
- `home-page-prev`/`home-page-next` → game list section shows skeleton card rows; other sections stay

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/app.js` | Remove `let busy = false` (line 92). Remove `withBusy()` function (lines 3095-3110). Remove `shouldRenderBusyStateStart`/`shouldRenderBusyStateEnd` logic (lines 3367-3389). Replace the outer `withBusy()` wrapper (line 3447) with direct action handler calls. Remove all `${busy ? "disabled" : ""}` from button rendering. For Tier 4 operations: track per-operation pending state and apply `.button-pending`. For Tier 5 operations: render skeleton markup when data is loading. |
| Modify | `apps/web/shell/shell.css` | Add `@keyframes pulse` animation. Add `.button-pending` class. Add `.skeleton-pulse` class. Add skeleton layout rules for invite page, game view, home page cards, scenario panel. Keep `button:disabled` styling for semantic disabling only (game rules, not loading). |
| Modify | `apps/web/shell/app.js` | Add skeleton rendering functions: `renderGameViewSkeleton()`, `renderInvitePageSkeleton()`, `renderHomeCardSkeleton()`, `renderScenarioImportSkeleton()`. These produce HTML with `.skeleton-pulse` blocks positioned to match the real content layout. |

### What `busy ? "disabled" : ""` appears on currently (all to be removed)
- "Start new game" button (line 1782) → no longer blocked
- Invite copy button (line 1931) → localized pending if uncommitted
- Accept invite player/viewer buttons (lines 2572-2580) → localized pulsing on clicked button
- Various game action buttons → no longer blocked

### Verification
- **Unit tests**: Confirm `busy` flag is removed; no button rendering references it
- **Unit tests**: `.button-pending` class is applied/removed per operation lifecycle
- **Unit tests**: Skeleton markup renders correct structure for each view type
- **Integration test**: Multiple concurrent operations don't interfere
- **Manual test**: click "Start new game" → instant, zero disabled buttons
- **Manual test**: While game creation pending, all other buttons clickable
- **Manual test**: Join game → only join button pulses
- **Manual test**: Invite page load → skeleton matches layout → content replaces smoothly
- **Manual test**: Home pagination → card skeletons → cards appear
- **Manual test**: Scenario import → scenario panel pulses → board updates

---

## Phase 7: Pending/committed styling in history log

**Status on this branch:** Not started

Make pending moves visually distinct but fully interactable.

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/shell.css` | `.history-item.history-item-pending`: remove `cursor: default`, keep `opacity: 0.52`, remove `pointer-events: none`. Add subtle pulse to pending items. |
| Modify | `apps/web/shell/app.js` | Line ~1276: change `aria-disabled="true"` to `aria-busy="true"` on pending history items. Ensure click handler works (navigate to snapshot). |

### Verification
- **Unit test**: Pending history item markup uses `aria-busy="true"` not `aria-disabled="true"`
- **Unit test**: No `pointer-events: none` on pending items
- **Integration test**: Clicking pending history item triggers `selectHistoryMove` and renders snapshot
- **Manual test**: Pending moves show at ~50% opacity with subtle pulse
- **Manual test**: Clicking a pending move navigates to its snapshot
- **Manual test**: Screen readers announce pending moves as busy, not disabled

---

## Phase 8: Failed operation UX — alert banner + reset

**Status on this branch:** Partially complete

Implemented so far on this branch:
- failed optimistic create-game leaves the local stub mounted
- failed create-game shows an alert banner instead of collapsing the route
- dependent optimistic commands are failed and cleared when create/branch binding fails

Still remaining on this branch:
- unify all failed-operation surfaces behind a single failed-operation API
- remove the older split between `rollbackNotice` and operation-manager-backed failures
- add dismiss/reset behavior for all failed optimistic operations, not just creation-related failures

Surface unrecoverable failures with a dismissible banner.

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/sync-store.js` | Expose `getFailedOperations(gameId)` and `dismissFailedOperation(operationId)`. On dismiss: clear record, reset game to last authoritative snapshot. |
| Modify | `apps/web/shell/app.js` | In render: query `syncStore.getFailedOperations(gameId)`. If any, render dismissible alert banner above the board. Replace existing `rollbackNotice`/`clearRollbackNotice` usage. |
| Modify | `apps/web/shell/shell.css` | Add `.sync-failure-banner` styles (error colors, dismiss button) |

### Verification
- **Unit tests**: `getFailedOperations(gameId)` returns failed handles; `dismissFailedOperation(id)` clears them
- **Unit test**: After dismiss, game state matches last authoritative snapshot
- **Integration test**: Mock server failure after max retries → `'failed'` → banner → dismiss → reset
- **Manual test**: Simulate network failure → banner appears → dismiss resets board

---

## Phase 9: Make history navigation local-first

**Status on this branch:** Not started

History navigation (`selectHistoryMove`, `returnToLive`) executes instantly with no server dependency.

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/sync-store.js` | `selectHistoryMove` and `returnToLive`: update local game state immediately (data is client-side in `game.moves`), return committed OperationHandle. Fire background HTTP for server presence sync (fire-and-forget). |

### Details
- All move snapshots already stored client-side
- Works identically offline and online
- Server call is fire-and-forget for position sync (so other viewers see where you're looking)

### Verification
- **Unit tests**: `selectHistoryMove()` and `returnToLive()` return committed handle synchronously
- **Unit test**: `currentSnapshot` updates immediately after `selectHistoryMove()`
- **Integration test**: History navigation offline works identically to online
- **Integration test**: Background server sync fires but doesn't block handle
- **Manual test**: History navigation is instant, no loading, no pulse
- **Manual test**: Works fully offline

---

## Phase 10: Internalize WebSocket layer

**Status on this branch:** Not started

Absorb `live-sync.js` fully into the sync store.

### Files

| Action | File | What changes |
|--------|------|-------------|
| Modify | `apps/web/shell/sync-store.js` | Move WebSocket management from `live-sync.js` into sync store internals. `onEvent` routes to `applyLiveGameUpdate()` + `operationManager.confirm()`. |
| Delete | `apps/web/shell/live-sync.js` | Fully absorbed |
| Modify | `apps/web/shell/app.js` | Remove remaining WS status tracking. Metrics via `syncStore.getSyncMetrics()`. |

### Verification
- **Unit tests**: WS lifecycle managed internally, events route correctly
- **Integration test**: Reconnection with exponential backoff after simulated disconnect
- **Integration test**: Tab visibility change triggers reconnect
- **Manual test**: WebSocket works as before, heartbeat, visibility transitions

---

## Phase 11: Cleanup

**Status on this branch:** Not started

### Files

| Action | File | What changes |
|--------|------|-------------|
| Delete | `apps/web/shell/store.js` | Dead code (only imported by test files) |
| Modify | `apps/web/test/join.test.mjs` | Migrate from `createShellStore` to `createSyncStore` |
| Modify | `apps/web/test/support.mjs` | Migrate from `createShellStore` to `createSyncStore` |
| Modify | `apps/web/shell/sync-store.js` | Remove `rollbackNotice`/`clearRollbackNotice`. Clean up pass-through methods. |

### Final state (after Phase 11)
- `sync-store.js` — unified sync store (sole client-server interface)
- `operation-manager.js` — operation lifecycle, handles, promises
- `optimistic-live.js` — pure optimistic projection (unchanged, imported by sync store)
- `persistence.js` — localStorage wrapper (available for future offline support)
- `live-transport.js` — internal to sync store (game cache, HTTP transport, retry logic)
- `app.js` — UI orchestration, calls only `syncStore.*`, no global busy flag

---

## Phase 12: Re-introduce offline support (future)

**Status on this branch:** Deferred / not started

The original requirement states that operations not involving another player should run fully offline, including self-play and local history navigation. Offline mode was recently removed from the codebase (commit 1686f2f). The sync store architecture is designed to properly support this when the time comes.

### What the sync store enables for offline
- **Operation queue with persistence**: The operation manager can serialize pending operations to `persistence.js` (which still has `loadLiveTransportState()`/`saveLiveTransportState()` available but unused). On reconnect, queued operations replay.
- **Local game engine execution**: The game engine (`packages/game-engine/src/`) can validate and apply moves locally. The sync store can detect offline state and route operations through the engine instead of HTTP.
- **Self-play mode**: Client-generated game IDs (Phase 3) mean self-play games can be created offline with a stable ID. When connectivity returns, the sync store commits them to the server.
- **History navigation is already local-first** (Phase 9): Works offline by design since snapshots are client-side.

### Implementation sketch (not in current scope)
1. Sync store detects `navigator.onLine === false` or transport failures
2. For self-play games: route `applyAction()`/`endTurn()` through local game engine, return committed handles, queue server-bound operations
3. Persist game state + operation queue to localStorage via `persistence.js`
4. On reconnect: replay queued operations via existing retry infrastructure
5. For non-self-play games: return `'failed'` handles with clear "offline" error message

This phase is deferred but the sync store's OperationHandle pattern and operation manager make it straightforward to add later.

---

## Critical files reference

| File | Role | Lines |
|------|------|-------|
| `apps/web/shell/live-transport.js` | Primary extraction target — core sync logic (now leaner after offline removal) | ~840 |
| `apps/web/shell/app.js` | Consumer to migrate — contains WS glue, busy flag, button disabling, panel swipe | ~4033 |
| `apps/web/shell/live-sync.js` | WebSocket layer to absorb | ~416 |
| `apps/web/shell/optimistic-live.js` | Pure projection logic — stays separate. Uses shared `finalizeResolvedTurn()` for turn parity | ~220 |
| `packages/shared-types/src/shell-live-turn.js` | Shared turn settlement helpers (`finalizeResolvedTurn`, `getControlSeatForTurn`, etc.) — used by both optimistic-live.js and shell-live-core.ts | ~50 |
| `apps/web/shell/scenarios.js` | Scenario building — `buildHistoryBranchSeedFromGame()` used by Phase 3 | ~228 |
| `apps/web/shell/runtime-sync.js` | Board selection reset logic — consumed by app.js, not affected by sync store | ~73 |
| `apps/web/shell/selection-hydration.js` | One-shot selection replay guard — consumed by app.js, independent of sync store | ~32 |
| `apps/web/board/hosts/shell-host.js` | Sole board host (playground-host.js deleted) — adapts to OperationHandle. Contract tested in `test/shell-host.test.mjs` | ~88 |
| `apps/web/board/board-adapters/engine-board-adapter.js` | Board adapter (renamed from engine-playground-adapter.js). Not directly affected. | — |
| `apps/web/board/runtime/board-runtime.js` | Board rendering — overlay phases, rush blocker preview, coordinate coloring. Not directly affected. | ~1189 |
| `apps/web/shell/shell.css` | Pending styling, pulsing, skeletons, failure banner | ~900+ |
| `apps/web/shell/persistence.js` | Storage layer — now includes `loadLiveTransportState()`/`saveLiveTransportState()` | ~41 |
| `packages/api-handler/src/game-room-do.ts` | Server game room — already accepts client-generated gameId | ~700 |
| `packages/api-handler/src/shell-live-core.ts` | `nextGameId()` format reference — `game-{hex}`. `LiveGame` type uses `selfPlayMode`. Turn settlement via shared `finalizeResolvedTurn()`. | ~1229 |
| `docs/SHELL_PORTABILITY.md` | Shell architecture doc — adapter surfaces, live authority responsibilities, self-play as game state mode | ~63 |

## Design decisions

1. **Facade-first, not rewrite**: Phase 1 wraps existing code to preserve battle-tested retry/optimistic logic. Incremental extraction follows.

2. **Five-tier operation classification**: Every operation is categorized by its latency profile (instant / client-ID / local prediction / pulsing button / loading skeleton). This drives consistent UX patterns across the entire app.

3. **Client-generated game IDs** (`crypto.getRandomValues`): Server already accepts them (`game-room-do.ts:202`). Eliminates URL instability, ID swapping, and move-queue race conditions. Collision risk negligible with 128+ bits.

4. **Revert operations become optimistic**: Local state prediction is safe because the game engine can compute reverted state client-side. Server rejection triggers rollback.

5. **Global `busy` flag eliminated entirely**: Replaced by tier-appropriate pending states — nothing for instant operations, pulsing buttons for server-dependent button actions, loading skeletons for view-level data loading.

6. **Pulsing > spinners**: Subtle CSS `@keyframes pulse` animation feels more modern and less intrusive than traditional spinners.

7. **Loading skeletons match content layout**: Skeleton blocks positioned to approximate the real content (board area, sidebar, card rows) so the transition from skeleton to content is seamless rather than jarring.

8. **History branching inherits optimistic game creation**: Since `buildHistoryBranchSeedFromGame()` already runs client-side, combining it with client-generated IDs makes branching instant — the new tab opens immediately.

9. **Scenario import stays server-dependent** (Tier 5): The server computes board state from scenario data. This cannot be done optimistically because scenarios can have complex replay logic. A skeleton placeholder in the scenario panel bridges the wait.

10. **`live-transport.js` stays as internal module**: Now 840 lines (down from ~1420 after offline removal). The sync store delegates to it. Only `live-sync.js` gets absorbed (Phase 10).

11. **Offline support deferred to Phase 12**: Offline mode was recently removed from the codebase. The sync store architecture is designed to cleanly re-introduce it later — the OperationHandle pattern, operation queue, and client-generated IDs all support offline operation. But the initial implementation focuses on the online-first path where all the existing users are.
