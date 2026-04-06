---
id: T-030
title: Ability to leave games / delete if last player
status: Ready for execution
assignee:
  - Lead
created_date: '2026-04-04'
updated_date: '2026-04-06 02:13'
labels:
  - feature
dependencies: []
references:
  - docs/tickets/t-030/coordination-log.md
  - docs/tickets/t-030/spec.md
  - docs/tickets/t-030/eng-plan.md
  - docs/tickets/t-030/test-plan.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AC1: A player whose game has no other player sees a "Delete" option in the hamburger menu on the home page game card and on the game page.
- [ ] #2 AC2: A player whose game has another player present sees a "Leave" option in the same locations.
- [ ] #3 AC3: A Viewer sees a "Leave" option in the same locations.
- [ ] #4 AC4: Tapping/clicking the action takes effect immediately, with no confirmation dialog.
- [ ] #5 AC5: After a player Leaves (another player remains), the leaving player sees a "You have left the game" banner with a "Rejoin as player" action; the rest of the game UI is blocked.
- [ ] #6 AC6: Tapping "Rejoin as player" from the banner immediately restores the player to their seat without requiring counterplayer approval.
- [ ] #7 AC7: The remaining player receives a notification that their opponent has left.
- [ ] #8 AC8: Viewers receive a notification when a player leaves.
- [ ] #9 AC9: After the last player Deletes, the game is removed from the normal home page list and appears in the Trash bin.
- [ ] #10 AC10: Any viewer on the game page when the last player deletes immediately sees the "Game deleted" banner blocking the game UI, without requiring a page refresh.
- [ ] #11 AC11: The "Game deleted" banner shows a "Restore" action to players but not to viewers.
- [ ] #12 AC12: A player who restores a deleted game from the banner is returned to the normal live game view.
- [ ] #13 AC13: The Trash bin page is accessible and lists deleted games in two sections: "My deleted games" (player membership) and "Other games" (viewer-only membership).
- [ ] #14 AC14: Each card in the trash bin shows a hamburger menu with a "Restore" option visible only to players.
- [ ] #15 AC15: Restoring from the trash bin is immediate for players and not available to viewers.
- [ ] #16 AC16: Navigating to a game ID that cannot be resolved shows a "Game not found" screen with no restore option.
- [ ] #17 AC17: A Viewer who leaves is navigated to the join-decision screen for that game; other participants see no notification and the game is unaffected.
- [ ] #18 AC18: Leave and Delete actions are visibly disabled with an inline explainer while the device is offline.
- [ ] #19 AC19: The hamburger menu icon appears consistently at the top-right of every home page game card regardless of game state, and its presence/absence does not cause vertical layout shifts in adjacent cards.
- [ ] #20 AC20: In Playground mode (one device, both seats), the action is labelled "Delete" and behaves as last-player deletion.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
| Subtask | Title | Depends on |
|---|---|---|
| t-030.01 | DB migration and core data-model types | — |
| t-030.02 | Server endpoints: leave, restore, leave-viewer | t-030.01 |
| t-030.03 | Client transport methods and label logic | t-030.01 |
| t-030.04 | Routing: #/trash route and game-not-found screen | — |
| t-030.05 | Shell UI: hamburger menu and home-page leave flow | t-030.03, t-030.04 |
| t-030.06 | Shell UI: game-page leave action and game-deleted overlay | t-030.03, t-030.05 |
| t-030.07 | Shell UI: trash bin page | t-030.04, t-030.05 |
| t-030.08 | E2E tests | t-030.06, t-030.07 |

Max parallel streams: 3. Recommended execution order:
- Round 1 (parallel): t-030.01, t-030.04
- Round 2 (parallel, after 01): t-030.02, t-030.03
- Round 3 (sequential after 02+03+04): t-030.05, then t-030.06 alongside t-030.07
- Round 4: t-030.08
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All 20 ACs verified by automated test or manual confirmation per test-plan.md.
- [ ] #2 `pnpm typecheck` passes with zero errors.
- [ ] #3 `pnpm test` passes (unit + integration layers green).
- [ ] #4 `pnpm test:e2e --grep "t-030"` passes for all E2E rows listed in test-plan.md.
- [ ] #5 `deletedAt` flag in `LiveGame` and `deleted_at` column in `live_games` migration applied and back-compatible (existing rows default to `null`).
- [ ] #6 Home-page "My games" and "Other games" sections do not include soft-deleted games.
- [ ] #7 Trash bin page accessible from home page with two correct sections.
- [ ] #8 Real-time multi-client delivery verified: viewer sees "Game deleted" overlay without refresh; remaining player sees seat vacated without refresh.
- [ ] #9 Offline disabled state verified: leave/delete items show inline explainer, not silently hidden.
- [ ] #10 `docs/WORKFLOW_COVERAGE.md` updated per test-plan.md "WORKFLOW_COVERAGE.md Updates Required" section.
- [ ] #11 No shell/board boundary violations: shell must not initialize board for a deleted game (spec §6).
<!-- DOD:END -->
