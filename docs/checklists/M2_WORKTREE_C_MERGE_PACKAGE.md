# Milestone 2 - Worktree C Merge Package (Checkpoint 4)

Branch: `codex/engine-validation-ui`  
Track: `C`  
Purpose: handoff package for final integration merge at Checkpoint 4.

## 1. Track C Ownership Summary

- Matrix IDs directly implemented by Track C:
  - `M-001`
  - `M-002`
  - `M-003`
  - `M-004`
- Parity target owned by Track C:
  - `P-005` (client/server deterministic parity harness)
- Cross-track enforcement delivered by Track C:
  - matrix ownership coverage enforcement tests
  - track-scope/ownership boundary checks
  - manual harness + fixture loader UX

## 2. Files Added/Changed by Track C

Tests and fixtures:

- `packages/game-engine/test/engine.test.config.mjs`
- `packages/game-engine/test/integration/placeholder.integration.test.mjs`
- `packages/game-engine/test/fixtures/golden/M-001.json`
- `packages/game-engine/test/fixtures/golden/M-002.json`
- `packages/game-engine/test/fixtures/golden/M-003.json`
- `packages/game-engine/test/fixtures/golden/M-004.json`
- `packages/game-engine/test/integration/golden-scenarios.test.mjs`
- `packages/game-engine/test/fixtures/parity/P-005.fixture-set.json`
- `packages/game-engine/test/integration/p005-runtime-parity.test.mjs`
- `packages/game-engine/test/integration/matrix-coverage-enforcement.test.mjs`

Manual harness/UI and API integration:

- `apps/web/index.html`
- `apps/web/main.js`
- `apps/web/styles.css`
- `apps/web/fixtures/m-golden-fixtures.json`
- `packages/api-handler/src/index.ts`

Track checklists:

- `docs/checklists/M2_WORKTREE_C_CHECKPOINT4.md`
- `docs/checklists/M2_WORKTREE_C_MERGE_PACKAGE.md`

## 3. Verification Evidence

Executed on this branch:

1. `pnpm typecheck` (pass)
2. `pnpm test:engine` (pass)
3. `pnpm test:engine` repeat run (pass; determinism confidence check)

Key covered assertions:

- `M-001..M-004` fixture corpus presence and contract checks.
- `P-005` parity set existence and runtime-envelope equality assertions.
- Matrix ownership manifest coverage checks (no duplicate matrix ownership rows, no missing executable matrix sections).
- Import-policy guard check for authoritative engine modules.

## 4. Dependencies on Other Tracks (A/B)

- Track C assumes API/contract freeze from Checkpoint 3 remains stable:
  - engine action validation/apply semantics from Track A/B
  - artifact/tie-break schema consistency from Track B contract freeze
- Track C tests and harness are intentionally non-authoritative:
  - no rules logic implemented in UI
  - all rule transitions are routed through shared engine API endpoints

## 5. Checkpoint 4 Merge Instructions

Before merging Track C into integration branch:

1. Rebase Track C on latest integration head that already contains Track A + Track B.
2. Resolve any manifest/test path conflicts with ownership map as source of truth.
3. Re-run:
   - `pnpm typecheck`
   - `pnpm test:engine`
4. Run Engine Playground manual smoke sequence from:
   - `docs/checklists/M2_WORKTREE_C_CHECKPOINT4.md`
5. Merge Track C and execute full milestone hardening gate on integration branch.
