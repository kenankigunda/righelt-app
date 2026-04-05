# Test Plan: T-030 — Ability to Leave Games / Delete if Last Player

## Coverage Summary

This plan covers the full leave/delete/restore lifecycle introduced by T-030 across all three testing layers. The feature touches five new server endpoints, a new `deletedAt` field in the data model, two new shell routes/states (`#/trash`, "Game not found"), two new blocking overlays ("You have left the game", "Game deleted"), a hamburger menu on every home-page game card, and real-time multi-client propagation of leave/delete events. Every AC (AC1–AC20) is mapped to at least one test row. Novel scenarios — multi-client real-time propagation, offline disabled state, playground-mode delete, reconnect role restore after rejoin — are called out explicitly. The leave/delete workflow is currently `missing` in `WORKFLOW_COVERAGE.md` and the rows here define the intended coverage target.

---

## Unit Tests

| ID | Description | AC(s) | Module/Function |
|---|---|---|---|
| U-01 | `computeLeaveDeleteLabel` returns `"Delete"` when identity is sole player1 and player2 is null | AC1, AC20 | `computeLeaveDeleteLabel` |
| U-02 | `computeLeaveDeleteLabel` returns `"Delete"` when identity is sole player2 and player1 is null | AC1 | `computeLeaveDeleteLabel` |
| U-03 | `computeLeaveDeleteLabel` returns `"Delete"` in `selfPlayMode` (identity holds both seats) | AC20 | `computeLeaveDeleteLabel` |
| U-04 | `computeLeaveDeleteLabel` returns `"Leave"` when both player seats are occupied by different identities | AC2 | `computeLeaveDeleteLabel` |
| U-05 | `computeLeaveDeleteLabel` returns `"Leave"` for a Viewer identity regardless of player seat state | AC3 | `computeLeaveDeleteLabel` |
| U-06 | `computeLeaveDeleteLabel` returns `"Leave"` when identity is player1 and player2 is occupied by another identity | AC2 | `computeLeaveDeleteLabel` |
| U-07 | Leave/delete affordance is disabled when `isOffline = true`; enabled when `isOffline = false` | AC18 | offline-state helper / `renderCardMenu` |
| U-08 | `renderCardMenu` renders the disabled state with inline explainer text when offline | AC18 | `renderCardMenu` |
| U-09 | `renderCardMenu` marks the leave/delete item with destructive styling distinct from non-destructive items | AC1, AC2, AC3 | `renderCardMenu` |
| U-10 | `renderCardMenu` renders a "Restore" option in the trash bin context for a player identity | AC14 | `renderCardMenu` |
| U-11 | `renderCardMenu` does not render a "Restore" option in the trash bin context for a viewer identity | AC14 | `renderCardMenu` |
| U-12 | `parseRouteFromHash("#/trash")` returns `{ name: "trash" }` | — | `routes.js` / `parseRouteFromHash` |
| U-13 | `buildTrashHash()` returns `"#/trash"` | — | `routes.js` / `buildTrashHash` |
| U-14 | `parseRouteFromHash` returns `{ name: "not-found" }` for an unresolvable path (existing behaviour, must remain stable after adding trash route) | AC16 | `routes.js` |
| U-15 | `shouldLiveSyncRoute` returns `false` for `{ name: "trash" }` (no live sync needed for trash page) | — | `routes.js` |
| U-16 | `applyLeavePlayer` (core helper) frees the player seat and records notification "Player left" when another player remains | AC4, AC7 | `shell-live-core` |
| U-17 | `applyLeavePlayer` sets `deletedAt` and records notification "Game deleted" when no other player remains after leave | AC9 | `shell-live-core` |
| U-18 | `applySoftDelete` sets `deletedAt` to a non-null ISO timestamp | AC9 | `shell-live-core` |
| U-19 | `applyRestore` clears `deletedAt` to `null` | AC12, AC15 | `shell-live-core` |
| U-20 | `findRoleForIdentity` returns correct role for player/viewer after leave mutations | AC5, AC17 | `shell-live-core` |
| U-21 | Home-page section query WHERE clause includes `deleted_at IS NULL` guard | AC9 | `shell-live-db` / `getHomeSectionWhereClause` |
| U-22 | Trash section query WHERE clause filters `deleted_at IS NOT NULL` and matches player identity columns | AC13 | `shell-live-db` / `getTrashSectionWhereClause` |
| U-23 | Trash "other" section filters games where identity is in viewers list but not in player columns | AC13 | `shell-live-db` |
| U-24 | `normalizePersistedGame` round-trips `deletedAt` field (null and non-null) without shape mismatch | — | `shell-live-db` / `normalizePersistedGame` |
| U-25 | `StaticGameCard` type includes `deletedAt` field and `toStaticGameCard` propagates it | — | `shell-live-core` / `toStaticGameCard` |

---

## Integration Tests

| ID | Description | AC(s) | Layer |
|---|---|---|---|
| I-01 | `POST /leave` as player1 when player2 is present: seat freed, game still active, `deletedAt` null, "Player left" notification in response | AC4, AC7 | DO + DB |
| I-02 | `POST /leave` as last player (no other player): game soft-deleted (`deletedAt` set), "Game deleted" notification, event fanned out to connected viewers | AC9, AC10 | DO + DB + WS fanout |
| I-03 | `POST /leave` as player in selfPlayMode: always soft-deletes regardless of seat count | AC20 | DO |
| I-04 | `POST /leave` rejected with `role_not_allowed` when identity is not a player | — | DO |
| I-05 | `POST /leave` rejected with `game_not_found` for unknown game ID | — | DO |
| I-06 | `POST /leave` on an already-deleted game returns `game_already_deleted` error | — | DO |
| I-07 | `POST /restore` by a player identity: `deletedAt` cleared, game active again, event fanned out | AC12, AC15 | DO + DB + WS fanout |
| I-08 | `POST /restore` rejected with `role_not_allowed` when caller is a viewer | AC11, AC15 | DO |
| I-09 | `POST /restore` on a non-deleted game returns `game_not_deleted` error | — | DO |
| I-10 | `POST /leave-viewer` removes the caller from viewers list; no notification added; no WS event broadcast to other participants | AC17 | DO |
| I-11 | `POST /leave-viewer` rejected when caller is not a viewer | — | DO |
| I-12 | Immediate rejoin after leave: `POST /join` with `mode=player` and player-shared invite succeeds without approval gate when seat is empty | AC6 | DO |
| I-13 | Rejoin notification "Player joined" added and fanned out after successful immediate rejoin | AC6 | DO + WS fanout |
| I-14 | `GET /api/shell/games?section=my` excludes soft-deleted games (`deleted_at IS NOT NULL` filtered out) | AC9 | HTTP layer + DB |
| I-15 | `GET /api/shell/games?section=trash-my` returns only soft-deleted games where identity is player | AC13 | HTTP layer + DB |
| I-16 | `GET /api/shell/games?section=trash-other` returns only soft-deleted games where identity is viewer but not player | AC13 | HTTP layer + DB |
| I-17 | Trash-my and trash-other are mutually exclusive for a given identity+game | AC13 | HTTP layer + DB |
| I-18 | Home-page "other" section (`section=other`) does not include deleted games | — | HTTP layer + DB |
| I-19 | `saveProjection` upserts `deleted_at` column correctly when `deletedAt` is set in game state | AC9 | `shell-live-db` / `saveProjection` |
| I-20 | Migration adds `deleted_at` column; existing rows default to NULL; index created | — | DB migration |
| I-21 | WebSocket event with `reason: "player_left"` is received by all connected sessions (remaining player + viewers) when a player leaves | AC7, AC8 | DO + WS |
| I-22 | WebSocket event with `reason: "game_deleted"` is received by all connected viewer sessions when the last player deletes | AC10 | DO + WS |
| I-23 | Stale `event_seq` rejection still works correctly on a soft-deleted game (no regression) | — | DO |
| I-24 | `GET /api/shell/games/:gameId` returns `{ ok: false, error: "game_not_found" }` for a game ID that does not exist in DB | AC16 | HTTP layer |
| I-25 | Leave transport method `leaveGame(gameId)` in `live-transport.js` calls `POST /leave`, updates local game cache, and emits change event | AC4 | client transport |
| I-26 | Restore transport method `restoreGame(gameId)` calls `POST /restore`, updates local cache, navigates to game | AC12, AC15 | client transport |
| I-27 | Leave-viewer transport method `leaveAsViewer(gameId)` calls `POST /leave-viewer` and returns the join-decision redirect target | AC17 | client transport |
| I-28 | Offline guard: `leaveGame` and `restoreGame` reject immediately with `offline` error when transport detects no connectivity | AC18 | client transport |
| I-29 | "Player left" notification appears in notifications array for remaining player after leave | AC7 | DO |
| I-30 | Viewer notification "Player left" arrives on viewer's WebSocket after a player leaves | AC8 | DO + WS |

---

## E2E Tests

| ID | Description | AC(s) | Type |
|---|---|---|---|
| E-01 | Player with no opponent sees "Delete" in the hamburger menu on the home-page game card | AC1 | success |
| E-02 | Player with an opponent sees "Leave" in the hamburger menu on the home-page game card | AC2 | success |
| E-03 | Viewer sees "Leave" in the hamburger menu on the home-page game card | AC3 | success |
| E-04 | Hamburger menu icon present at top-right of every home-page game card; its presence does not shift sibling card layout | AC19 | success |
| E-05 | Tapping "Leave" from the home-page card menu: card animates out immediately without confirmation dialog | AC4 | success |
| E-06 | After tapping "Leave" from the game page, the "You have left the game" banner blocks the game UI | AC5 | success |
| E-07 | "Rejoin as player" in the leave banner restores the player to their seat without approval prompt | AC6 | success |
| E-08 | Remaining player receives a notification banner that their opponent has left | AC7 | success |
| E-09 | Viewers on the game page receive a notification that a player has left | AC8 | success |
| E-10 | Last player taps "Delete": game card removed from home-page list immediately, no confirmation dialog | AC9 | success |
| E-11 | Viewer on game page sees "Game deleted" banner appear in real time (no refresh) when last player deletes | AC10 | success (multi-client) |
| E-12 | "Game deleted" banner shows "Restore" action for a player but not for a viewer | AC11 | success |
| E-13 | Player restores from the "Game deleted" banner: normal live game view resumes without full-page reload | AC12 | success |
| E-14 | Trash bin accessible from home page; shows "My deleted games" and "Other games" sections | AC13 | success |
| E-15 | Each trash bin card shows hamburger menu with "Restore" option for a player, absent for a viewer | AC14 | success |
| E-16 | Player restores a game from the trash bin card: game reappears in home-page list | AC15 | success |
| E-17 | Navigating directly to a non-existent game ID shows "Game not found" screen with no restore option | AC16 | success |
| E-18 | Viewer taps "Leave" from game page: navigated to join-decision screen; remaining player receives no notification | AC17 | success |
| E-19 | Leave/Delete option in hamburger menu is visibly disabled with inline explainer while device is offline | AC18 | recovery |
| E-20 | Playground mode (one device, both seats): hamburger menu shows "Delete", action soft-deletes game | AC20 | success |
| E-21 | Multi-client: Player 2 sees Player 1's seat vacancy in real time after Player 1 leaves | AC7 | success (multi-client) |
| E-22 | "You have left the game" banner animates in smoothly (120–220ms); no abrupt appearance | AC5 | success (polish) |
| E-23 | "Restore" from trash bin is unavailable (button absent or disabled) for a viewer-only participant | AC14, AC15 | recovery |
| E-24 | After player leaves and rejoins via banner, their role is restored correctly after a full page reload | AC6 | recovery |
| E-25 | Soft-deleted game does not reappear in home-page "My games" or "Other games" after restore of a different game | AC9 | recovery |

---

## Coverage Gaps Addressed

The following novel or previously-unexercised scenarios are explicitly covered by this plan:

1. **Multi-client real-time "Game deleted" overlay** (E-11, I-22): A viewer connected on a second browser must receive the overlay without refreshing. This is the first test of the DO-to-viewer real-time fanout for a lifecycle-destruction event.

2. **Multi-client seat vacancy propagation** (E-21, I-21): When a player leaves, the opposing player's presence display must update immediately. This is similar to the existing join-notification path but exercises the inverse (seat removal).

3. **Offline disabled state** (E-19, I-28, U-07, U-08): Leave/delete must show a visible inline explainer — not be silently hidden. This pattern is new; the existing offline handling only covers board moves.

4. **Playground mode "Delete" label** (E-20, U-03, I-03): A device holding both seats must always see "Delete" regardless of seat count semantics. This edge case has no analogue in existing tests.

5. **Reconnect role restore after rejoin** (E-24): A player who left, rejoined via the banner, then reloaded must have their seat correctly restored from persistent state. Tests the interaction between the new leave/rejoin DO logic and the existing `loadGameProjection` normalization path.

6. **Trash bin section correctness** (E-14, E-15, I-15, I-16, I-17, U-22, U-23): "My deleted games" and "Other games" sections must be mutually exclusive and correctly filtered. This is a new query path with no existing coverage.

7. **Restore from two surfaces** (E-13 vs. E-16, I-07): Restoring from the "Game deleted" banner and restoring from a trash bin card must both work and reach the same live game state.

8. **"Game not found" screen** (E-17, I-24): A truly non-existent game ID must show a minimal shell state with no restore affordance. This is a new routing state not covered by any existing E2E.

---

## WORKFLOW_COVERAGE.md Updates Required

The following rows must be added or updated in `docs/WORKFLOW_COVERAGE.md` after T-030 ships:

**Core Multiplayer Workflows** — add new row:

| Workflow | Success E2E | Recovery / failure E2E | Integration variants | Notes |
|---|---|---|---|---|
| Leave game (player or viewer) and soft-delete / restore lifecycle | `present` | `present` | `present` | E2E covers player leave, last-player delete, viewer leave, restore from banner and from trash bin, offline disabled state, multi-client real-time "Game deleted" overlay, and reconnect role restore. Integration covers all DO mutation paths, trash section queries, and notification delivery. |

**Extended Shell Workflows** — add new row:

| Workflow | Success E2E | Recovery / failure E2E | Integration variants | Notes |
|---|---|---|---|---|
| Trash bin page navigation, sectioning, and restore | `present` | `present` | `present` | Browser proof covers "My deleted games" / "Other games" sections, restore from trash card, and viewer-only card without restore option. |

The current status of the leave/delete workflow in both sections is `missing` per the existing `WORKFLOW_COVERAGE.md`.
