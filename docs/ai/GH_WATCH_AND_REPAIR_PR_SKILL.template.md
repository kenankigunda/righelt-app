---
name: gh-watch-and-repair-pr
description: Monitor a GitHub pull request through CI and preview deployment, investigate every failure from primary logs and artifacts, reproduce it against the matching build, implement and independently review a narrow fix, push safely, and repeat until the current PR head is green and its preview is verified. Use for requests to watch, babysit, stabilize, unblock, diagnose, or continuously repair PR checks and preview deployments across repositories.
---

# Watch and Repair a Pull Request

Drive one PR head from failing or pending checks to current, applicable CI and configured preview evidence. For Righelt, read `__VALIDATION_TOOLS__/skills/validate-and-shepherd/SKILL.md` and invoke the released CLI with an explicit candidate path. Do not substitute a candidate branch's unreleased skill.

Separate ready for review, ready to merge and ready to activate. A code repair request does not authorize merge, deployment, activation, access changes or resuming a paused schedule. Preserve unresolved operational evidence as explicit requirements, without silently expanding a bounded repair into deployment work.

## Resolve the target and authority

1. Resolve the repository, PR number or URL, branch, and deployment provider from the request or current worktree. Use `gh pr view` for the current branch when the user does not provide a PR number.
2. Read repository instructions such as `AGENTS.md`, contributor docs, CI workflows, package scripts, and browser-test configuration before acting.
3. Treat a request to diagnose and fix a PR as authority to edit, test, commit, and push that PR branch. Do not merge the PR, deploy production, change access controls, or discard unrelated work unless explicitly authorized.
4. Inspect `git status --short`, the current branch, remotes, local/remote head SHAs, and existing untracked files. Preserve unrelated and experimental files.

## Run the repair loop

### 1. Establish the monitored head

- Record the PR head SHA and check run URLs.
- Use GitHub check metadata for orientation and `gh run view --log-failed` for Actions diagnosis.
- If checks are pending, monitor them. Pending work is not a failure and is not a blocker by itself.
- Re-read the PR head after every push and whenever checks unexpectedly disappear. A newer head supersedes the old run.

### 2. Diagnose from evidence

- Read the exact failing step, assertion, stack, timestamps, artifacts, screenshots, and traces available for the current head.
- Classify the failure before editing:
  - product or browser behavior regression;
  - invalid, stale, or racy test assertion;
  - CI/build-server mismatch;
  - dependency, runner, credential, or deployment failure.
- Prefer primary logs and repository code over assumptions. Report the concrete root cause, not merely the failing test name.

### 3. Reproduce the CI environment

- Read the workflow and scripts to match CI's build order, environment variables, server mode, browser projects, workers, and timeouts.
- Test the production artifact when CI tests production. Do not substitute a development server.
- Reproduce the smallest failing case first. Repeat intermittent cases enough times to expose the race before changing them.
- Preserve a failing-first regression when the failure represents real behavior. For infrastructure or assertion races, demonstrate why the old assertion is invalid from logs or a local stress run.

### 4. Implement the narrow fix

- Fix the underlying behavior or synchronization point; do not hide hydration, animation, navigation, or deployment failures with broad retries or larger timeouts.
- Assert public behavior rather than incidental engine internals. For transient browser stages, capture related values atomically in the page or synchronize on the operation's actual ready/pending state.
- Keep tests non-vacuous: require expected objects to exist, preserve counts or identities when relevant, and make progress assertions directional when resets or rewinds must fail.
- Update README or contributor setup when tooling, CI order, dependencies, browsers, deployment, or human setup changes.

### 5. Validate in layers

Plan the smallest complete validation scope for introduced behavior and affected contracts. Reuse exact-current-head CI when its platform, configuration and evidence satisfy the same required check; preserve primary job/artifact provenance. Do not repeatedly rerun unaffected cumulative suites. Run the repository's applicable equivalent of:

1. the exact failing test, with bounded repetitions only when needed to establish an intermittent cause;
2. the containing test file or subsystem suite;
3. type checking and lint;
4. unit and integration tests;
5. production build;
6. the affected browser matrix and curated visual checks, then the required final combined checkpoint;
7. Lighthouse or other quality gates.

Keep existing timeout budgets unless evidence proves the product requirement changed. Record pass counts and intentional skips.

Run an independent reviewer/tester pass when repository instructions require it or the change affects browser timing, accessibility, responsive behavior, motion, route exposure, deployment, or test validity. Resolve findings and request a bounded re-review of changed findings. Do not restart an unchanged whole-diff review.

### 6. Commit and push safely

- Re-check status, staged content, `git diff --check`, and the intended file list immediately before committing.
- In shared worktrees, prefer `git commit --only <paths>` so another task's staged files cannot enter the commit.
- Fetch before pushing when concurrent work is possible. Never force-push or overwrite a newer remote head.
- If a concurrent commit lands, verify whether the fix remains in the new head's ancestry and integrate safely. Re-run relevant tests for combined changes.
- Push the scoped commit to the existing PR branch.

### 7. Watch, repair, repeat

- Watch checks on the exact new head through completion.
- If another failure appears, return to diagnosis. Do not stop because the originally reported test now passes.
- If another commit supersedes the run, verify the fixes are still present and monitor the replacement run.
- Continue until applicable CI and any configured preview-deployment job pass. Missing CI is unknown unless exact-head/base workflow-filter and required-check evidence proves it not applicable. Absence of a configured preview requires recorded workflow inspection, not invented deployment work.

## Verify the preview

1. Extract the deployment and inspect URLs from the successful job logs.
2. Verify the deployed artifact contains current-head content. For protected Vercel previews, use authenticated `vercel curl --deployment <url>` when available.
3. Manually inspect the page in a real browser when visual or interactive behavior is in scope.
4. Distinguish clearly among:
   - a current public share URL;
   - a current protected deployment URL;
   - an older share URL serving stale content.
5. Never label a stale or sign-in-only URL as a public current preview. Do not create share tokens or change deployment protection without action-time confirmation.
6. If manual local testing was requested, leave the current worktree's server running and provide its URL. Stop temporary test-only servers.

## Completion criteria

Finish only when all are true:

- the latest PR head contains the fixes and is pushed;
- required checks pass (or CI is verified not applicable from filters and required-check rules);
- a configured preview is current and verified, or no preview is configured as shown by inspected workflows;
- no unintended tracked changes remain;
- unrelated untracked files remain untouched;
- independent review has no unresolved findings.

Report the root causes, scoped fixes, validation evidence, PR/check links, current preview URL and its access status, local manual-test URL when applicable, and any intentionally preserved files.

## Continuous monitoring

This skill performs one persistent repair run; it is not a background daemon. For "always watch" behavior, configure a recurring automation or persistent task that invokes `$gh-watch-and-repair-pr` with:

- repository and PR URL, number, branch, or an explicit open-PR filter;
- polling cadence and stopping policy;
- permission to push fixes to PR branches;
- explicit exclusions for merging, production deployment, and access-control changes.

Scheduling requires an explicit request. Keep an existing paused automation paused until explicitly resumed. Do not silently guess a cadence or broad repository scope. Ask for those details when they cannot be resolved from the current PR request.
