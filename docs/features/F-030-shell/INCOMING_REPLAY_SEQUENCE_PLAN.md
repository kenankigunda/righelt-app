# Incoming Replay Sequence Plan

Status: Proposed implementation plan for simplifying and hardening live incoming-move replay.

Audience: Handoff doc for a follow-up execution thread. This is intended to be implementation-ready, not just exploratory notes.

## Summary

This plan replaces the current multi-layer replay reconstruction with a single controller-owned replay presentation model.

The goals are:

- keep incoming-move replay easy to follow for bot and human moves
- ensure `project` replay begins with the decorated created-piece overlay, not an empty or plain intermediate state
- prevent replay from ever appearing active against the wrong board state
- prevent the board from jumping ahead to a later live authoritative state between queued replayed moves
- reduce complexity by removing duplicate replay logic across controller, shell, runtime, and adapter

The core abstraction is:

- `RecordedMovePresentation`: shared recorded-move overlay data used by history mode and incoming replay
- `ReplayFrame`: one complete board presentation step
- `ReplaySequence`: one ordered set of replay frames that must be treated atomically

While a `ReplaySequence` is active, the shell renders its current frame directly. The shell does not reconstruct replay from partial flags.

## Pressure-Tested Outcome

This plan was pressure-tested against the current implementation and against the recent failure modes observed in both `project` replay and rush-sequence replay.

The conclusion was:

- a parent `ReplaySequence` contract is worth making explicit
- visible baseline should be removed entirely
- the shell should stop reconstructing replay from partial controller/runtime state
- replay reconciliation must use move identity/content, not only `moves.length`
- the first visible frame for `project` must be the recorded-style decorated created piece

This is the simplest design that still satisfies all of the documented requirements without adding more special-case shell logic.

## Why This Exists

The current replay path is fragile because replay state is spread across several layers:

- `apps/web/shell/incoming-move-replay.js`
- `apps/web/shell/app.js`
- `apps/web/board/runtime/board-runtime.js`
- `apps/web/board-adapters/engine-board-adapter.js`

That split has caused repeated classes of bugs:

- `project` replay showing the wrong first visible frame
- replay looking stuck while the board is in the wrong state
- queued replayed moves briefly falling back to the latest live board
- rush-sequence replay jumping ahead between moves

History mode already has a stronger recorded-move presentation contract in `apps/web/shell/sync-store.js` and `apps/web/shell/history-preview.js`. Incoming replay should reuse that model instead of maintaining a near-duplicate presentation path.

Current hotspots that this plan is meant to simplify:

- `apps/web/shell/incoming-move-replay.js`
- `apps/web/shell/app.js`
- `apps/web/board/runtime/board-runtime.js`
- `apps/web/board-adapters/engine-board-adapter.js`

Known seams from the current implementation:

- shell-side replay reconstruction from multiple values instead of one canonical presentation object
- move-count-based replay reconciliation
- separately derived interaction lock
- replay/live fallback states between queued moves

## Desired Behavior

### Core replay behavior

- Replay applies only to incoming moves from seats the current user does not control.
- Replay is scoped to the currently mounted live game route.
- If the tab is hidden or unfocused, unseen incoming moves queue.
- Replay starts only after the browser is ready again.
- The board is non-interactive while replay is active.
- Reduced-motion mode keeps the same sequencing and comprehension, but without motion-heavy treatment.

### Visible replay sequence

There is no visible baseline frame.

Use:

- hidden lead-in only
- then the first visible replay frame

Visible frame policy:

- movement-style actions:
  - `preview`: `selectionSnapshot` + recorded-action overlay + replay chrome
  - `settle`: `snapshot` + no replay chrome
- `project`:
  - `preview`: `snapshot` + recorded-action overlay + replay chrome
  - no visible settle frame

This guarantees:

- the first visible `project` replay frame is the new piece with the plus badge and recorded-overlay semantics
- `project` never shows a visible empty baseline or a plain intermediate settled piece
- queued sequences never need to expose a pre-preview placeholder frame just to preserve correctness

### Sequence correctness

While a replay sequence is active:

- the board must always render the current replay frame
- the board must never fall back to the latest live authoritative board between queued replayed moves
- replay must only clear back to the normal live board after the final replay frame finishes

## Proposed Architecture

### 1. `RecordedMovePresentation`

Add a shared internal presentation helper for recorded moves.

It should own:

- `recordedAction`
- `recordedActionStartPiece`
- destroyed-piece overlays
- any recorded-move-specific overlay metadata needed by the board

This should be reused by:

- history mode
- incoming replay preview

The snapshot used with that presentation remains action-family-specific:

- movement preview uses `selectionSnapshot`
- `project` preview uses `snapshot`

### 2. `ReplayFrame`

Each replayed visual step should be represented as one complete frame:

- `snapshot`
- `overlayMode`
- `recordedMovePresentation`
- `showsReplayChrome`
- `interactionLocked`
- `phase`
- `moveIndex`
- `stepIndex`
- `totalSteps`
- `durationMs`

The shell should mount this frame directly. It should not derive overlay mode, replay chrome, or snapshot fallback on its own.

### 3. `ReplaySequence`

Each batch of one or more unseen incoming moves should be represented as one sequence:

- `sequenceId`
- ordered `ReplayFrame[]`
- current frame index
- final landing snapshot
- move identity/content keys used for reconciliation
- lifecycle status such as `armed`, `running`, `completed`, `cancelled`

This sequence is the unit of correctness.

Required invariant:

- while a `ReplaySequence` exists, the board must never render the normal live presentation

This is the key simplification over the current approach. The shell should never ask, "is replay active enough that I should partly override the board?" It should only ask:

- is there an active `ReplaySequence.currentFrame` to mount?
- if not, render the normal live/history presentation

### 4. Shell responsibilities

`apps/web/shell/app.js` should become simpler:

- ask the controller for the active `ReplaySequence.currentFrame`
- if present, mount it
- otherwise mount normal live/history state

The shell should stop:

- preserving hidden replay via `boardRuntime.getState()`
- inferring replay semantics from `phase === "preview"`
- stitching together replay state from `game.currentSnapshot`, `historySelectionAction`, `destroyedPieces`, and replay flags
- separately computing replay interaction lock outside the frame contract

### 5. Reconciliation rules

Replay must not key only on `moves.length`.

Use stable move identity/content so replay can correctly handle:

- appended moves
- authoritative rewrites without length changes
- reload or route restore with the same move count but different tail content
- rush or push divergence that would otherwise leave replay active against the wrong board

If the authoritative replay target diverges incompatibly:

- cancel the stale sequence
- rebuild from authoritative moves

## Frame Policy

### Hidden lead-in

- no replay chrome
- interaction locked
- not visibly different from the current board presentation

This avoids start flicker without exposing a visible baseline frame.

### Preview

- replay chrome on
- interaction locked
- uses recorded-move presentation semantics

This is the only phase that should show `Incoming move` / `Replaying ...` UI.

### Movement settle

- no replay chrome
- interaction locked
- uses settled post-action snapshot

### `project`

- no visible settle frame
- preview is the only visible replay frame
- after preview, either:
  - continue directly into the next queued replay frame
  - or return to live if the sequence is finished

## Non-Regression Requirements

The execution thread should treat these as hard behavioral contracts:

- Incoming replay is route-scoped to the mounted live game only.
- Replay applies only to seats the current user does not control.
- Hidden/unfocused receipt queues unseen incoming moves until the browser is ready.
- Replay never falls through to a later authoritative live board while queued replay work remains.
- `project` replay never shows a plain created piece as the first visible replay frame.
- Replay chrome appears only during visible preview, not during hidden lead-in or movement settle.
- Board interaction is blocked for the entire active replay sequence.

Existing tests already prove parts of this and should be preserved or rewritten as equivalent proofs rather than weakened:

- `apps/web/test/incoming-move-replay.test.mjs`
- `apps/web/test/incoming-move-replay.integration.test.mjs`
- `e2e/workflows/incoming-move-replay.spec.mjs`

## Implementation Notes

Recommended implementation order:

1. Extract or formalize `RecordedMovePresentation` from the history-mode path.
2. Refactor `incoming-move-replay.js` around `ReplayFrame` and `ReplaySequence`.
3. Simplify `app.js` so it mounts replay frames directly instead of reconstructing replay state.
4. Update board/runtime consumers to treat replay chrome as explicit presentation data.
5. Rebuild tests around the new frame/sequence contracts before re-tuning animation details.

Recommended reconciliation inputs:

- move index within the authoritative move list
- stable action identity/content from the move record
- enough tail-content comparison to detect same-length authoritative rewrites

Avoid rebuilding the architecture around:

- `moves.length` only
- transient `boardRuntime.getState()` preservation as replay state
- shell-side inference like `phase === "preview"` implying all replay chrome and lock behavior

## Alternatives Considered

### 1. Keep the current controller and add more phase exceptions

Rejected because it keeps replay correctness split across controller, shell, runtime, and adapter, which is the main source of the current bugs.

### 2. Keep visible baseline but make it action-specific

Rejected because it still fails the strongest `project` requirement in some flows. If any visible baseline exists, then the first visible replay frame for `project` is not guaranteed to be the decorated created piece.

### 3. Use a flat `currentFrame` contract with an implicit queue

Viable, but weaker. An explicit `ReplaySequence` parent better protects the invariant that multiple replayed moves belong together and the board must not fall back to live between them.

## Test Plan

### Unit

- `ReplaySequence` builder emits:
  - movement preview + settle frames
  - `project` preview-only visible frames
- no visible baseline frame for any replay type
- first visible `project` frame uses the settled snapshot plus recorded overlay
- replay chrome is preview-only
- interaction lock is true for all active replay frames
- no intermediate null/no-replay state between queued replayed moves
- replay reconciliation uses move identity/content, not only move count

### Integration

- shell/runtime mounts `ReplayFrame` directly when replay is active
- shell never falls back to `game.currentSnapshot` while a replay sequence exists
- route switch away/back does not leave stale replay state mounted
- queued sequence coverage:
  - `move -> move`
  - `project -> move`
  - `rush -> rush`
- authoritative divergence cancels or rebuilds stale replay safely
- final board lands on the exact latest live snapshot only after the final replay frame completes

### E2E

- `project` proof:
  - first visible replay frame is the decorated created piece with plus badge
  - no visible plain intermediate settled piece
- rush-sequence proof:
  - board does not jump ahead between replayed moves
  - final live board matches latest history/live state
- interaction proof:
  - board is non-interactive during replay
- route/focus proof:
  - hidden/unfocused receipt queues replay
  - replay resumes after focus return without stale replay UI or wrong-board state

## Coverage Bookkeeping

Add a dedicated incoming-replay workflow row to `docs/WORKFLOW_COVERAGE.md` and track:

- success-path E2E
- recovery/failure E2E
- integration variants

Keep this separate from the broader computer-player optimistic-sequencing workflow.

## Assumptions

- The recorded/history overlay is the source of truth for replay preview appearance.
- Removing visible baseline is the simplest way to satisfy the `project` first-frame requirement without extra action-specific UI exceptions.
- The main bug class is architectural desynchronization across controller, shell, runtime, and adapter.
- Movement-style actions still benefit from a visible settle frame; `project` does not.
