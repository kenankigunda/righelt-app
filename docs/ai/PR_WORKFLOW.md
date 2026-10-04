# Feature PR workflow

## One place for each feature

Use one canonical branch and PR per feature, normally corresponding to its parent ticket. Reuse the matching PR and record its branch, worktree and URL in the ticket. Subtasks, implementation layers, tests and repairs belong in that feature PR; file count alone is not a reason to split it.

Commit and push early in semantically coherent units. Open a draft PR after the first reviewable push. Keep its title and description about the complete feature outcome, using Sentence case bullets and current validation evidence. Mark it ready for review when the coherent current diff, applicable checks and curated evidence are available; list unresolved acceptance questions explicitly. Ready for review is separate from ready to merge and ready to activate. Draft status and passing CI never replace outstanding product acceptance gates.

Parallel workers may use isolated branches and worktrees. The Lead integrates their commits into the canonical feature branch in dependency order and validates the combined result. Workers do not open additional PRs for those implementation steps. Subsequent fixes go to the same feature PR while it remains open; after it merges, use a new focused PR.

## Shared prerequisites

A separate prerequisite PR is allowed without another human decision only when it is independently useful, independently testable and needed by another feature. Record its owner, the consuming features and the dependency. Ordinary refactors or implementation steps stay in the original feature PR.

Distinct features may depend on each other's PRs. Keep ownership clear and merge prerequisites first. After a prerequisite actually merges, update the dependent branch against the actual remote result and rerun affected validation. Squashing does not preserve the original branch ancestry; do not rely on an old simulated merge or simply retarget a PR without checking its resulting diff.

## Merge policy

Squash is the default. Keep individual commits throughout development and review; the squash commit describes the feature outcome and includes the PR reference. The PR retains the detailed implementation and review history. Rebase merging remains available when explicitly chosen. GitHub merge-commit merging is disabled; this does not prohibit local branch integration needed to preserve existing development history.

Record `mergeMethod: "squash"` in new validation runs unless rebase merging was explicitly chosen and is repository-allowed. Never rewrite historical run records to change their recorded method. Existing chat/email authorization, current-head validation, branch protection and merge-queue requirements still apply. This workflow is not merge authorization. Revisit squash merging if debugging experience exposes a practical problem.

## Consolidating existing PRs

Refresh remote heads, record each original PR and revision, and prove the consolidated branch contains every required change. Preserve original commits, source evidence, reviews, branches and worktrees. Validate integration with current main before publishing the result.

Reuse the original feature PR when possible. Add supersession links and close the redundant PRs before advancing the surviving PR's branch, so a base update cannot misleadingly mark the old PRs merged. Keep an honest draft/acceptance status and update ticket and validation tracking. Superseded PR approvals do not authorize the consolidated PR. Do not transfer old readiness to a changed head or silently delete historical evidence.

## Validation and acceptance

Keep three decisions separate. **Ready for human review** means the coherent diff, applicable check results and focused walkthrough are available, with unresolved questions disclosed. **Validated for merge** means the current feature and combined candidate satisfy required behavior, CI, review, preview and dependency gates. **Ready for activation** means operational prerequisites and separate activation authorization are satisfied. Merge authorization remains explicit; it is not implied by any readiness label.

Affected validation includes compatible evidence reuse. Record the candidate tree, dependency/base provenance, declared test inputs, executor/configuration, runtime/browser versions and evidence sources. A commit, squash or documentation edit does not automatically require restarting every suite. Verify actual main and dependent diffs after prerequisite merges; rerun affected checks and invalidate their downstream dependencies. Resolve unmapped changes before readiness. Missing checks are unknown unless exact-head workflow filters and branch requirements prove them not applicable.

Run focused checks at feature boundaries and relevant retained-data upgrades. Require one broad final-candidate browser pass with existing assertions and coverage; matching CI may supply it. Local checks cover gaps such as retained upgrades. Broader validation of shared authorization, transport, storage or rendering changes requires a recorded reason. Execution details, explicit coverage mappings and evidence compatibility rules belong in the validation skill.

Independent review evaluates changed behavior, coverage and concrete risks. Give reviewers bounded assignments and evidence references; stop when acceptance questions are answered. Additional stress runs, screenshots, browser permutations or investigation require a concrete unresolved risk. Repair introduced or materially worsened defects. Escalate serious pre-existing defects for a decision and record unrelated minor issues separately. After appropriate diagnostics and a successful final pass, an unreproduced intermittent failure may remain a disclosed risk unless evidence indicates an introduced security, data-integrity or core-flow blocker. Preserve failed attempts and diagnostic history.

Use screenshots to support human understanding of changed flows and meaningful client differences. Default to mobile/touch and desktop context, with additional views only where useful. Keep regression and browser proof as text when visual evidence adds no review value. Behavioral and visual completeness are separate; image counts do not establish correctness. Explicit merge approval serves as human acceptance without mandatory image-by-image sign-off.

Activation-only requirements do not block merging code proven safe while disabled, including its automatic deployment path. Retain activation prerequisites and authorization separately; never infer permission to activate accounts or another gated capability from tooling or product merge approval.
