# Branch Cleanup Workflow

This document defines the `Cleanup branches` workflow. It is procedural documentation only; it does not authorize implicit execution without an explicit user request.

## Purpose

Clean up stale local and remote branches based on the current grouped branch audit categories, while refusing to proceed if the audit changed since the prior snapshot.

## Preconditions

- A prior [`docs/BRANCH_AUDIT.md`](./BRANCH_AUDIT.md) snapshot exists.
- The operator intends to prune branches according to the current audit categories.
- The workflow must never modify, delete, rename, or otherwise change the `main` branch locally or remotely.

## Workflow

1. Rerun `Audit branches` first so [`docs/BRANCH_AUDIT.md`](./BRANCH_AUDIT.md) reflects the latest available branch state.
2. Compare the refreshed audit to the previous audit snapshot.
3. If the refreshed audit differs from the previous audit, stop immediately.
4. Report the difference and do not perform any branch deletions in that run.
5. If the refreshed audit does not differ from the previous audit, continue with cleanup using the categories from the refreshed audit.
6. Delete every branch in category `(a) Already Merged To main, And Not Checked Out On A Worktree` from both local and remote, except `main`, which must never be changed by this workflow.
7. Delete every branch in category `(d) Not Merged To main, And Not Checked Out On A Worktree` from local only. Keep the remote branches. Never include `main`.
8. Delete every branch in category `(e) Branches Which Only Exist On The Remote, With No Code Diff Relative to main` from remote only. Never include `main`.

## Deletion Rules

- Category `(a)` is a local-and-remote deletion set.
- Category `(d)` is a local-only deletion set.
- Category `(e)` is a remote-only deletion set.
- Do not delete branches from categories `(b)`, `(c)`, or `(f)` as part of this workflow.
- Do not continue past the audit step if the refreshed audit changed relative to the prior snapshot.
- `main` is always excluded from every deletion set, even if it appears in a matching category due to audit or formatting error.

## Expected Reporting

When this workflow is executed, the report should include:

- Whether the refreshed audit differed from the previous audit.
- If it differed: a concise summary of the differences and confirmation that no deletions were performed.
- If it did not differ: the exact branch lists selected for local-and-remote deletion, local-only deletion, and remote-only deletion.
