# F-032 Pages/Worker Split Coordination Log

## Coordinator Assumptions

- feature_id: `F-032-pages-worker-split`
- plan_file: `docs/features/F-032-pages-worker-split/plan.yaml`
- integration_branch: `codex/f-032-pages-worker-split-integration`
- max_parallel_streams: `1`
- execution mode: serial implementation on the integration branch

## Stream Graph

- `A1 -> A2 -> A3`

## Status Table

| Stream | Status | Commit | Gate State | Notes |
|---|---|---|---|---|
| A1 | completed | working tree | pass | `apps/api` owns API + DO runtime |
| A2 | completed | working tree | pass | Pages proxy replaces combined `_worker.js` |
| A3 | completed | working tree | pass | CI/CD, dev scripts, runbooks, and feature docs updated |

## Stream Reports

### A1
Progress:
- Added `apps/api` Worker entrypoint and Wrangler config.
- Moved D1 and `GAME_ROOMS` ownership into the dedicated Worker runtime.
- Added Worker-entry regression tests and split-stack integration coverage.

Validation:
- `pnpm typecheck` -> pass
- `pnpm test:api-handler` -> pass
- `pnpm test:api-worker` -> pass

Blockers:
- None.

Next:
- Run shared acceptance after A2/A3 changes are in place.

### A2
Progress:
- Replaced the Pages advanced-mode `_worker.js` path with a Pages Function proxy for `/api/*`.
- Updated Pages Wrangler config to use config-file mode and `API_SERVICE`.
- Added proxy regression tests for service binding forwarding and local fallback.

Validation:
- `node --test apps/web/test/deploy-config.test.mjs apps/web/test/api-proxy.test.mjs` -> pass
- `pnpm test:web` -> pass

Blockers:
- None.

Next:
- Validate Pages proxy behavior against the dedicated Worker runtime.

### A3
Progress:
- Updated CI, deploy workflow, D1 helper, and local dev scripts for split-stack runtime ownership.
- Added split-stack runbook and feature execution-plan artifacts.
- Updated milestone and D1 checklist docs to reflect `apps/api` ownership.

Validation:
- `pnpm test:engine` -> pass
- `pnpm test:web` -> pass
- `.github/workflows/deploy.yml` updated for split-stack migration + deploy order
- `docs/RIGHELT_PAGES_WORKER_SPLIT_RUNBOOK.md` added

Blockers:
- None.

Next:
- Ready for commit/review on the integration branch.
