# Plan Manifest

Use `docs/features/<feature_id>/plan.yaml` as the source of truth.

## Schema

```yaml
feature_id: F-027
integration_branch: main
max_parallel_streams: 3
shared_acceptance:
  - pnpm test
streams:
  - id: api
    goal: "Add new endpoint contracts"
    worktree: "../righelt-F-027-api"
    branch: "codex/F-027-api"
    depends_on: []
    acceptance_checks:
      - "pnpm --filter @righelt/api-handler test"
    agent_profile: "backend"
  - id: engine
    goal: "Implement engine changes"
    worktree: "../righelt-F-027-engine"
    branch: "codex/F-027-engine"
    depends_on: ["api"]
    acceptance_checks:
      - "pnpm --filter @righelt/game-engine test"
    agent_profile: "engine"
```

## Rules

- Keep `id` unique and short.
- Use only known stream ids in `depends_on`.
- Keep `depends_on` acyclic.
- Include at least one acceptance check per stream.
- Set `max_parallel_streams` to a safe default for test/runtime capacity.

## Merge Eligibility

A stream can merge only if:
- all `acceptance_checks` pass
- all dependency streams listed in `depends_on` are merged
- shared acceptance checks pass after integration
