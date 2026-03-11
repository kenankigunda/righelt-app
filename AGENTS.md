# AGENTS.md

This file defines repo-specific operating rules for AI coding agents working in `/Users/kenankigunda/Documents/righelt`.

## 1) Core Principles

- Optimize for safe, incremental delivery over heroic one-shot changes.
- Keep changes scoped to the user request and current feature plan.
- Prefer explicit acceptance criteria, deterministic commands, and auditable logs.
- Do not silently change conventions; propose first when in doubt.

## 2) Skills Contract

- Skills are turn-scoped. Re-mention required skills in each turn where they should apply.
- Use `$orchestrator` for coordinator-led, multi-stream feature development.
- If a referenced skill is missing or unreadable:
  - state the issue briefly
  - continue with best-effort fallback using these AGENTS rules
  - avoid blocking unless the missing skill is strictly required

## 3) Feature Orchestration Standard

For non-trivial features split into multiple streams, use this structure:

- `docs/features/<feature-id>/plan.yaml` (source of truth)
- `docs/features/<feature-id>/streams/<stream-id>.md` (stream briefs)
- `docs/features/<feature-id>/coordination-log.md` (orchestration ledger)

### `plan.yaml` minimum fields

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

### Plan validation rules

- stream ids must be unique
- all dependencies in `depends_on` must exist
- no dependency cycles
- each stream must define at least one acceptance check

## 4) Worktree and Branch Conventions

- Worktree path convention: `../righelt-<feature-id>-<stream-id>`
- Branch convention: `codex/<feature-id>-<stream-id>`
- Reuse existing matching worktrees/branches when possible.
- Never delete worktrees or branches unless the user explicitly asks.

## 5) Coordinator Execution Loop

For each cycle:

1. Identify runnable streams (`pending` + dependencies merged).
2. Dispatch up to `max_parallel_streams`.
3. Collect updates and validation evidence.
4. Recompute stream graph + ready set.
5. Evaluate merge gates and merge eligible streams.
6. Update `coordination-log.md`.

## 6) Subagent Reporting Contract

Require each stream update to use this exact shape:

- `Progress:`
- `Validation:`
- `Blockers:`
- `Next:`

Validation must include concrete command evidence (what was run and result status).

## 7) Merge Gates and Order

A stream is mergeable only when:

- all stream `acceptance_checks` pass
- all `depends_on` streams are already merged
- relevant shared/integration checks pass
- conflicts are resolved

Merge by dependency/topological order, never by completion timestamp alone.

## 8) Testing Policy

- Run only tests relevant to touched packages during stream work.
- Run required shared acceptance checks before final integration.
- If tests cannot run, state why and what remains unverified.
- Prefer deterministic, non-watch test commands in agent execution.
- Every stream must add and/or extend a comprehensive test set for its spec-covered subset, with explicit regression-focused assertions.
- Stream test plans must map expected behavior to source references (spec sections, test matrix rows, and identified gaps requiring new tests).
- Validated correctness is a hard gate: do not advance a stream to the next development step until required tests for the current step pass.
- During multi-stream execution, the coordinator owns cross-stream test conflict resolution and final end-to-end correctness validation against desired behavior.


## 9) Git Safety and Change Hygiene

- Never use destructive git/file operations unless explicitly requested.
- Do not revert unrelated user changes in a dirty tree.
- Prefer non-interactive git commands.
- Keep commits/changes scoped by stream and acceptance criteria.
- Record merge decisions and notable conflict resolutions in the coordination log.

## 10) Communication Expectations

- State assumptions explicitly when inputs are incomplete.
- Before substantial edits, summarize intended action briefly.
- Report blockers early with concrete next options.
- Keep status updates concise and operational.

## 10.1) Team Shorthand

Shorthands are case-insensitive (for example: `cp = CP = Cp`).

- `Cp` = commit + push + wait before continuing
- `Cpn` = commit + push + take the next action
- `Dd` = do a deep investigation to understand holistically, give your diagnosis, and propose a change; wait before implementing
- `Dfix` = diagnose and fix
- `Ddfix` = do a deep investigation to diagnose and fix holistically
- `Sb` = switch branch; expects either an explicit branch name or a description that can be used to infer the intended branch
- `Snb` = switch to a new `codex/` branch whose name is auto-derived from the most recent non-`main` changes in flight; reuse the active feature/topic slug when clear, otherwise derive a short descriptive slug from the latest branch/commit context and append a disambiguating suffix if needed
- `Sbtb` = switch back to this branch
- `Audit branches` = run the detailed branch audit workflow in `docs/BRANCH_AUDIT_WORKFLOW.md` and update `docs/BRANCH_AUDIT.md`
- `Aubr` = `Audit branches`
- `Cleanup branches` = rerun `Audit branches` first, including updating `docs/BRANCH_AUDIT.md` when the audit changes, and stop if the refreshed audit differs from the previous audit, reporting the difference; never modify `main`; before any local-only branch deletions, update `docs/REMOTE_ONLY_BRANCH_SUMMARIES.md` as needed for branches that will remain remote-only; then delete `(a)` branches from local and remote, delete `(d)` branches from local only, delete `(e)` branches from remote only, and remove summary entries from `docs/REMOTE_ONLY_BRANCH_SUMMARIES.md` after confirming the corresponding remote branches were deleted
- `Clbr` = `Cleanup branches`
- `Rbom` = rebase on latest origin main
- `Fp` = force push (`--force-with-lease`)
- `Mmp` = merge to main and push

## 11) Default Kickoff Template

When starting a coordinated feature:

1. Confirm `feature_id`, `plan.yaml`, and integration branch.
2. Validate plan schema/rules.
3. Ensure each stream brief includes a comprehensive spec-mapped test plan (including gap tests) and explicit per-step correctness gates.
4. Ensure worktrees/branches exist.
5. Start coordinator loop with current ready streams.

## 12) Scope of This File

- These rules are repo defaults.
- Direct user instructions take precedence.
- System/developer constraints still apply above this file.
