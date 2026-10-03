# Execution contract

## Commands and artifacts

The runner uses its own pinned harness checkout for responsive proof and report tests, while executing the candidate checkout's own full test commands and local stack. This allows validating a base that predates the tooling without copying code into it. Publishing uses Wrangler from the pinned harness, so the invoking checkout does not need publishing dependencies. Record harnessRevision and harnessFingerprint separately from candidate revisions; changes to either invalidate evidence. Keep the harness checkout unchanged during a run. If a stream changes user-facing contracts, extend the harness coverage and rerun affected stages; do not hide incompatibility.

```
pnpm validate:local --base origin/main
pnpm validate:integrated --manifest /absolute/manifest.json --out /absolute/run-directory
pnpm validate:integrated --manifest /absolute/manifest.json --out /absolute/run-directory --resume
pnpm validate:local --resume /absolute/run-directory/run.json
pnpm validate:publish --run /absolute/run-directory/run.json
```

An integrated manifest has `version: 1`, `repository: "owner/repo"`, `base: "main"`, and ordered `prs: [{"number":123,"dependsOn":[]},{"number":124,"dependsOn":[123]}]`.

Run files and raw logs live under ignored test-results. Only site/ is publishable. The main manifest records private coordination state; never upload it wholesale. Report source includes a deliberately allowlisted public projection.

A shared exclusive lock prevents two validation stacks from occupying port pair 9888/9887. A conflicting server is an error, never silently reused. Inspect lock owner before clearing an abandoned lock; never kill another run.

## Coverage and repairs

At each baseline/merge point, run the full checks, fresh database lane, and retained-state upgrade lane. Verify previous-stage synthetic identity, game, role and history. Add account or schema-specific continuity assertions whenever a stream introduces those capabilities. Login is not proven by a legacy anonymous identity check.

When the candidate defines `test:e2e:auth`, the runner also executes that candidate-owned suite in a separate Auth E2E lane and preserves its failures and artifacts. This supplements guest journeys; it does not establish retained-account migration proof. Add contract-aware account continuity and responsive login assertions when those features change.

`tools/t108-feasibility/` is known private probe tooling. Run its dedicated harness/runtime/preflight checks and assess its documented deployed-evidence gate separately; mapping it as tooling does not waive that gate or prove account behavior. Unknown `tools/` paths remain coverage gaps.

The default proof journey covers creation, moves, viewer sync, reload and reconnection. The full E2E suite covers history and adjacent flows. For each touched surface add meaningful capture checkpoints to the responsive proof suite, including a component close-up and viewport context at all three sizes. Add missing accessibility, focus, geometry, loading/error and interaction assertions; never mistake images for assertion coverage. Target stable snapshots only when visual appearance itself is a requirement.

Classify failures from primary logs: product regression, invalid/racy assertion, environment mismatch, infrastructure/deployment. Reproduce the smallest case against the matching build; add failing-first coverage for real bugs. Fix synchronization instead of masking races with sleeps or broad retries. Validate the failing case, affected subsystem and required full pass.

Use separate source repair worktrees. Fetch before pushing; preserve concurrent commits without force-pushing. Fix ownership follows the earliest source PR requiring the change. Rebuild from current source heads after repair. Record conflict decisions, tests and scope in the manifest findings. If material decisions are needed, ask with a recommendation and continue unaffected work.

Inspect PR required checks and review rules using GitHub metadata. A missing check result is unknown, not passed. Verify configured preview jobs, URLs and actual current artifact; distinguish deployment success from inspection. Require independent review for timing, accessibility, responsive UI, deployment, authorization or test-validity changes.

## Readiness

Refresh each PR record with checks/review (`passed`, `pending`, `failed`), preview (`passed`, `pending`, `failed`, or verified `not-configured`), conflicts boolean, open/draft flags and waitingFor prerequisite numbers. Record the provenance URLs and head for every gate. The stage must have matching head/base, passed checks, no coverage gaps and actual agent visual inspection.

Use four statuses: merge-ready; validated but waiting on prerequisites; not merge-ready; unverified/stale. Include next action and owner. Local tests alone never establish PR readiness. Recheck remote base and PR heads at handoff and before merging.

After a real merge, rebuild the next stage against actual remote base (including squash/rebase effects). Preserve the completed run and its notification/authorization history. Create the next manifest/run for the remaining open PRs, removing already merged prerequisites from the ordered list only after verifying their actual merge commits; record those settled prerequisites and the prior run path in the new run's coordination metadata. Transfer still-active authorization and tracked report conversations under the run lock; never transfer consumed authorizations. If no open PRs remain, stop monitoring. Do not reuse a simulated tree solely because it looked similar.
