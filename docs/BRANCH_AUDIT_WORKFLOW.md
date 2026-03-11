# Branch Audit Workflow

This document defines the `Audit branches` workflow. It is procedural documentation only; it does not authorize implicit execution without an explicit user request.

## Purpose

Produce an up-to-date branch inventory grouped by merge status, worktree usage, remote tracking state, and remote-only branch state, and store that inventory in [`docs/BRANCH_AUDIT.md`](./BRANCH_AUDIT.md).

## Preconditions

- The operator intends to inspect current local and remote branch state.
- The workflow must not modify branch contents. Its output is the refreshed audit document.
- When possible, the workflow should refresh remote refs before auditing so remote status is not based on stale cached state.

## Workflow

1. If possible, run a fresh remote fetch first, typically `git fetch --prune origin`.
2. If a fresh fetch cannot be completed, continue only if appropriate for the environment and clearly report that remote conclusions are based on cached refs.
3. Enumerate local branches and their configured upstream tracking state.
4. Enumerate attached worktrees and map checked-out branches to distinct worktree labels such as `primary` or `wt-<id>`.
5. Enumerate remote branches under `origin`.
6. Compare each local branch against local `main` to determine whether it is already merged and to summarize how it differs from `main`.
7. Split local branches into these categories:
8. Category `(a) Already Merged To main, And Not Checked Out On A Worktree`.
9. Category `(b) Already Merged To main, But Checked Out On A Worktree`.
10. Category `(c) Not Merged To main, But Checked Out On A Worktree`.
11. Category `(d) Not Merged To main, And Not Checked Out On A Worktree`.
12. Identify remote-only branches by subtracting local branch names from remote branch names.
13. Compare each remote-only branch against local `main`.
14. Split remote-only branches into these categories:
15. Category `(e) Branches Which Only Exist On The Remote, With No Code Diff Relative to main`.
16. Category `(f) Branches Which Only Exist On The Remote, With Some Code Diff Relative to main`.
17. Refresh [`docs/BRANCH_AUDIT.md`](./BRANCH_AUDIT.md) so it records the current snapshot, the fetch status caveat, all grouped tables `(a)` through `(f)`, and the worktree label legend.

## Category Rules

- Category `(a)` includes branches already merged to `main` and not checked out on any worktree.
- Category `(b)` includes branches already merged to `main` and currently checked out on a worktree.
- Category `(c)` includes branches not merged to `main` and currently checked out on a worktree.
- Category `(d)` includes branches not merged to `main` and not checked out on any worktree.
- Category `(e)` includes remote-only branches whose tree has no code diff relative to `main`.
- Category `(f)` includes remote-only branches whose tree still differs from `main`.
- `main` is the comparison baseline and should appear only as the baseline row in the audit output, not as a remote-only branch.

## Expected Reporting

When this workflow is executed, the report should include:

- Whether a fresh fetch was completed.
- Whether remote conclusions are based on fresh refs or cached refs.
- The path of the refreshed audit file.
- Any material changes in category membership relative to the prior audit, when relevant to the current task.
