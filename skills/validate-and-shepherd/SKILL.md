---
name: validate-and-shepherd
description: Validate local app changes or ordered PR sets with hosted visual evidence, repair source PRs, monitor readiness, and process the user's email merge authorizations. Use for integrated test passes, end-to-end evidence, or shepherding PRs to merge-ready.
---

# Validate and shepherd

Use the dedicated released `righelt-validation-tools` checkout, pinned to a merged revision. Resolve the candidate separately and pass `--candidate /absolute/path` to the released CLI. Paths to skill references and harness files belong to the released checkout; product reads and repairs belong to the explicit candidate. Never run a branch-local skill as the released policy or modify another task's dirty worktree. See `references/distribution.md`.

## Startup

1. Read repository AGENTS.md and `references/workflow.md`. Select local or integrated mode from the request.
2. Read the user-local `~/.config/righelt/validation.json` (or RIGHELT_VALIDATION_CONFIG). If recipient is missing, ask **upfront**, then persist it with `node scripts/validation/cli.mjs configure --recipient EMAIL`. An explicit no-email choice permits `--no-email` for that run.
3. Check available email connector and signed-in profile. Report unavailable email upfront; continue with task notices. Never guess a recipient. Do not place recipient settings in Git or public artifacts.
4. Resolve requested PRs, product goals, dependency order and exact heads. Ask only when material ambiguity cannot be resolved from repository evidence.
5. Follow the released `docs/ai/PR_WORKFLOW.md`: one canonical feature PR receives implementation and repair commits. Use squash by default; rebase only when explicitly chosen. GitHub merge-commit merging is disabled. Preserve all existing merge authorization gates.

## Authority and autonomy

A request to shepherd PRs authorizes narrow fixes, regression tests, review, commits, and safe pushes to those source PRs. Resolve routine bugs, test races, configuration errors, merge conflicts and compatible integration problems directly. Continue unaffected work while blocked.

Ask only for significant product decisions or structural changes: conflicting goals, changed requirements, major architecture, incompatible contracts or destructive migrations. Investigate first and present a concrete recommendation. Do not weaken tests, bypass protection, force-push, or expand product scope to obtain green checks.

Merging requires explicit chat authorization or a verified email command under `references/email.md`. Report review completion is personal progress, never merge authorization. Reopening a previously merged PR does not restore its consumed authorization.

## Execute and inspect

- Local: `node scripts/validation/cli.mjs local --candidate /absolute/path --base origin/main`. Integrated: `node scripts/validation/cli.mjs integrated --candidate /absolute/path --manifest FILE --out RUN_DIRECTORY`. Invoke these from the released tools checkout.
- GitHub operations, including integrated runner invocations that fetch GitHub, require scoped outside-sandbox execution from the outset. Keep credentials in the OS keyring.
- Validate behavior introduced by each stage and affected adjacent contracts. Reuse compatible baseline, current-head CI and unchanged upstream evidence with explicit provenance; do not repeat the full cumulative matrix at every intermediate checkpoint. Finish with the required integrated and retained-state proof. The runner records evidence but does not replace judgment. Mark unmapped affected areas as gaps.
- Curate representative screenshots for changed surfaces at required sizes and states. Inspect every selected original, including failures; avoid reviewing unchanged duplicates. Keep all raw artifacts private and retain the report selection provenance. Record findings with `node scripts/validation/cli.mjs review --run RUN_JSON --stage stage-N --note FINDINGS`; then republish. Do not mark unseen screenshots reviewed.
- Repair source PRs and rebuild aggregates from those sources. An integration-only repair is never readiness proof.
- Preserve worktrees and checkpoint history. On failure read private logs and repair; the command returning nonzero is not a reason to end the task.
- Use one bounded independent review of the coherent diff and evidence for browser behavior, accessibility, timing, merge authorization, or test validity. Re-review only changed findings or newly affected contracts after a repair; do not restart an unchanged full review. The Lead owns final acceptance.

## Monitor and deliver

When updating a PR, follow [AGENTS.md §6.2](../../AGENTS.md#62-pr-writing). Refresh What was validated with the behaviors checked, methods, results, revision, and gaps. In Additional evidence, link both the immutable report and stable review page, clearly labeling partial or stale evidence. If publication is pending, blocked, or not applicable, say why. Preserve the product rationale and refresh diff links after source repairs. Missing evidence alone does not prevent review or waive readiness gates.

Read `references/email.md` for setup, digest batching, verified reply processing and the five-minute heartbeat. Use the app's automation tool, not an ad-hoc daemon. Create or resume a heartbeat only when scheduling is explicitly requested. Respect a paused schedule: record it and do not resume it implicitly when validating or replying. Reuse a matching automation, keep it quiet when unchanged, and stop it when tracked PRs are merged, closed or removed.

Each handoff and digest identifies each PR's current revision, readiness, authorization, waiting conditions, next owner/action, immutable evidence URL, and stable review URL. No readiness claim before all required gates and independent review pass. Missing external permissions or mandatory human review remain explicit blockers. Never infer CI success from local results.

## Separate decisions

- **Ready for review:** a coherent current diff, applicable checks and curated evidence are available for independent review; clearly list any unresolved acceptance questions.
- **Ready to merge:** current code/integration evidence, required CI/reviews, dependency order, repository-allowed method and explicit merge authorization all pass. A ready report is not merge authorization.
- **Ready to activate:** deployed configuration, provider/resource evidence, canary and cutover/rollback requirements pass, with separate explicit deployment/activation authority. Local tests and a code merge do not establish this state. Report operational blockers separately; do not silently waive a mandatory release criterion or treat an implementation override as a release waiver.

Missing CI is unknown by default. `not-applicable` requires recorded exact-head/base inspection of workflow filters and applicable required-check rules, with retained primary sources and no required checks. An observed failed/pending check is never waived by that record. Preserve historical run results; record new evidence and its precise scope rather than rewriting a failed run as passed.
