# F-030 Shell Coordination Log

## Coordinator Assumptions
- feature_id: `F-030-shell`
- plan_file: `docs/features/F-030-shell/plan.yaml`
- integration_branch: `codex/f-030-shell-integration`
- max_parallel_streams: `3`
- execution_mode: single-coordinator sequential stream execution with dependency-gated progression

## Stream Graph
- `S1` -> `S2`, `S3`, `S4`
- `S2`, `S3`, `S4` -> `S5`

## Status Table
| Stream | Status | Commit | Gate State | Notes |
|---|---|---|---|---|
| S1 | completed | pending commit | pass | shell foundation + route/bootstrap boundary tests |
| S2 | completed | pending commit | pass | join/presence/history/notification behavior + tests |
| S3 | completed | pending commit | pass | tutorial/offline/playground behavior + tests |
| S4 | completed | pending commit | pass | `/api/shell/bootstrap` startup contract + tests |
| S5 | completed | pending commit | pass | integrated e2e behavior + shared acceptance green |

## Stream Reports

### S1
Progress:
- Replaced monolithic playground entrypoint with shell-oriented routed app structure.
- Added shell modules for routing, bootstrap policy, persistence, tutorial controller, and shell store.
- Kept board integration behind board adapter contract and adapter import surface.

Validation:
- `pnpm --filter @righelt/web typecheck` -> pass
- `pnpm --filter @righelt/web test` -> pass
- `pnpm --filter @righelt/web test -- routing` -> pass
- `pnpm --filter @righelt/web test -- bootstrap` -> pass

Blockers:
- None.

Next:
- Unblock dependent streams S2/S3/S4.

### S2
Progress:
- Implemented home/game shell UX logic in store and UI flow wiring.
- Added join as viewer/player flow handling with approval-required pathway.
- Added participant connection state handling, history selection/live return behavior, and notification event model.

Validation:
- `pnpm --filter @righelt/web test -- join` -> pass
- `pnpm --filter @righelt/web test -- presence` -> pass
- `pnpm --filter @righelt/web test -- history` -> pass
- `pnpm --filter @righelt/web test -- notifications` -> pass
- `pnpm --filter @righelt/web test` -> pass

Blockers:
- None.

Next:
- Feed integrated UX behavior into S5 e2e closure.

### S3
Progress:
- Added tutorial controller behavior and persistence hooks.
- Implemented playground/offline shell policy handling including explicit `Go online` confirmation gate.
- Enforced hiding offline-local games from public/home list until explicit online transition.

Validation:
- `pnpm --filter @righelt/web test -- tutorial` -> pass
- `pnpm --filter @righelt/web test -- offline` -> pass
- `pnpm --filter @righelt/web test -- playground` -> pass
- `pnpm --filter @righelt/web test` -> pass

Blockers:
- None.

Next:
- Feed tutorial/offline behavior into S5 e2e closure.

### S4
Progress:
- Added deterministic startup endpoint `GET /api/shell/bootstrap` in API handler.
- Kept bootstrap payload precomputed at module scope.
- Added explicit cache-policy contract test coverage for shell bootstrap endpoint and web cache expectations.

Validation:
- `pnpm test:api-handler` -> pass
- `pnpm --filter @righelt/web test -- cache` -> pass
- `pnpm --filter @righelt/web test -- bootstrap` -> pass

Blockers:
- None.

Next:
- Feed startup/cache contracts into S5 integration verification.

### S5
Progress:
- Added integrated web-shell e2e test flow spanning create/join/approval/history/offline-go-online path.
- Reconciled cross-stream behavior assertions in the shared store tests and API tests.
- Verified shared acceptance and end-to-end correctness across web/api/engine suites.

Validation:
- `pnpm --filter @righelt/web test -- e2e` -> pass
- `pnpm --filter @righelt/web test` -> pass
- `pnpm test:api-handler` -> pass
- `pnpm test:engine` -> pass

Blockers:
- None.

Next:
- Finalize integration branch commit, push, and open PR for review.

## Merge and Conflict Notes
- No inter-branch merge conflicts occurred due sequential single-coordinator execution.
- Cross-stream test expectation reconciliations were handled by aligning store behavior and e2e assertions around:
  - player join approval policy,
  - history while new moves append,
  - offline-local visibility and explicit go-online confirmation,
  - deterministic startup bootstrap contracts.
