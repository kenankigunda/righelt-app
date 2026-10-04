# Feature PR workflow

## One place for each feature

Use one canonical branch and PR per feature, normally corresponding to its parent ticket. Reuse the matching PR and record its branch, worktree and URL in the ticket. Subtasks, implementation layers, tests and repairs belong in that feature PR; file count alone is not a reason to split it.

Commit and push early in semantically coherent units. Open a draft PR after the first reviewable push. Keep its title and description about the complete feature outcome, following [AGENTS.md §6.2](../../AGENTS.md#62-pr-writing) for the title, four-section description, prose or sentence-case bullets, verified diff links and current validation evidence. Mark it ready for review only after the required checks pass. Draft status and passing CI never replace outstanding product acceptance gates.

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
