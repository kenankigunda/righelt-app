# Eng Plan: t-030 — Ability to Leave Games / Delete if Last Player

## Architecture Overview

This feature adds a soft-delete and seat-release lifecycle to the shell layer. The board integration contract is untouched; all changes are in shell routing, data model, server endpoints, and client rendering.

**Packages affected**:
- `packages/api-handler/src/shell-live-core.ts` — new `LiveGame.deletedAt` field, new mutation helpers (`applyLeavePlayer`, `applySoftDelete`, `applyRestore`).
- `packages/api-handler/src/shell-live-db.ts` — new `getTrashSectionWhereClause`, home-page query now filters `deleted_at IS NULL`, `saveProjection` upserts `deleted_at`.
- `packages/api-handler/src/game-room-do.ts` — three new request paths: `POST /leave`, `POST /restore`, `POST /leave-viewer`.
- `packages/api-handler/src/shell-live.ts` — two new `section` values (`trash-my`, `trash-other`) wired to trash query helpers.
- `db/migrations/` — one new migration adding `deleted_at` column + index.
- `apps/web/shell/routes.js` — new `#/trash` route; `parseRouteFromHash`, `buildTrashHash`, `shouldPassiveRefreshRoute` updated.
- `apps/web/shell/live-transport.js` — three new transport methods: `leaveGame`, `restoreGame`, `leaveAsViewer`.
- `apps/web/shell/app.js` — hamburger menu on home cards and game-page header; "You have left the game" overlay; "Game deleted" overlay; trash bin page render; "Game not found" screen; trash home-page sections; offline guard.
- `apps/web/shell/static-game-cards.js` — `normalizeStaticGameCard` and `buildStaticGameCardFromGame` propagate `deletedAt`.

**New abstractions / boundaries**:
- `computeLeaveDeleteLabel(game, identityId)` — pure function, shared between home-card render and game-page render.
- `renderCardMenu(items, { id, isOffline })` — inline helper in `app.js` for hamburger menus on cards and game page.
- `leftGameBannerByGameId` Map — local-only client state tracking "You have left" overlay per game.
- Two new server event `reason` values: `"player_left"` and `"game_deleted"`.

## Approach & Tradeoffs

**Soft-delete model**: `deletedAt: string | null` flag in `LiveGame.state_json` + a denormalized `deleted_at` column on `live_games`. Home queries gain `AND deleted_at IS NULL`. Trash queries flip that filter. Restore sets `deleted_at = NULL`. Chosen over a separate table because the codebase already uses inline flags (e.g. `has_smoke_identity`) and a single-table approach keeps `saveProjection` and `normalizePersistedGame` in one place.

**Trash bin navigation**: New `#/trash` hash route, matching spec language of "Trash bin page". The existing `parseRouteFromHash` / `buildHashForRoute` pattern makes this a small, isolated routing addition.

**Leave/Delete label**: Pure client function `computeLeaveDeleteLabel`. The `StaticGameCard` already carries `player1`, `player2`, and `selfPlayMode`, so no API contract change is needed for the label decision.

**Hamburger menu**: Inline `renderCardMenu` helper injected at two call sites (home card, game-page header). Consistent with existing inline-HTML template pattern in `app.js`. A fully generic reusable menu component would be a bigger architectural shift than this ticket warrants; refactor when a third call site emerges.

**Overlay pattern**: "You have left the game" and "Game deleted" banners reuse the `invite-gate` / `invite-gate-modal` CSS pattern (full-width top-of-page surface, background dimmed with `aria-hidden="true"`). "You have left the game" is local-only state (`leftGameBannerByGameId` map); "Game deleted" is pushed from the server via existing WebSocket event pipeline.

## Implementation Plan

### t-030.01 — DB migration + core data-model types

- **Scope**: Add `deleted_at TEXT` column to `live_games`; create index `idx_live_games_deleted_at`; add `deletedAt: string | null` to `LiveGame` type; update `normalizePersistedGame` to round-trip the field; update `saveProjection` to upsert `deleted_at`; add `applySoftDelete`, `applyRestore` helpers to `shell-live-core.ts`; add `deletedAt` to `StaticGameCard` and `toStaticGameCard`.
- **Worktree**: `../righelt-t-030-01`
- **Branch**: `codex/t-030-01`
- **Depends on**: (none)
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter api-handler` — U-18, U-19, U-24, U-25, I-20 pass
- **Test plan rows covered**: U-18, U-19, U-24, U-25, I-19, I-20

### t-030.02 — Server endpoints: leave, restore, leave-viewer

- **Scope**: Add `POST /leave`, `POST /restore`, `POST /leave-viewer` handlers to `GameRoomDO.fetch`; add `applyLeavePlayer` helper to `shell-live-core.ts`; broadcast `player_left` and `game_deleted` WebSocket events; add `trash-my` / `trash-other` section handling to `shell-live.ts`; add `getTrashSectionWhereClause` to `shell-live-db.ts`; update home-section WHERE clause to add `AND deleted_at IS NULL`.
- **Worktree**: `../righelt-t-030-02`
- **Branch**: `codex/t-030-02`
- **Depends on**: t-030.01
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter api-handler` — I-01 through I-30 pass
- **Test plan rows covered**: I-01 through I-30 (all integration rows)

### t-030.03 — Client transport methods + label logic

- **Scope**: Add `leaveGame`, `restoreGame`, `leaveAsViewer` to `createLiveTransportStore` in `live-transport.js`; implement `computeLeaveDeleteLabel` pure function; propagate `deletedAt` through `buildStaticGameCardFromGame` and `normalizeStaticGameCard`; add `leftGameBannerByGameId` state; add offline guard for leave/restore operations; handle incoming `player_left` and `game_deleted` WebSocket events.
- **Worktree**: `../righelt-t-030-03`
- **Branch**: `codex/t-030-03`
- **Depends on**: t-030.01
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter web` — U-01 through U-11, U-16, U-17, I-25 through I-30 pass
- **Test plan rows covered**: U-01 through U-11, U-16, U-17, I-25, I-26, I-27, I-28, I-29, I-30

### t-030.04 — Routing: #/trash route + "Game not found" screen

- **Scope**: Add `trash` case to `parseRouteFromHash`; add `buildTrashHash`; update `buildHashForRoute` and `isShellRouteHash`; update `shouldPassiveRefreshRoute` to include `trash`; add `{ name: "game-not-found", gameId }` route state for unresolvable game IDs (distinct from existing `not-found`); add unit tests for new route variants.
- **Worktree**: `../righelt-t-030-04`
- **Branch**: `codex/t-030-04`
- **Depends on**: (none — routing is independent)
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter web` — U-12, U-13, U-14, U-15 pass
- **Test plan rows covered**: U-12, U-13, U-14, U-15

### t-030.05 — Shell UI: hamburger menu + home-page leave flow

- **Scope**: Add `renderCardMenu` helper; inject hamburger menu into `renderHomeGameCard` (top-right, layout-stable placeholder always present); wire `data-action="leave-game"` and `data-action="delete-game"` to `leaveGame` / soft-delete calls; animate card out of list on leave (smooth collapse, 120–220ms); add leave/delete action handler in `app.js` event dispatcher; add "You have left the game" banner (`leftGameBannerByGameId` state) with "Rejoin as player" action.
- **Worktree**: `../righelt-t-030-05`
- **Branch**: `codex/t-030-05`
- **Depends on**: t-030.03, t-030.04
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter web` — U-07, U-08, U-09 pass
  - Manual smoke: hamburger appears at top-right on every card; no layout shift when hidden
- **Test plan rows covered**: U-07, U-08, U-09, E-01, E-02, E-03, E-04, E-05, E-06, E-07, E-19, E-22

### t-030.06 — Shell UI: game-page leave action + "Game deleted" overlay

- **Scope**: Add hamburger menu to game-page header chrome (consistent position); wire leave/delete from game page; add "Game deleted" blocking overlay reusing `invite-gate` pattern — shown when `game.deletedAt` is set while participant is on the game page; "Restore" action shown for players only; animate overlay in (120–220ms); handle `game_deleted` WebSocket event → show overlay to all remaining connected participants; handle `restore` action → transition back to live view without full reload.
- **Worktree**: `../righelt-t-030-06`
- **Branch**: `codex/t-030-06`
- **Depends on**: t-030.03, t-030.05
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter web`
  - Manual smoke: viewer on second browser sees "Game deleted" overlay in real time
- **Test plan rows covered**: E-08, E-09, E-10, E-11, E-12, E-13, E-18, E-20, E-21, E-24

### t-030.07 — Shell UI: trash bin page + "Game not found" screen

- **Scope**: Render `{ name: "trash" }` route in `app.js`: two sections ("My deleted games", "Other games") using existing home-section card layout; fetch `trash-my` and `trash-other` via home-section API with passive refresh; "Restore" hamburger option wired to `restoreGame`; absent for viewers; add home-page nav entry linking to `#/trash`; render `{ name: "game-not-found" }` state — minimal centered screen, no restore option, no board surface.
- **Worktree**: `../righelt-t-030-07`
- **Branch**: `codex/t-030-07`
- **Depends on**: t-030.04, t-030.05
- **Acceptance checks**:
  - `pnpm typecheck`
  - `pnpm test --filter web`
  - Manual smoke: trash page loads, shows two sections; non-existent game ID shows "Game not found"
- **Test plan rows covered**: U-10, U-11, E-14, E-15, E-16, E-17, E-23, E-25

### t-030.08 — E2E tests

- **Scope**: Playwright tests for the full leave/delete/restore workflow. At minimum: player leave from card (E-05), player leave from game page + banner + rejoin (E-06, E-07), last-player delete + trash + restore (E-10, E-14, E-15, E-16), viewer leave (E-18), offline disabled state (E-19), "Game not found" screen (E-17). Multi-client scenarios (E-11, E-21) using two concurrent browser contexts.
- **Worktree**: `../righelt-t-030-08`
- **Branch**: `codex/t-030-08`
- **Depends on**: t-030.06, t-030.07
- **Acceptance checks**:
  - `pnpm test:e2e --grep "t-030"`
- **Test plan rows covered**: E-01 through E-25 (representative subset run in CI; full matrix in manual pass)

## WIP Limit

Max parallel: 3

Recommended parallel sets:
- Round 1 (parallel): t-030.01, t-030.04
- Round 2 (parallel, after 01 completes): t-030.02, t-030.03
- Round 3 (parallel, after 02+03+04 complete): t-030.05, t-030.06 — but 06 depends on 05; run 05 first then 06 alongside 07
- Round 4: t-030.07, t-030.08

## Validation Gates

### Per-subtask

Each subtask's acceptance checks act as its local gate. All subtasks must also pass `pnpm typecheck` before merge.

### End-to-end (post-merge)

After all subtasks are merged:

```
pnpm typecheck
pnpm test
pnpm test:e2e --grep "t-030"
```

All 20 ACs must be demonstrably satisfied. `docs/WORKFLOW_COVERAGE.md` must be updated per the test plan's "WORKFLOW_COVERAGE.md Updates Required" section.

## Remaining Risks

1. **`normalizePersistedGame` shape repair**: The existing normalization layer repaired many fields when the schema was extended in the past. Adding `deletedAt` must be treated carefully — if the field is missing from a legacy row it should default to `null` (not trigger a repair warning), since all pre-existing games are non-deleted.

2. **Home-page section query regression**: The `AND deleted_at IS NULL` guard is added to `getHomeSectionWhereClause`. If the column does not exist on an older DB instance (e.g., local dev before migration), the query will fail. The migration must run before any deployment touching the query.

3. **Viewer "Game deleted" overlay delivery**: The existing WS fanout sends events to all active sessions. If a viewer's session is inactive/hibernated when the game is deleted, they may miss the real-time event. The reconnect flow (`loadGameProjection` on reconnect) must check `deletedAt` and show the overlay on reconnect. This should be verified in I-22 and E-24.

4. **Playground mode seat semantics**: `selfPlayMode = true` means both player seats may be held by the same identity. `computeLeaveDeleteLabel` must detect this correctly — verifying `player1.identityId === player2.identityId` or `selfPlayMode === true` rather than just checking for an empty seat.

5. **Restore after reconnect**: When a viewer reconnects to a deleted game, `loadGameProjection` returns the game with `deletedAt` set. The shell must show the "Game deleted" overlay instead of attempting to initialize the board. The shell must not initialize a board session for a deleted game (spec §6).

6. **Animation and reduced-motion**: The new overlays and card-exit animations must respect `prefers-reduced-motion: reduce`. The existing motion constants in `app.js` already have `HISTORY_RELEASE_BOUNCE_MS`/etc.; the new constants for overlay entry (120–220ms) must follow the same pattern and be gated.

## References

- Spec: `docs/tickets/t-030/spec.md`
- Test plan: `docs/tickets/t-030/test-plan.md`
- Testing strategy: `docs/TESTING_STRATEGY.md`
- Workflow coverage: `docs/WORKFLOW_COVERAGE.md`
- App spec: `docs/RIGHELT_WEB_APP_SPEC.md` §4 (blocking overlay pattern), §6 (shell/board boundary), §8 (home page), §12 (Playground mode), §13 (notifications)
