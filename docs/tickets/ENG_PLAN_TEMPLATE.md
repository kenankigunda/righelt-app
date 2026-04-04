# Eng Plan: t-### — Title

## Architecture Overview
<!-- High-level description of the technical approach.
     Identify which packages/modules are affected and how they interact.
     Note any new abstractions, contracts, or boundaries being introduced. -->

## Approach & Tradeoffs
<!-- For non-trivial features: describe the options considered and why this approach was chosen.
     For bugs or improvements where the approach is clear: state so with a one-line rationale. -->

## Implementation Plan

<!-- One entry per subtask. Each subtask maps to a backlog child task (t-###.NN).
     Keep each subtask to a scope achievable in a single Eng session. -->

### t-###.01 — Subtask title
- **Scope**: what this subtask delivers
- **Worktree**: `../righelt-t-###-01`
- **Branch**: `codex/t-###-01`
- **Depends on**: (none, or list of sibling subtask IDs)
- **Acceptance checks**:
  - `pnpm ...`
- **Test plan rows covered**: (row IDs from test-plan.md)

### t-###.02 — Subtask title
<!-- repeat pattern -->

## WIP Limit
<!-- Maximum number of Eng subtasks that may run in parallel.
     Consider merge conflict risk, shared module contention, and review bandwidth.
     Default: match max_parallel_streams from ORCHESTRATION_WORKFLOW.md (≤3). -->
Max parallel: N

## Validation Gates

### Per-subtask
<!-- Each subtask's acceptance checks act as its gate.
     List any additional integration checks that must pass before merging. -->

### End-to-end (post-merge)
<!-- Commands that must pass after all subtasks are merged.
     These are the shared_acceptance checks run by the Lead before final Tester validation. -->
- `pnpm test`

## Remaining Risks
<!-- Known unknowns, edge cases not yet fully designed, or dependencies on external changes.
     List anything the Tester should pay extra attention to in the final validation pass. -->

## References
- Spec: `docs/tickets/t-###/spec.md`
- Test plan: `docs/tickets/t-###/test-plan.md`
- Testing strategy: `docs/TESTING_STRATEGY.md`
- Workflow coverage: `docs/WORKFLOW_COVERAGE.md`
- Orchestration (if multi-stream): `docs/features/<feature-id>/plan.yaml`
