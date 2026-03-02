# F-030 Shell Implementation Orchestration Plan (Web App Spec)

Status: Planning only. No stream execution has been started.

## 1. Objective

Implement the web application shell so behavior matches `docs/RIGHELT_WEB_APP_SPEC.md` Sections 1-15, while preserving board-implementation independence via the board adapter contract.

This plan uses the `$orchestrator` model: coordinator-led parallel streams, explicit dependencies, acceptance gates, and controlled merge order.

## 2. Coordinator Assumptions

1. `feature_id`: `F-030-shell`
2. Planned manifest path (to be created at execution kickoff): `docs/features/F-030-shell/plan.yaml`
3. Integration branch: current feature branch (for this planning phase) is `codex/f-030-shell-orchestration-plan`; execution integration branch will be created at kickoff (proposed: `codex/f-030-shell-integration`).
4. Max parallel streams: `3` (adjusted dynamically down when conflict churn is high).
5. Current baseline: `apps/web` is an engine playground harness, so shell capabilities must be built as additive modules and then wired into routing/app bootstrap.

## 3. Delivery Strategy

1. First establish shell foundation (routing, app state, API client contracts, adapter boundaries).
2. Layer end-user flows (home, game, join/role decisions, history/live behavior, presence, notifications).
3. Add tutorial + playground/offline behavior and startup-path performance constraints.
4. For every stream, add comprehensive spec-driven tests for its subset and explicit regression protections before considering stream completion.
5. Harden with deterministic tests and shared acceptance checks before integration merge.

## 4. Proposed Stream Graph

### Stream S1: Shell Foundation + Routing
- Goal: Build app-shell composition and route model for home/game/tutorial surfaces.
- Scope:
  - Introduce shell-level module boundaries (router, session identity, shell store, API client facades).
  - Keep board integration exclusively through adapter contract.
  - Add first-render bootstrap path with fast-start constraints.
  - Add/expand foundational routing and shell-state tests mapped to relevant spec sections and identified baseline gaps.
- Depends on: none
- Initial acceptance checks:
  - `pnpm --filter @righelt/web test`
  - `pnpm --filter @righelt/web typecheck`

### Stream S2: Home + Game Shell UX (Identity, Join, Presence, History, Notifications)
- Goal: Implement core product flows (Sections 2-9, 11, 13) in shell UX.
- Scope:
  - Home list + preview board integration.
  - Invite/open game routing and join decision surfaces.
  - Role restoration/rejoin logic, presence indicators, prompts/notifications.
  - History sidebar + live return controls.
  - Add comprehensive flow tests for Sections 2-9, 11, 13 plus targeted regression tests for join/presence/history race edges.
- Depends on: `S1`
- Initial acceptance checks:
  - `pnpm --filter @righelt/web test`
  - `pnpm --filter @righelt/web test -- history`
  - `pnpm --filter @righelt/web test -- join`

### Stream S3: Tutorial + Playground/Offline Shell Behavior
- Goal: Implement Sections 10 and 12 (+ 12.1) behavior in shell.
- Scope:
  - Tutorial trigger policy and completion persistence.
  - Tutorial replay/restart control from game page.
  - Offline playground startup, local persistence, offline indicator and action restrictions.
  - Controlled `Go online` transition flow.
  - Add comprehensive tests for Sections 10 and 12/12.1, including offline persistence, reconnect transitions, and policy guards.
- Depends on: `S1`
- Initial acceptance checks:
  - `pnpm --filter @righelt/web test -- tutorial`
  - `pnpm --filter @righelt/web test -- offline`

### Stream S4: API/Edge Contracts + Fast-Start Compliance
- Goal: Align shell startup endpoints/caching/import surfaces with Section 15.
- Scope:
  - Startup/bootstrap endpoint determinism and cache semantics.
  - no-store safety for mutable endpoints.
  - startup import hygiene (no barrel imports on startup path).
  - tests for deterministic bootstrap payload and cache headers.
  - Add coverage for known startup-path gaps and regression tests for cache contract/import-surface violations.
- Depends on: `S1`
- Initial acceptance checks:
  - `pnpm test:api-handler`
  - `pnpm --filter @righelt/web test -- bootstrap`

### Stream S5: Integration Hardening + End-to-End Acceptance
- Goal: Validate cross-stream behavior and close gaps before merge to main.
- Scope:
  - Cross-flow regression tests for Flows 1-8.
  - Resolve integration conflicts and normalize shell state transitions.
  - Final acceptance + evidence packaging.
  - Reconcile overlapping stream tests and ensure the combined suite proves end-to-end correctness against desired behavior.
- Depends on: `S2`, `S3`, `S4`
- Initial acceptance checks:
  - `pnpm --filter @righelt/web test`
  - `pnpm test:api-handler`
  - `pnpm test:engine`

## 5. Orchestration Stages and What to Expect

Progression gate for all stages:
1. Validated correctness is mandatory to move forward.
2. For each active stream step, implementation work is not considered complete until its required spec-mapped tests pass.
3. If spec or matrix gaps are found, new tests must be added before progression.

## Stage 0: Kickoff Artifacts (No Product Behavior Changes)
Expected coordinator outputs:
1. `docs/features/F-030-shell/plan.yaml` created and validated (unique ids, no cycles, deps valid).
2. Stream briefs under `docs/features/F-030-shell/streams/*.md`.
3. `docs/features/F-030-shell/coordination-log.md` initialized.
4. Worktrees/branches created or reused per stream (`../righelt-F-030-shell-<stream>` and `codex/F-030-shell-<stream>` convention).

Async manual validation pass (non-blocking):
1. Confirm artifacts exist and are coherent:
   - `rg --files docs/features/F-030-shell`
   - `cat docs/features/F-030-shell/plan.yaml`
2. Confirm dependency graph and acceptance commands are explicit.
3. Confirm stream briefs have: scope, non-goals, deliverables, required tests, acceptance checklist.

## Stage 1: Foundation Build (S1)
Expected coordinator outputs:
1. Shell architecture committed with clear module boundaries.
2. Routing skeleton for home/game/tutorial surfaces active.
3. Existing playground board remains mountable through adapter contract.
4. Initial comprehensive tests for routing/bootstrap shell state pass, including newly added regression coverage for identified gaps.

Async manual validation pass (non-blocking):
1. Run app locally and verify route transitions:
   - home -> game -> tutorial deep links resolve without fatal errors.
2. Confirm no board-internal imports leak into shell modules.
3. Review S1 stream report shape (`Progress/Validation/Blockers/Next`) and validation evidence.

## Stage 2: Parallel Feature Streams (S2 + S3 + S4)
Expected coordinator outputs:
1. S2 delivers core shell UX (join, presence, history/live, notifications, home list/preview).
2. S3 delivers tutorial and offline playground shell policies.
3. S4 delivers endpoint cache/import/startup compliance with tests.
4. Each stream produces spec/matrix coverage evidence plus gap-driven new tests before being considered mergeable.
5. Coordinator keeps merge order dependency-safe and logs all gate decisions.

Async manual validation pass (non-blocking):
1. Validate one user-facing path from each stream independently:
   - S2: open game as viewer, request join as player, verify role-dependent prompts.
   - S3: switch network offline, verify offline indicator + disabled remote join/invite actions.
   - S4: inspect bootstrap endpoint response headers and deterministic payload behavior.
2. Review per-stream PR/commit evidence without waiting for all streams to finish.

## Stage 3: Integration + Regression Closure (S5)
Expected coordinator outputs:
1. Cross-stream conflicts resolved with documented rationale.
2. Cross-stream test conflicts resolved to match desired end behavior.
3. Shared acceptance checks green on integration branch.
4. Shell behavior mapped against spec sections with explicit pass/fail evidence.

Async manual validation pass (non-blocking):
1. Use a concise checklist run against deployed preview/local integration build:
   - Flows 1-8 manually exercised.
   - Presence and history/live state transitions confirmed.
   - Tutorial first-run and replay behavior confirmed.
   - Offline playground launch + reload restoration confirmed.
2. Confirm coordination log includes final gate table and merge order used.

## Stage 4: Release Readiness
Expected coordinator outputs:
1. Final merge recommendation with residual risks and deferred items.
2. Test evidence references for all required acceptance checks.
3. Clear rollback scope (files/modules touched by shell feature only).

Async manual validation pass (non-blocking):
1. Sanity-review release note / change summary for scope control.
2. Spot-check fast-start constraints were explicitly tested (cache headers + deterministic bootstrap).

## 6. Merge Gates and Order

A stream is mergeable only if:
1. Stream acceptance checks pass.
2. Dependencies are already merged.
3. Shared acceptance checks are green on integration branch.
4. Stream has added and passed comprehensive, spec-subset regression tests (including gap tests where needed).
5. No unresolved conflicts remain.

Planned merge order:
1. `S1`
2. `S2`, `S3`, `S4` (dependency-safe order based on readiness)
3. `S5`

## 7. Shared Acceptance Suite (Execution Phase)

These are the baseline integration checks the coordinator will enforce before final merge:
1. `pnpm --filter @righelt/web test`
2. `pnpm test:api-handler`
3. `pnpm test:engine`
4. Any newly added shell-spec acceptance checks introduced in streams (must be listed in `plan.yaml`).
5. Combined end-to-end correctness suite proving intended behavior after cross-stream test reconciliation.

## 8. Reporting and Audit Trail

During execution, each stream update must use:
1. `Progress:`
2. `Validation:`
3. `Blockers:`
4. `Next:`

Coordinator log requirements:
1. Current stream status table.
2. Commit SHA per stream.
3. Gate status by stream.
4. Test coverage evidence by spec section/matrix reference, including explicit gap-test additions.
5. Merge decisions and conflict-resolution notes, including cross-stream test expectation reconciliations.

## 9. Risks and Early Mitigations

1. Risk: Shell/board boundary erosion during rapid UI work.
   - Mitigation: Contract guard tests and code review checks in S1/S5.
2. Risk: Route/state race conditions across history/live/tutorial/offline transitions.
   - Mitigation: deterministic state-machine tests in S2/S3.
3. Risk: Startup regressions from new shell bootstrap needs.
   - Mitigation: S4 explicit cache/determinism/import checks required before merge.

## 10. Explicit Non-Execution Statement

This document is planning-only and does not start orchestration execution.
Execution begins only after explicit user confirmation to materialize `plan.yaml`, stream briefs, worktrees, and coordinator loop.
