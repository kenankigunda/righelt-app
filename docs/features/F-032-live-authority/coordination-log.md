# F-032 Live Authority Coordination Log

## Coordinator Assumptions
- feature_id: `F-032-live-authority`
- plan_file: `docs/features/F-032-live-authority/plan.yaml`
- integration_branch: `codex/f-032-live-authority-integration`
- max_parallel_streams: `2`
- skill: `$orchestrator`
- backward compatibility: not required

## Stream Graph
- `S1` -> `S2`
- `S1` -> `S3`
- `S2`, `S3` -> `S4`

## Initial Parallel Set
- Cycle 1 runnable: `S1`
- Cycle 2 runnable after `S1` merge: `S2`, `S3`
- Cycle 3 runnable after `S2` + `S3` merge: `S4`

## Status Table
| Stream | Status | Commit | Gate State | Notes |
|---|---|---|---|---|
| S1 | pending | n/a | pending | Foundation contracts, schema, and harness |
| S2 | blocked | n/a | blocked on S1 | Backend GameRoomDO authority |
| S3 | blocked | n/a | blocked on S1 | Frontend live session rewrite |
| S4 | blocked | n/a | blocked on S2,S3 | Integration and end-to-end proof |

## Kickoff Validation
- Manifest validation target:
  - unique stream ids
  - valid `depends_on`
  - acyclic graph
  - at least one `acceptance_check` per stream
- Stream briefs required to include:
  - scope and non-goals
  - deliverables
  - spec-mapped tests
  - gap tests
  - regression focus
  - explicit correctness gate

## Stream Report

### S1
Progress:
- Orchestration kickoff artifact created in plan; stream brief to define the new DO-backed contracts, persistence schema, and harness updates.

Validation:
- Manifest rules verified by inspection against `AGENTS.md` and `$orchestrator` schema.

Blockers:
- None at kickoff.

Next:
- Materialize stream brief and initialize worktree/branch before dispatch.

### S2
Progress:
- Awaiting S1 contract lock before backend implementation dispatch.

Validation:
- Dependency on `S1` documented in manifest and stream graph.

Blockers:
- `S1` must merge first.

Next:
- Prepare backend stream brief and worktree so dispatch can start immediately after S1 merge.

### S3
Progress:
- Awaiting S1 contract lock before frontend implementation dispatch.

Validation:
- Dependency on `S1` documented in manifest and stream graph.

Blockers:
- `S1` must merge first.

Next:
- Prepare frontend stream brief and worktree so dispatch can start immediately after S1 merge.

### S4
Progress:
- Final integration stream defined but intentionally blocked.

Validation:
- Dependencies on `S2` and `S3` documented in manifest and stream graph.

Blockers:
- `S2` and `S3` must merge first.

Next:
- Use as final merge gate once backend and frontend streams are complete.

## Coverage and Correctness Notes
- This feature intentionally deletes the legacy `/api/shell/ws?scope=...` invalidation path and old presence mutation behavior.
- Correctness evidence must prove single-writer authority, live invite/game synchronization, reconnect replay or resync, and removal of fixed invite/game polling.
- Cross-stream conflicts to watch:
  - websocket payload shape vs. frontend reducer expectations
  - D1 projection schema vs. backend replay logic
  - invite-route hydration timing vs. live background session behavior
