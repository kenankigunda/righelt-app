---
name: orchestrator
description: Coordinate coordinator-led feature execution across a variable number of parallel worktree streams using a plan manifest, explicit acceptance checks, dependency-aware scheduling, and controlled merge gates. Use when a feature needs to be split into multiple substreams/subagents and merged safely based on acceptance criteria.
---

# Orchestrator Skill

`PR validation` over the exact `pr-gate` profile is the only blocking CI aggregate. `Full validation` is retired and must not be awaited. Broad `nightly-full` results are advisory: failed, pending or missing nightly evidence does not independently block review, merge or deployment. Keep explicit feature acceptance, independent review, authorization, retained-state proof and deployed-identity verification separate. Investigate confirmed product defects without restoring a blanket full-suite gate.

## Overview

Drive feature delivery as a coordinator over N streams, where N is defined by the execution plan. Read a plan manifest, initialize stream worktrees, run a tight orchestration loop, and merge streams only when dependency and acceptance gates pass.

## Inputs

Require these inputs before execution:
- `feature_id` (example: `F-027`)
- `plan_file` (example: `docs/features/F-027/plan.yaml`)
- `integration_branch` (default: current branch unless user specifies)
- `max_parallel_streams` (default from plan, else `3`)

If the user provides only a high-level request, infer these values and state assumptions.

## Workflow

1. Validate plan manifest
- Read the manifest schema in `references/plan-manifest.md`.
- Fail fast for:
  - duplicate stream ids
  - undefined `depends_on` entries
  - dependency cycles
  - missing acceptance checks

2. Materialize stream briefs
- For each stream, create/update `docs/features/<feature_id>/streams/<stream-id>.md`.
- Include: scope, non-goals, deliverables, required tests, acceptance checklist, dependency notes.

3. Initialize worktrees and branches
- For each stream, create or reuse:
  - worktree path from manifest (or default `../righelt-<feature_id>-<stream-id>`)
  - branch name from manifest (or default `codex/<feature_id>-<stream-id>`)
- Never delete existing worktrees unless user explicitly asks.

4. Schedule and dispatch
- Determine runnable streams: `status == pending` and all dependencies merged.
- Run up to `max_parallel_streams`.
- Assign one subagent per runnable stream with only its stream brief and shared acceptance constraints.

5. Enforce reporting contract
- Require each stream update in this format:
  - `Progress:`
  - `Validation:`
  - `Blockers:`
  - `Next:`
- Reject updates that do not include concrete validation evidence.

6. Gate merges
- A stream is mergeable only when:
  - its acceptance checks pass
  - dependencies are already merged
  - conflicts are resolved and regression checks pass
- Merge in dependency/topological order, not completion timestamp order.

7. Maintain coordination log
- Maintain `docs/features/<feature_id>/coordination-log.md` with:
  - stream status
  - commit SHA per stream
  - acceptance gate state
  - merge decisions and blockers

## Decision Rules

- If plan size is unknown, propose an initial split and record why.
- If dependencies are dense, reduce parallelism to lower merge churn.
- If streams are independent and tests are stable, increase parallelism up to cap.
- If a stream repeatedly fails gates, pause it and proceed with independent streams.

## Resources

- Manifest schema and example: `references/plan-manifest.md`
- Bootstrap helper: `scripts/bootstrap_orchestration.py`

Use the bootstrap helper to scaffold a manifest and stream docs quickly:

```bash
python3 scripts/bootstrap_orchestration.py --feature-id F-027 --streams api,engine,ui
```

Then run coordination against `docs/features/F-027/plan.yaml`.

## Output Contract

When executing this skill, always produce:
1. Coordinator assumptions
2. Current stream graph and parallel set
3. Gate status by stream
4. Next orchestration actions

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Within the authorized delivery order, implement, review, push and run CI for the next change while the preceding merge is in main CI or deployment verification. Only the next merge waits for required verification of the preceding deployment. Serialize local heavy jobs through the resource queue and preserve any explicit user wait command. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.
