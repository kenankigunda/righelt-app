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
2. If the rerun audit changes the audit snapshot, keep the updated [`docs/BRANCH_AUDIT.md`](./BRANCH_AUDIT.md) in place.
3. Compare the refreshed audit to the previous audit snapshot.
4. If the refreshed audit differs from the previous audit, stop immediately.
5. Report the difference and do not perform any branch deletions in that run.
6. If the refreshed audit does not differ from the previous audit, continue with cleanup using the categories from the refreshed audit.
7. Before deleting any branches that will remain on the remote, update [`docs/REMOTE_ONLY_BRANCH_SUMMARIES.md`](./REMOTE_ONLY_BRANCH_SUMMARIES.md) as needed so any branch that is about to become remote-only retains an accessible curated summary.
8. Delete every branch in category `(a) Already Merged To main, And Not Checked Out On A Worktree` from both local and remote, except `main`, which must never be changed by this workflow.
9. Delete every branch in category `(d) Not Merged To main, And Not Checked Out On A Worktree` from local only. Keep the remote branches. Never include `main`.
10. Delete every branch in category `(e) Branches Which Only Exist On The Remote, With No Code Diff Relative to main` from remote only. Never include `main`.
11. After confirming a remote branch was successfully deleted, remove its entry from [`docs/REMOTE_ONLY_BRANCH_SUMMARIES.md`](./REMOTE_ONLY_BRANCH_SUMMARIES.md) if one exists.

## Deletion Rules

- Category `(a)` is a local-and-remote deletion set.
- Category `(d)` is a local-only deletion set.
- Category `(e)` is a remote-only deletion set.
- Update [`docs/REMOTE_ONLY_BRANCH_SUMMARIES.md`](./REMOTE_ONLY_BRANCH_SUMMARIES.md) before local-only deletions so retained remote branches do not lose their curated summaries when the local branch disappears.
- After a remote branch is actually deleted, remove any matching summary entry from [`docs/REMOTE_ONLY_BRANCH_SUMMARIES.md`](./REMOTE_ONLY_BRANCH_SUMMARIES.md) so the summaries file only tracks surviving remote-only branches.
- Do not delete branches from categories `(b)`, `(c)`, or `(f)` as part of this workflow.
- Do not continue past the audit step if the refreshed audit changed relative to the prior snapshot.
- `main` is always excluded from every deletion set, even if it appears in a matching category due to audit or formatting error.

## Expected Reporting

When this workflow is executed, the report should include:

- Whether the refreshed audit differed from the previous audit.
- If it differed: a concise summary of the differences, confirmation that [`docs/BRANCH_AUDIT.md`](./BRANCH_AUDIT.md) was updated to the refreshed snapshot, and confirmation that no deletions were performed.
- If it did not differ: the exact branch lists selected for local-and-remote deletion, local-only deletion, and remote-only deletion, plus any updates made to [`docs/REMOTE_ONLY_BRANCH_SUMMARIES.md`](./REMOTE_ONLY_BRANCH_SUMMARIES.md) both before local-only deletion and after confirmed remote deletion.
