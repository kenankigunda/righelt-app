# Righelt

This repository is the foundation for the Righelt web app.

## Repository Layout

- `docs/`
  - `RIGHELT_RULES_SPEC.md` (formal source-of-truth game specification)
  - `RIGHELT_WEB_APP_SPEC.md` (formal source-of-truth web app behavior specification)
  - `RIGHELT_ENGINE_TEST_MATRIX.md` (engine acceptance scenarios)
  - `RIGHELT_EXECUTION_PLAN_MILESTONE_2_ENGINE.md` (engine implementation + validation plan)
  - `RIGHELT_PLAYER_RULES.md` (player-facing rules guide)
- `archive/`
  - Archived files from the legacy implementation

## Purpose

- Use the documents in `docs/` as the authoritative rules and validation basis for the rewrite.
- Keep `archive/` intact for historical reference only.

## AI Workflow (Agents + Skills)

- Repo-level agent rules live in `AGENTS.md`.
- Use `$orchestrator` for coordinator-led feature development across multiple worktrees/streams.
- Skills are **turn-scoped**: mention `$orchestrator` in each request where you want it applied.

### Coordinated Feature Files

For orchestrated features, use:

- `docs/features/<feature-id>/plan.yaml` (source of truth for stream graph and acceptance checks)
- `docs/features/<feature-id>/streams/<stream-id>.md` (per-stream brief)
- `docs/features/<feature-id>/coordination-log.md` (status, gates, merge decisions)

### Team Shorthand

- `Cp` = commit + push + wait before continuing
- `Cpn` = commit + push + take the next action

## License

This project is closed-source and proprietary. See `LICENSE`.
