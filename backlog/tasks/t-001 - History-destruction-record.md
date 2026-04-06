---
id: T-001
title: History destruction record
status: Done
assignee:
  - Lead
created_date: '2026-04-04'
updated_date: '2026-04-06 02:13'
labels:
  - feature
dependencies: []
references:
  - docs/tickets/t-001/coordination-log.md
  - docs/tickets/t-001/spec.md
  - docs/tickets/t-001/eng-plan.md
  - docs/tickets/t-001/test-plan.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P1. Show supply/command/destruction records in history view.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC1: After any move that causes one or more piece removals, the history panel shows a `DESTROYED (x,y)` sub-bullet beneath that move entry for each removed piece, where `(x,y)` is the square the piece was on at removal.
- [x] #2 AC2: The sub-bullet color matches the owner color of the destroyed piece (Player 1 color for P1 pieces, Player 2 color for P2 pieces).
- [x] #3 AC3: In a draw (both Commanders unsupplied in the same resolution), two destruction sub-bullets appear under the triggering move entry, one per Commander, each in its respective owner color.
- [x] #4 AC4: All three destruction causes produce a record: `no_retreat`, `loss_of_supply`, and Commander unsupply (win/draw condition).
- [x] #5 AC5: History navigation remains owned by the parent move row; destruction sub-bullets do not introduce a separate navigation action or alternate board state.
- [x] #6 AC6: Selecting a history move with destruction records shows those removals as destroyed-piece overlays on the recorded-action/history board view for that move.
- [x] #7 AC7: Destruction records are visible to Player 1, Player 2, and Viewers identically.
- [x] #8 AC8: Destruction records are persistent: they are present after a page reload, and a participant who joins after the moves occurred sees the same destruction sub-bullets as participants who were present.
- [x] #9 AC9: Destruction sub-bullets do not appear in the Live view board surface — they appear only in the history panel.
- [x] #10 AC10: The board-local transient removal tooltip (§12.3) continues to function as before and is not removed by this change.
- [x] #11 AC11: Sub-bullets for a move appear in the history panel at the same time as their parent move entry is appended (not delayed separately).
- [x] #12 AC12: A player pinned to an earlier history snapshot sees new move entries (with any destruction sub-bullets) append to the panel list without being navigated away from their current view.
- [x] #13 AC13: The presence or absence of destruction sub-bullets does not shift the vertical position of other move rows in the history panel.
- [x] #14 AC14: Destruction sub-bullets animate in with their parent move entry, and selecting a history move reveals its destruction overlays without a second staggered animation after the history state settles.
- [x] #15 AC15: Destruction sub-bullets remain visually subordinate and readable on both hover-capable and touch/non-hover devices without implying a separate interactive affordance.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
- Extend `collectRemovedPieceNotices` in both `shell-live-core.ts` and `optimistic-live.js` to produce `DestroyedPieceRecord` with `ownerSeat` and `commander_unsupplied` reason (t-001.01); Commander removal always produces terminal outcome — this invariant is documented in code.
- Add `destroyedPieces?: DestroyedPieceRecord[]` to `MoveEntry`; persist computed array on each move record; normalization defaults absent field to `[]` with no backfill for pre-deploy moves (t-001.02).
- Extend recorded-action board loads with destruction overlay data derived from the selected move so history mode can render destroyed-piece markers without mutating snapshot state (t-001.03).
- Render `DESTROYED (x,y)` sub-bullets in `renderTurnHistory`; owner-color CSS; layout stable when absent; keep history navigation owned by the parent move row while the selected move feeds board overlays (t-001.04 / t-001.05).
- Full unit, integration, and E2E test coverage for all 15 ACs (t-001.06).

See full plan: `docs/tickets/t-001/eng-plan.md`
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added persistent `DESTROYED (x,y)` sub-bullets to the history panel for any move that removes one or more pieces from the board. Each sub-bullet is colored by the destroyed piece's owner, attaches to the specific sub-action that triggered the removal, and remains a subordinate annotation inside its parent move row. Selecting a history move with destruction records shows destroyed-piece overlays on the recorded-action board view for that move. Destruction records are persisted on `MoveEntry` server-side and flow through all history endpoints, surviving reload and late-join. All three removal causes (`no_retreat`, `loss_of_supply`, `commander_unsupplied`) are handled, including the draw case (both Commanders removed). The board-local transient removal tooltip (§12.3) is unchanged.

The final branch iteration removed the earlier dedicated click-to-highlight API in favor of selected-move-owned recorded-action overlays. Two open non-blocking risks remain: the draw scenario has no integration-level test through `recordClientMove` (unit coverage exists), and `history-destruction-item` lacks a `:focus-visible` rule (pre-existing pattern matching `history-item`).

**Changed files:** `shell-live-core.ts`, `shell-live-db.ts`, `game-room-do.ts`, `optimistic-live.js`, `app.js`, `shell.css`, `board-runtime.js`, `styles.css`, `RIGHELT_RULES_SPEC.md`, `RIGHELT_WEB_APP_SPEC.md`, `WORKFLOW_COVERAGE.md`; 7 new/expanded test files; 6 new E2E specs.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All subtask acceptance checks pass (t-001.01 through t-001.07 green).
- [x] #2 `pnpm --filter @righelt/web test` (359 tests) and `node scripts/run-node-tests.mjs packages/api-handler/test/` (114 tests) pass with 0 failures.
- [x] #3 All 17 unit, 19 integration, 6 E2E, and 8 UX test-plan items in `docs/tickets/t-001/test-plan.md` are covered and passing.
- [x] #4 AC10 regression confirmed: transient board removal tooltip (§12.3) still fires on live moves; existing `board-runtime.test.mjs` and `shell-host.test.mjs` tests remain green.
- [x] #5 `destroyedPieces` survives a full serialize–normalize–serve round-trip (AC8 and I-08 verified).
<!-- DOD:END -->
