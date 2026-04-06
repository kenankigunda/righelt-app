---
id: T-020
title: Client sync store for immediate responsiveness
status: Done
assignee: []
created_date: '2026-04-04'
updated_date: '2026-04-06 02:13'
labels:
  - feature
dependencies: []
references:
  - docs/features/SYNC_STORE_ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P0. Subtask: t-020.01 (Client-side optimistic updates for history).

Unify all client-server communication behind a single sync store that returns immediate optimistic results, eliminates the global `busy` flag, and provides a reset/alert path on unrecoverable failure.

## Progress

**Branch `codex/client-local-sync-store`** — implementation is now effectively complete for the online-first sync-store plan:
- Phases 1–11 complete: facade migration, operation handles, optimistic client-generated IDs, optimistic revert flows, localized pending controls, skeleton/loading states, unified failure UX, local-first history navigation, live-sync absorption, and dead-store cleanup
- Unit, integration, and E2E coverage now exists for the shipped sync-store workflows, including optimistic create/branch contracts, failed-create banner handling, revert flows, localized pending controls, loading skeletons, and history live recovery

**Remaining:** Phase 12 offline support is intentionally deferred and is now tracked separately in `T-079` so the online-first sync-store delivery and the offline reintroduction work can move independently. See the architecture doc for the full phase breakdown.

**Branch `claude/client-local-sync-store`** — independent implementation pass also in progress, but with less progress.

## References
- Architecture & eng plan: `docs/features/SYNC_STORE_ARCHITECTURE.md`
- Active implementation: branch `codex/client-local-sync-store`
- Independent implementation: worktree/branch `claude/fervent-allen`
- Deferred follow-up: `T-079`
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The online-first sync-store migration is now merged to `main` via PR #63 (`2e0fbbe`). The shipped work covers the Phase 1–11 scope captured in this task: unified client/server communication through the sync store, optimistic local creation and revert flows, localized pending/loading states, local-first history navigation, unified failure handling, live-sync absorption, cleanup of the old store path, and regression coverage across unit, integration, and E2E layers.

Phase 12 offline support was intentionally split out and remains tracked separately in the dedicated offline-support follow-up task, so this parent ticket can now be considered complete on `main`.
<!-- SECTION:FINAL_SUMMARY:END -->
