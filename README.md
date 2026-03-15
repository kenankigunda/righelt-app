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

Shorthands are case-insensitive (for example: `cp = CP = Cp`).

- `Cp` = commit + push + wait before continuing
- `Cpn` = commit + push + take the next action
- `Opr` = open a PR and give me the link
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

## License

This project is closed-source and proprietary. See `LICENSE`.
