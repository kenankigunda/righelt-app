# Spec: t-030 — Feature: Ability to leave games / delete if last player

## 1. Customer Problem

Players and viewers currently have no way to deliberately exit a game they no longer want to be part of. A player who creates a game by mistake, finishes with a game, or simply wants to clean up their list has no recourse — the game stays on their home page indefinitely. There is also no way for the last remaining player to remove a game entirely. This creates clutter and confusion, especially as the home page list grows.

## 2. Affected Users & Contexts

| Role | Phase | Context |
|---|---|---|
| Player (any seat) | Any — lobby, in-game, completed | Home page game card menu; game page action |
| Player (sole/last player) | Any | Same surfaces; action becomes "Delete" rather than "Leave" |
| Playground mode device | Any | Only player on both seats; action is always "Delete" |
| Viewer | Any | Home page game card menu; game page action; viewer is kicked to join-decision screen |

Leave and Delete actions are not available while the device is offline.

## 3. Current Behavior

No "Leave" or "Delete" action exists for any participant role. Players cannot free their seat, cannot remove abandoned games, and have no trash/restore mechanism. Viewers cannot exit a game without navigating away manually.

There is also no "game not found" screen for invalid or deleted game IDs — the app currently has undefined behavior in that case.

## 4. Intended Behavior

### 4.1 Leave vs. Delete label logic

- The action is labelled **"Delete"** when the acting user is the only player in the game (including Playground mode, where a single device holds both seats).
- The action is labelled **"Leave"** in all other cases (another player occupies at least one seat, or the acting user is a Viewer).
- The label is determined at the moment the menu is opened, based on current game participant state.

### 4.2 Affordance locations

- A small **hamburger menu** (⋮ or ≡) must be shown at the top-right of every game card on the home page. The menu must include the appropriate Leave or Delete option.
- An equivalent action must also be accessible from within the game page itself (exact placement TBD by engineering, but consistent with existing game-page shell chrome).
- The affordance must be present regardless of game phase (lobby, in-progress, completed).

### 4.3 Confirmation

No confirmation dialog is required. The action takes effect immediately on tap/click.

### 4.4 Player Leave (another player remains)

- The acting player's seat is freed immediately.
- The game remains active; the vacated seat is open for the normal invite/request flow (Section 4 of RIGHELT_WEB_APP_SPEC.md).
- No forfeit is applied; the game does not end.
- The acting player is immediately shown a **"You have left the game"** banner that overlays and blocks the rest of the game UI, matching the visual pattern of the "Game deleted" banner (§4.6 below).
- The banner must include a **"Rejoin as player"** action. Rejoining is immediate — no counterplayer approval is required.
- The remaining player receives a notification that their opponent has left (per §13 of RIGHELT_WEB_APP_SPEC.md notification categories). Viewers also receive this notification.

### 4.5 Last-player Delete (soft delete)

- When the sole remaining player (or Playground device) triggers the action, the game is **soft-deleted** immediately.
- The acting player is navigated away from the game page (or the card is removed from the home page list) without a blocking banner — they have already initiated the action.
- Any viewers still on the game page are immediately shown the **"Game deleted"** view (§4.6).
- Viewers receive a notification that the game was deleted.
- The game is moved to the **Trash bin** (§4.7) and does not appear in the normal home page list.

### 4.6 "Game deleted" view

- When a participant visits a game page that has been soft-deleted, the full game UI is blocked by a **"Game deleted" banner** at the top of the page.
- The rest of the game UI behind the banner is non-interactable (visually dimmed, matching the invite-entry UX pattern from RIGHELT_WEB_APP_SPEC.md §4).
- A **"Restore"** action is shown inside the banner, but only to users who hold a player seat. Viewers see the banner without a restore option.
- Selecting "Restore" immediately un-deletes the game and returns the participant to the normal live game view.

### 4.7 "Game not found" screen

- A dedicated **"Game not found"** screen must be shown whenever a game ID is looked up and cannot be resolved at all — either because it never existed or because a future hard-delete has occurred.
- This screen is distinct from the "Game deleted" banner; it has no restore option.
- This screen is a net-new shell route/state.

### 4.8 Trash bin

- A **Trash bin** page is accessible from the home page (exact navigation entry TBD by engineering).
- The trash bin layout mirrors the home page game list.
- Each card in the trash bin shows a hamburger menu with a **"Restore"** option visible only to players. Viewers see the card but have no restore option.
- The trash bin has two sections:
  - **My deleted games**: games where the acting user is (or was) a player.
  - **Other games**: games where the acting user is explicitly a viewer (and the game was deleted by a player).
- Restoring a game from the trash bin is available to players only; it is immediate.

### 4.9 Viewer Leave

- A Viewer may leave at any time via the same hamburger menu or game-page action.
- Leaving as a Viewer has no consequences for other participants — no notification is sent, the game is not affected.
- After leaving, the Viewer is navigated to the **"Choose how to enter this game"** join-decision screen for that game (the same Non-player invite screen from RIGHELT_WEB_APP_SPEC.md §4), where they may re-enter as Viewer or request a player seat.

### 4.10 Offline constraint

- Leave and Delete actions must be disabled (and visually indicate unavailability) while the device is offline.
- No leave or delete may be queued for later sync; the action must only execute when connected.

## 5. Rules & Engine Contract

No change to game rule legality, scoring, or board-state transitions. The board integration contract is unaffected. The shell manages seat assignment and game lifecycle state; this ticket adds soft-delete and seat-release operations at the shell/persistence layer only.

## 6. Shell / Board Boundary

- Shell owns all leave/delete/restore decisions and the resulting participant roster mutations (seat freeing, game soft-delete, game restore).
- Shell owns the "Game deleted" banner surface, the "You have left the game" banner surface, and the "Game not found" screen — these are shell-level routing/state overlays, not board surfaces.
- The board must not be aware of soft-delete state. The shell must not initialize or resume a board session for a soft-deleted game.
- When a restore is applied, the shell re-enters the normal live game flow and re-initializes the board if the game page is active.
- The shell must not branch on board-internal action types to determine when leave/delete is legal. Leave/delete is legal at any shell-observable game phase.

## 7. UX Design

### 7.1 Information Architecture

- The hamburger menu icon on home page game cards must be positioned consistently at the top-right corner of every card, regardless of game state or participant role. Absent-menu states (e.g., if ever not shown) must reserve equivalent space so card layout remains stable across the list (per UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md Game Card Rule).
- The "Game deleted" banner and "You have left the game" banner must follow the established blocking-overlay pattern from the invite-entry and player-seat-approval UX (RIGHELT_WEB_APP_SPEC.md §4): full-width top-of-page surface, rest of game UI dimmed and non-interactable.
- The trash bin page uses the same card layout and sectioning conventions as the home page. Two sections: "My deleted games" and "Other games" (viewer-only membership). Section headers follow existing home page sectioning style.
- The "Game not found" screen is a minimal, centered shell state — no game card or board surface shown.

### 7.2 Motion & Transitions

- When a player leaves from the home page card menu, the card must animate out of the list smoothly (consistent with layout-stability conventions, RIGHELT_WEB_APP_SPEC.md §1.1.5) — no abrupt reflow of sibling cards.
- When the "Game deleted" or "You have left the game" banner appears for a participant still on the game page (e.g., a viewer when the last player deletes), it must animate in using the smooth expand convention (120–220ms easing) rather than appearing abruptly.
- Restore must transition the participant back to the live game state without a full page reload wherever possible.

### 7.3 Feedback & Affordances

- The hamburger menu icon must have appropriate pressed/hover states gated by `data-hover-capability="hover"` per UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md Hover Capability Principle.
- The Leave/Delete menu item is the primary destructive action; it must be visually distinguishable from other menu items (e.g., distinct color or weight) without relying on hover-only differentiation.
- While offline, the Leave/Delete option in the menu must be visibly disabled with a short inline explainer (e.g., "Not available offline") — it must not be silently hidden.
- The "Rejoin as player" action in the "You have left the game" banner must show an immediate pressed state on tap and confirm re-entry without delay.

### 7.4 Multiplayer & Presence

- When a player leaves, the remaining player receives a shell-level notification (per RIGHELT_WEB_APP_SPEC.md §13 category: opponent/viewer joined/left). The vacated seat must update in all connected participants' presence displays immediately.
- When the last player deletes, all connected viewers must receive the "Game deleted" overlay in real time via the existing live-sync channel — no manual refresh required.
- The "You have left the game" banner is a local-only shell state for the leaving player; it does not need to propagate to others (their view already reflects the vacated seat).
- Rejoin after leave: when a former player rejoins via the banner action, their seat is restored optimistically and confirmed by the server. Other connected participants must see the presence update immediately upon confirmed rejoin.

### 7.5 Mobile & Viewport

- The hamburger menu tap target on game cards must meet minimum tap comfort size (consistent with mobile real-estate principle in UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md).
- The "Game deleted" and "You have left the game" banners must be full-width and legible at all viewport widths without horizontal scroll.
- The trash bin page must follow the same narrow-gutter mobile layout as the home page.

## 8. Acceptance Criteria

- [ ] AC1: A player whose game has no other player sees a "Delete" option in the hamburger menu on the home page game card and on the game page.
- [ ] AC2: A player whose game has another player present sees a "Leave" option in the same locations.
- [ ] AC3: A Viewer sees a "Leave" option in the same locations.
- [ ] AC4: Tapping/clicking the action takes effect immediately, with no confirmation dialog.
- [ ] AC5: After a player Leaves (another player remains), the leaving player sees a "You have left the game" banner with a "Rejoin as player" action; the rest of the game UI is blocked.
- [ ] AC6: Tapping "Rejoin as player" from the banner immediately restores the player to their seat without requiring counterplayer approval.
- [ ] AC7: The remaining player receives a notification that their opponent has left.
- [ ] AC8: Viewers receive a notification when a player leaves.
- [ ] AC9: After the last player Deletes, the game is removed from the normal home page list and appears in the Trash bin.
- [ ] AC10: Any viewer on the game page when the last player deletes immediately sees the "Game deleted" banner blocking the game UI, without requiring a page refresh.
- [ ] AC11: The "Game deleted" banner shows a "Restore" action to players but not to viewers.
- [ ] AC12: A player who restores a deleted game from the banner is returned to the normal live game view.
- [ ] AC13: The Trash bin page is accessible and lists deleted games in two sections: "My deleted games" (player membership) and "Other games" (viewer-only membership).
- [ ] AC14: Each card in the trash bin shows a hamburger menu with a "Restore" option visible only to players.
- [ ] AC15: Restoring from the trash bin is immediate for players and not available to viewers.
- [ ] AC16: Navigating to a game ID that cannot be resolved shows a "Game not found" screen with no restore option.
- [ ] AC17: A Viewer who leaves is navigated to the join-decision screen for that game; other participants see no notification and the game is unaffected.
- [ ] AC18: Leave and Delete actions are visibly disabled with an inline explainer while the device is offline.
- [ ] AC19: The hamburger menu icon appears consistently at the top-right of every home page game card regardless of game state, and its presence/absence does not cause vertical layout shifts in adjacent cards.
- [ ] AC20: In Playground mode (one device, both seats), the action is labelled "Delete" and behaves as last-player deletion.

## 9. Out of Scope

- Hard delete (permanent destruction of game history) — this ticket introduces soft delete only.
- Automatic garbage collection or expiry of trash bin items.
- Host/creator ability to remove other participants (kick/ban).
- Forfeit or win-by-abandonment logic — leaving frees the seat only; no game outcome is assigned.
- Admin-level game deletion or moderation tools.
- Leave/delete while offline (offline action queuing is out of scope).
- Push notification (mobile OS-level) for leave events — in-app notification only.

## 10. Open Questions & Decisions

| Question | Decision | Rationale |
|---|---|---|
| Confirmation dialog on leave/delete? | None — immediate action | Restore is available from the trash bin and from the "Game deleted" banner, so the action is recoverable. Removing the confirmation step keeps the flow fast. |
| Forfeit on player leave? | No forfeit — seat opens for re-fill | Keeps the game alive; former player can rejoin; aligns with the goal of not penalising exploratory or accidental leaves. |
| Soft vs. hard delete? | Soft delete with trash bin | Preserves recovery path; aligns with established product patterns (trash bin model). |
| Last player leaves with viewers present — delete immediately or wait? | Delete immediately | Viewers see "Game deleted" view in real time. Players hold the authoritative lifecycle stake; when none remain, the game is deleted. |
| Viewer rejoin destination after leave? | Join-decision screen | Viewer can re-enter without friction; keeps the flow consistent with the existing Non-player invite/join path. |
| Rejoin after player leave — approval required? | No approval required | Immediate rejoin lowers the cost of accidental leave; counterplayer approval is reserved for the stranger-entry path (home-page public entry). |
| Offline leave? | Not available | Destructive lifecycle actions require server confirmation; no offline queueing for leave/delete. |

## 11. References

- `docs/RIGHELT_WEB_APP_SPEC.md` §1.1.2 (ownership boundary), §1.1.5 (layout-stability motion), §1.1.6 (direct-interaction feedback), §4 (invite/join flow and blocking-overlay UX pattern), §6 (presence and reconnection), §8 (home page game list), §11 (role capability matrix), §12 (Playground mode), §13 (notifications and prompts)
- `docs/UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md` (Game Card Rule, hover capability principle, mobile screen real-estate principle)
- `docs/WORKFLOW_COVERAGE.md` — "Core Multiplayer Workflows" and "Extended Shell Workflows" sections (leave/delete workflow coverage is currently `missing` and must be added)
- `backlog/tasks/t-030 - Ability to leave games - delete if last player.md`
