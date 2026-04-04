---
id: "t-001"
title: "History destruction record"
status: "Done"
assignee: ["Lead"]
created_date: "2026-04-04"
updated_date: "2026-04-04"
labels: ["feature"]
priority: "high"
dependencies: []
references:
  - "docs/tickets/t-001/coordination-log.md"
  - "docs/tickets/t-001/spec.md"
  - "docs/tickets/t-001/eng-plan.md"
  - "docs/tickets/t-001/test-plan.md"
---

## Description
Notion priority: P1. Show supply/command/destruction records in history view.

## Acceptance Criteria

- [x] AC1: After any move that causes one or more piece removals, the history panel shows a `DESTROYED (x,y)` sub-bullet beneath that move entry for each removed piece, where `(x,y)` is the square the piece was on at removal.
- [x] AC2: The sub-bullet color matches the owner color of the destroyed piece (Player 1 color for P1 pieces, Player 2 color for P2 pieces).
- [x] AC3: In a draw (both Commanders unsupplied in the same resolution), two destruction sub-bullets appear under the triggering move entry, one per Commander, each in its respective owner color.
- [x] AC4: All three destruction causes produce a record: `no_retreat`, `loss_of_supply`, and Commander unsupply (win/draw condition).
- [x] AC5: Clicking a destruction sub-bullet displays the same board snapshot as clicking its parent move entry (post-move state at that move index), not a separate board state.
- [x] AC6: Clicking a destruction sub-bullet highlights the square named in that sub-bullet on the displayed board snapshot.
- [x] AC7: Destruction records are visible to Player 1, Player 2, and Viewers identically.
- [x] AC8: Destruction records are persistent: they are present after a page reload, and a participant who joins after the moves occurred sees the same destruction sub-bullets as participants who were present.
- [x] AC9: Destruction sub-bullets do not appear in the Live view board surface — they appear only in the history panel.
- [x] AC10: The board-local transient removal tooltip (§12.3) continues to function as before and is not removed by this change.
- [x] AC11: Sub-bullets for a move appear in the history panel at the same time as their parent move entry is appended (not delayed separately).
- [x] AC12: A player pinned to an earlier history snapshot sees new move entries (with any destruction sub-bullets) append to the panel list without being navigated away from their current view.
- [x] AC13: The presence or absence of destruction sub-bullets does not shift the vertical position of other move rows in the history panel.
- [x] AC14: Destruction sub-bullet interaction feedback (pressed state, highlight reveal) is one continuous motion with no second staggered animation after release.
- [x] AC15: Hover state on sub-bullets is gated by `data-hover-capability="hover"`; the click-to-highlight behavior works on touch/non-hover devices.

## Implementation Plan

- Extend `collectRemovedPieceNotices` in both `shell-live-core.ts` and `optimistic-live.js` to produce `DestroyedPieceRecord` with `ownerSeat` and `commander_unsupplied` reason (t-001.01); Commander removal always produces terminal outcome — this invariant is documented in code.
- Add `destroyedPieces?: DestroyedPieceRecord[]` to `MoveEntry`; persist computed array on each move record; normalization defaults absent field to `[]` with no backfill for pre-deploy moves (t-001.02).
- Add `setDestructionHighlight` / `clearDestructionHighlight` to board runtime public API as a visual-only overlay; auto-clear on `loadSnapshot` (t-001.03).
- Render `DESTROYED (x,y)` sub-bullets in `renderTurnHistory`; owner-color CSS; layout stable when absent (t-001.04); wire `jump-destruction` click handler with pressed state and highlight wiring (t-001.05).
- Full unit, integration, and E2E test coverage for all 15 ACs (t-001.06).

See full plan: `docs/tickets/t-001/eng-plan.md`

## Definition of Done

- [x] All subtask acceptance checks pass (t-001.01 through t-001.07 green).
- [x] `pnpm --filter @righelt/web test` (359 tests) and `node scripts/run-node-tests.mjs packages/api-handler/test/` (114 tests) pass with 0 failures.
- [x] All 17 unit, 19 integration, 6 E2E, and 8 UX test-plan items in `docs/tickets/t-001/test-plan.md` are covered and passing.
- [x] AC10 regression confirmed: transient board removal tooltip (§12.3) still fires on live moves; existing `board-runtime.test.mjs` and `shell-host.test.mjs` tests remain green.
- [x] `destroyedPieces` survives a full serialize–normalize–serve round-trip (AC8 and I-08 verified).

## Final Summary

Added persistent `DESTROYED (x,y)` sub-bullets to the history panel for any move that removes one or more pieces from the board. Each sub-bullet is colored by the destroyed piece's owner, attaches to the specific sub-action that triggered the removal, and highlights the removal square when clicked. Destruction records are persisted on `MoveEntry` server-side and flow through all history endpoints, surviving reload and late-join. All three removal causes (`no_retreat`, `loss_of_supply`, `commander_unsupplied`) are handled, including the draw case (both Commanders removed). The board-local transient removal tooltip (§12.3) is unchanged.

One bug was caught by the final Tester pass and fixed (t-001.07): `setDestructionHighlight` was being called before `syncRouteDataAndLiveChannels()`, causing `loadSnapshot` to clear it immediately; the call order was corrected. Two open non-blocking risks remain: the draw scenario has no integration-level test through `recordClientMove` (unit coverage exists), and `history-destruction-item` lacks a `:focus-visible` rule (pre-existing pattern matching `history-item`).

**Changed files:** `shell-live-core.ts`, `shell-live-db.ts`, `game-room-do.ts`, `optimistic-live.js`, `app.js`, `shell.css`, `board-runtime.js`, `styles.css`, `RIGHELT_RULES_SPEC.md`, `RIGHELT_WEB_APP_SPEC.md`, `WORKFLOW_COVERAGE.md`; 7 new/expanded test files; 6 new E2E specs.
