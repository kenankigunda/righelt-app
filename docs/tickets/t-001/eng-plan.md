# Eng Plan: t-001 — History Destruction Record

## Architecture Overview

This feature adds persistent destruction records to the history panel. A `DESTROYED (x,y)` sub-bullet appears beneath any history move entry that caused one or more piece removals, colored per the destroyed piece's owner. The final UX keeps those rows as subordinate annotations; selecting the parent move shows the move's recorded-action snapshot plus destroyed-piece overlays on the board.

Five layers are affected in a directed chain:

1. **Removal computation** — `collectRemovedPieceNotices` in both `packages/api-handler/src/shell-live-core.ts` and `apps/web/shell/optimistic-live.js` (parallel implementations) is extended with `ownerSeat` and a third reason `commander_unsupplied`.
2. **Data / persistence** — `MoveEntry` gains `destroyedPieces?: DestroyedPieceRecord[]`; `shell-live-db.ts` normalization defaults missing fields to `[]` (clean break — no backfill for pre-deploy moves).
3. **API / transport** — existing response paths already return `removedPieces`; `destroyedPieces` flows through alongside them and is returned from history endpoints since it lives on the stored `MoveEntry`.
4. **Board runtime** — recorded-action loads gain destroyed-piece overlay support (plus any supporting pre-action piece context) so history selections can render settled destruction markers without mutating snapshot state.
5. **Shell UI** — `renderTurnHistory` emits subordinate sub-bullet HTML inside the parent move row; history navigation stays owned by the parent move row, while `mountBoardForGame` feeds the selected move's destruction overlays into the board runtime.

**Key invariant documented in this change**: A Commander removal _always_ produces a terminal outcome (`p1_win`, `p2_win`, or `draw`). The `commander_unsupplied` reason is therefore safely inferred: `kind === "commander"` at removal time implies the outcome is non-`ongoing`. This invariant must be reflected in both code documentation and any player-facing documentation.

New type introduced: `DestroyedPieceRecord` (`position: {row, col}`, `ownerSeat: "p1" | "p2"`, `reason: "no_retreat" | "loss_of_supply" | "commander_unsupplied"`). This replaces / extends the existing `RemovedPieceNotice` for persistence purposes; `removedPieces` (transient board tooltip path §12.3) is unchanged.

## Approach & Tradeoffs

Three decisions were evaluated at the human checkpoint:

**1. `commander_unsupplied` reason assignment**: Infer from `piece.kind === "commander"` at removal time (Commander removal always terminal — confirmed invariant). No engine package changes needed. Alternative (engine-side tagging) was rejected as out of scope.

**2. Backfill for pre-deploy moves**: No backfill — `destroyedPieces: []` defaulted during normalization. Pre-existing moves show no sub-bullets. This keeps the normalization path simple and avoids replay-compute risk on every game load.

**3. Recorded-action overlay contract**: Extend recorded-action board loads with destruction overlay data instead of adding a separate shell-owned highlight API. This keeps destruction rendering tied to the selected history move and avoids a second transient state machine that must survive snapshot reloads.

## Implementation Plan

### t-001.01 — Engine: extend DestroyedPieceRecord type and removal computation
- **Scope**: Add `DestroyedPieceRecord` type (with `ownerSeat` and `commander_unsupplied` reason) to `shell-live-core.ts`; update `collectRemovedPieceNotices` in both `shell-live-core.ts` and `optimistic-live.js` to populate `ownerSeat` from `piece.owner` and classify `commander_unsupplied` when `piece.kind === "commander"`. Add inline code documentation capturing the Commander-removal-always-terminal invariant.
- **Worktree**: `../righelt-t-001-01`
- **Branch**: `codex/t-001-01`
- **Depends on**: (none)
- **Acceptance checks**:
  - `pnpm --filter @righelt/api-handler typecheck`
  - `pnpm --filter @righelt/api-handler test -- collectRemovedPieceNotices`
  - `pnpm --filter @righelt/web test -- optimistic-live`
- **Test plan rows covered**: U-01, U-02, U-03, U-04, U-05, U-06, U-17

### t-001.02 — Persistence: add `destroyedPieces` to MoveEntry and normalization
- **Scope**: Add `destroyedPieces?: DestroyedPieceRecord[]` to the `MoveEntry` type in `shell-live-core.ts`; save the computed array onto the move record in `recordClientMove` before `game.moves.push(move)`; update `shell-live-db.ts` normalization to default absent field to `[]` with a mismatch entry logged; update duplicate-move response paths to pass through `move.destroyedPieces`. Update response types in `game-room-do.ts` and `shell-live.ts` so `destroyedPieces` flows through all move responses and history endpoints.
- **Worktree**: `../righelt-t-001-02`
- **Branch**: `codex/t-001-02`
- **Depends on**: t-001.01 (requires `DestroyedPieceRecord` type and updated computation)
- **Acceptance checks**:
  - `pnpm --filter @righelt/api-handler typecheck`
  - `pnpm --filter @righelt/api-handler test -- shell-live-core`
  - `pnpm --filter @righelt/api-handler test -- shell-live-db`
  - `pnpm test:api-handler`
- **Test plan rows covered**: U-07, U-08, U-09, I-01, I-02, I-03, I-04, I-05, I-06, I-07, I-08, I-09, I-10, I-19

### t-001.03 — Board: recorded-action destruction overlay support
- **Scope**: Extend the board overlay contract and runtime so recorded-action/history loads can receive destroyed-piece overlay records derived from the selected move. Use the move's `selectionSnapshot` to recover owner/kind/supply-command styling where needed, render transient removal effects that settle into dedicated history destruction markers, and clear prior destruction overlays on later snapshot loads.
- **Worktree**: `../righelt-t-001-03`
- **Branch**: `codex/t-001-03`
- **Depends on**: (none — board runtime is independent of the type change in 01)
- **Acceptance checks**:
  - `pnpm --filter @righelt/web test -- board-runtime`
  - `pnpm --filter @righelt/web typecheck`
- **Test plan rows covered**: U-10, U-11, U-12, UX-07

### t-001.04 — Shell rendering: DESTROYED sub-bullets in history panel
- **Scope**: Update `renderTurnHistory` in `app.js` to emit a `<ul>` of sub-bullet `<li>` elements for each `DestroyedPieceRecord` in `move.destroyedPieces`; sub-bullet text `DESTROYED (row,col)`; owner-color CSS class using existing `playerToneClassForSide` convention; `data-testid="history-destruction-item"` only. CSS: sub-bullet indent, visual subordination (smaller/lighter), no layout shift when absent, and no separate interactive affordance beyond the parent move row.
- **Worktree**: `../righelt-t-001-04`
- **Branch**: `codex/t-001-04`
- **Depends on**: t-001.02 (requires `destroyedPieces` on `MoveEntry` / view model)
- **Acceptance checks**:
  - `pnpm --filter @righelt/web test -- history`
  - `pnpm --filter @righelt/web typecheck`
- **Test plan rows covered**: U-13, U-14, U-15, U-16, I-13, UX-03, UX-08

### t-001.05 — Shell interaction: parent move owns history selection; board load owns destruction overlays
- **Scope**: Keep history navigation on the existing parent `jump-history` move row, remove any dedicated `jump-destruction` action, and have `mountBoardForGame` derive destroyed-piece overlays from the selected move for recorded-action loads. Sub-bullets stay passive annotations that can bubble into the parent move selection without introducing a second history action or separate highlight-clearing path.
- **Worktree**: `../righelt-t-001-05`
- **Branch**: `codex/t-001-05`
- **Depends on**: t-001.02, t-001.03, t-001.04
- **Acceptance checks**:
  - `pnpm --filter @righelt/web test -- shell-host`
  - `pnpm --filter @righelt/web test -- history`
  - `pnpm --filter @righelt/web typecheck`
- **Test plan rows covered**: I-14, I-15, I-16, I-17, I-18, UX-01, UX-02, UX-04, UX-05

### t-001.06 — Tests and E2E
- **Scope**: Add/expand unit tests for U-01 through U-17; add integration tests I-01 through I-19; add E2E specs E-01 through E-06; confirm UX assertions UX-01 through UX-08; update `WORKFLOW_COVERAGE.md` to note expanded history surface E2E coverage.
- **Worktree**: `../righelt-t-001-06`
- **Branch**: `codex/t-001-06`
- **Depends on**: t-001.05 (full stack assembled for integration + E2E)
- **Acceptance checks**:
  - `pnpm test`
  - `pnpm --filter @righelt/web test`
  - `pnpm test:api-handler`
  - `pnpm test:engine`
- **Test plan rows covered**: all rows in `test-plan.md`

## WIP Limit

Max parallel: 2

Rationale: `t-001.01` and `t-001.03` can run in parallel (they touch disjoint modules). All subsequent tasks form a dependency chain with at most two active at a time. This avoids contention on `app.js` and the `shell-live-core.ts` / `MoveEntry` boundary.

## Validation Gates

### Per-subtask
- Each subtask's acceptance checks must pass before the next dependent subtask begins.
- Typecheck must pass at every step (`pnpm --filter ... typecheck`).
- The `removedPieces` / board tooltip path (AC10) must remain green throughout — checked by existing `board-runtime.test.mjs` and `shell-host.test.mjs` coverage.

### End-to-end (post-merge)
- `pnpm test`
- `pnpm --filter @righelt/web test`
- `pnpm test:api-handler`
- `pnpm test:engine`
- All 15 ACs verified via the test plan.
- No regressions in: history navigation workflow, live-append-while-pinned behavior, move sync across participants, board removal tooltip (§12.3).

## Remaining Risks

1. **Parallel `collectRemovedPieceNotices` implementations**: `shell-live-core.ts` and `optimistic-live.js` must remain in sync. U-17 (parity smoke check) is the guard, but any future changes to one file must also update the other. Consider adding a comment cross-reference.

2. **`commander_unsupplied` inference correctness**: The inference relies on the invariant that a Commander removal always produces a terminal outcome. This is confirmed by the human and must be documented in code. If the engine ever changes to allow non-terminal Commander removal (e.g., for a new game variant), this inference must be revisited.

3. **History endpoint field propagation**: `destroyedPieces` lives on `MoveEntry` which is already serialized and returned. Verify no view-model transformation strips unknown fields between `MoveEntry` and the client-facing game view model (`withViewModel`).

4. **Optimistic vs authoritative reconciliation**: If the optimistic `destroyedPieces` computation differs from the authoritative server result (should not happen given the same inputs, but worth verifying), the history panel could briefly show incorrect sub-bullets before the authoritative response overwrites. I-11 and I-12 cover this.

5. **Layout stability at boundary**: The sub-bullet CSS must genuinely not reserve space when `destroyedPieces` is absent, while the recorded-action destruction markers still settle cleanly on the board. E-05 and UX-03 are the primary guards.

## References
- Spec: `docs/tickets/t-001/spec.md`
- Test plan: `docs/tickets/t-001/test-plan.md`
- Testing strategy: `docs/TESTING_STRATEGY.md`
- Workflow coverage: `docs/WORKFLOW_COVERAGE.md`
