# Orchestration Workflow

This document captures the non-default orchestration workflow for coordinated, multi-stream feature execution. Use it just in time when the feature benefits from parallel streams and coordinator-led integration rather than the repo's normal single-stream approach.

## When To Use It

Use this workflow for non-trivial features that are best split into multiple streams with explicit dependencies, isolated worktrees or branches, and coordinated merge gates.

## Skills Contract

- Re-mention required skills in each turn where they should apply.
- Use `$orchestrator` for coordinator-led, multi-stream feature development.
- If a referenced skill is missing or unreadable:
  - state the issue briefly
  - continue with best-effort fallback using the repo's current AGENTS rules
  - avoid blocking unless the missing skill is strictly required

## Feature Orchestration Standard

For non-trivial features split into multiple streams, use this structure:

- `docs/features/<feature-id>/plan.yaml` (source of truth)
- `docs/features/<feature-id>/streams/<stream-id>.md` (stream briefs)
- `docs/features/<feature-id>/coordination-log.md` (orchestration ledger)

### `plan.yaml` Minimum Fields

- `feature_id`
- `integration_branch`
- `max_parallel_streams`
- `shared_acceptance` (list of commands)
- `streams` (list), each with:
  - `id`
  - `goal`
  - `worktree`
  - `branch`
  - `depends_on`
  - `acceptance_checks`
  - `agent_profile` (optional but recommended)

### Plan Validation Rules

- stream ids must be unique
- all dependencies in `depends_on` must exist
- no dependency cycles
- each stream must define at least one acceptance check

## Worktree And Branch Conventions

- Worktree path convention: `../righelt-<feature-id>-<stream-id>`
- Branch convention: `codex/<feature-id>-<stream-id>`
- Reuse existing matching worktrees or branches when possible.
- Never delete worktrees or branches unless the user explicitly asks.

## Coordinator Execution Loop

For each cycle:

0. Output a cycle heartbeat to the user: `[ORCHESTRATION cycle N] active=<stream ids> | merged=<stream ids> | pending=<stream ids>`.
1. Identify runnable streams (`pending` plus dependencies merged).
2. Dispatch up to `max_parallel_streams`.
3. Collect updates and validation evidence.
4. Recompute the stream graph and ready set.
5. Evaluate merge gates and merge eligible streams.
6. Update `coordination-log.md`.

## Subagent Reporting Contract

Require each stream update to use this exact shape:

- `Progress:`
- `Validation:`
- `Blockers:`
- `Next:`

Validation must include concrete command evidence, including what was run and the result status.

## Merge Gates And Order

A stream is mergeable only when:

- all stream `acceptance_checks` pass
- all `depends_on` streams are already merged
- relevant shared or integration checks pass
- conflicts are resolved

Merge by dependency or topological order, never by completion timestamp alone.

## Testing Policy For Orchestrated Work

- Run only tests relevant to touched packages during stream work.
- Run required shared acceptance checks before final integration.
- If tests cannot run, state why and what remains unverified.
- Prefer deterministic, non-watch test commands in agent execution.
- Every stream must add and/or extend a comprehensive test set for its spec-covered subset, with explicit regression-focused assertions.
- Treat regression hardening as a default requirement for every change: run the full relevant test pass, add or extend tests for the changed behavior, cover nearby or adjacent workflows that could be affected, and include edge cases or tricky state transitions that could plausibly regress.
- Stream test plans must map expected behavior to source references such as spec sections, test matrix rows, and identified gaps requiring new tests.
- Validated correctness is a hard gate: do not advance a stream to the next development step until required tests for the current step pass.
- During multi-stream execution, the coordinator owns cross-stream test conflict resolution and final end-to-end correctness validation against desired behavior.

## Git Safety And Change Hygiene

- Never use destructive git or file operations unless explicitly requested.
- Do not revert unrelated user changes in a dirty tree.
- Prefer non-interactive git commands.
- Keep commits and changes scoped by stream and acceptance criteria.
- Record merge decisions and notable conflict resolutions in the coordination log.

## Default Kickoff Template

When starting a coordinated feature:

1. Confirm `feature_id`, `plan.yaml`, and integration branch.
2. Validate the plan schema and rules.
3. Ensure each stream brief includes a comprehensive spec-mapped test plan, including gap tests, and explicit per-step correctness gates.
4. Ensure worktrees and branches exist.
5. Start the coordinator loop with the current ready streams.
