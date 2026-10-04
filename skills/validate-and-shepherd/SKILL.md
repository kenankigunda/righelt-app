---
name: validate-and-shepherd
description: Validate local app changes or ordered PR sets with hosted visual evidence, repair source PRs, monitor readiness, and process the user's email merge authorizations. Use for integrated test passes, end-to-end evidence, or shepherding PRs to merge-ready.
---

# Validate and shepherd

Resolve the repository from the current task. All paths below are relative to this skill's repository; never assume the main checkout or modify another task's dirty worktree.

## Startup

1. Read repository AGENTS.md and `references/workflow.md`. Select local or integrated mode from the request.
2. Read the user-local `~/.config/righelt/validation.json` (or RIGHELT_VALIDATION_CONFIG). If recipient is missing, ask **upfront**, then persist it with `node scripts/validation/cli.mjs configure --recipient EMAIL`. An explicit no-email choice permits `--no-email` for that run.
3. Check available email connector and signed-in profile. Report unavailable email upfront; continue with task notices. Never guess a recipient. Do not place recipient settings in Git or public artifacts.
4. Resolve requested PRs, product goals, dependency order and exact heads. Ask only when material ambiguity cannot be resolved from repository evidence.
5. Follow `docs/ai/PR_WORKFLOW.md`: one canonical feature PR receives implementation and repair commits. Use squash by default; rebase only when explicitly chosen. GitHub merge-commit merging is disabled. Preserve all existing merge authorization gates.

## Authority and autonomy

A request to shepherd PRs authorizes narrow fixes, regression tests, review, commits, and safe pushes to those source PRs. Resolve routine bugs, test races, configuration errors, merge conflicts and compatible integration problems directly. Continue unaffected work while blocked.

Ask only for significant product decisions or structural changes: conflicting goals, changed requirements, major architecture, incompatible contracts or destructive migrations. Investigate first and present a concrete recommendation. Do not weaken tests, bypass protection, force-push, or expand product scope to obtain green checks.

Merging requires explicit chat authorization or a verified email command under `references/email.md`. Report review completion is personal progress, never merge authorization. Reopening a previously merged PR does not restore its consumed authorization.

## Execute and inspect

- Local: `pnpm validate:local --base origin/main`. Integrated: `pnpm validate:integrated --manifest FILE --out RUN_DIRECTORY`.
- GitHub operations, including integrated runner invocations that fetch GitHub, require scoped outside-sandbox execution from the outset. Keep credentials in the OS keyring.
- The runner records evidence but does not replace judgment. Inspect the changed code and adjacent workflows, add missing assertions and component captures, and mark unmapped areas as gaps until resolved.
- Open and inspect actual captured images at every required size. Record findings with `node scripts/validation/cli.mjs review --run RUN_JSON --stage stage-N --note FINDINGS`; then republish. Do not mark unseen screenshots reviewed.
- Repair source PRs and rebuild aggregates from those sources. An integration-only repair is never readiness proof.
- Preserve worktrees and checkpoint history. On failure read private logs and repair; the command returning nonzero is not a reason to end the task.
- Run an independent reviewer/tester for browser behavior, accessibility, timing, merge authorization, or test validity. Resolve findings and re-review.

## Monitor and deliver

Read `references/email.md` for setup, digest batching, verified reply processing and the five-minute heartbeat. Use the app's automation tool, not an ad-hoc daemon. Register one heartbeat per active run, including waiting-for-authorization runs; stop it when tracked PRs are merged, closed or removed. Reuse existing automation on resume. It must remain quiet when state is unchanged.

Each handoff and digest identifies each PR's current revision, readiness, authorization, waiting conditions, next owner/action, immutable evidence URL, and stable review URL. No readiness claim before all required gates and independent review pass. Missing external permissions or mandatory human review remain explicit blockers. Never infer CI success from local results.
