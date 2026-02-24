# Milestone 2 - Worktree C Checkpoint 4 Hardening

Status: In progress track hardening checklist for `codex/engine-validation-ui`.

## Scope Snapshot

- Track C owned scope:
  - Matrix `M` (`M-001..M-004`)
  - `P-005` client/server deterministic parity harness
  - Full matrix ownership coverage enforcement
  - Manual UI harness + fixture loader UX

## Required Checkpoint 4 Commands

Run in repository root:

1. `pnpm typecheck`
2. `pnpm test:engine`
3. `pnpm test:engine` (repeat run for determinism subset confidence)

Expected:

- All commands exit `0`.
- Repeat engine test run keeps hash-oriented fixture assertions stable.

## Determinism Verification Notes

- Determinism is verified in Track C by:
  - parity fixture runner assertions (`P-005`) comparing server/browser envelopes
  - golden fixture hash assertions for `M-001..M-004`
  - repeated execution of `pnpm test:engine` without output drift

## Matrix Manifest Review Notes

- Enforcement test verifies:
  - no duplicate matrix ownership rows in manifest
  - all matrix sections in `docs/RIGHELT_ENGINE_TEST_MATRIX.md` that define executable IDs are represented
  - owner track values are constrained to `A|B|C`
  - ownership test paths are rooted under `packages/game-engine/test/`

## Manual Smoke Checklist (Engine Playground)

Use `apps/web` Engine Playground for quick manual verification:

1. Initial load:
   - API loads initial state and renders a 10x10 board.
2. Legal/illegal action attempt:
   - Submit `pass` and verify accepted response payload.
   - Submit non-pass action with missing coordinates and verify deterministic rejection payload.
3. Fixture loader:
   - Load each fixture (`M-001..M-004`) and verify board/status populate from fixture state.
4. Fixture replay:
   - Replay each fixture and verify result panel reports expected hash/outcome comparison.
5. Continuation visibility:
   - When replay includes continuation actions (`M-003`), verify continuation status text updates.

## Checkpoint 4 Merge Readiness Summary

- Track C branch should be considered ready to merge at Checkpoint 4 when:
  - command checks above pass on latest integration base
  - matrix ownership and parity tests remain green after rebasing with A/B tracks
  - manual smoke checklist is completed once against rebased integration head
