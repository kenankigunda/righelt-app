---
id: "t-020"
title: "Client sync store for immediate responsiveness"
status: "In Progress"
assignee: []
created_date: "2026-04-04"
updated_date: "2026-04-04"
labels: ["feature"]
priority: "high"
dependencies: []
references:
  - "docs/features/SYNC_STORE_ARCHITECTURE.md"
---

## Description
Notion priority: P0. Subtask: t-020.01 (Client-side optimistic updates for history).

Unify all client-server communication behind a single sync store that returns immediate optimistic results, eliminates the global `busy` flag, and provides a reset/alert path on unrecoverable failure.

## Progress

**Branch `codex/client-local-sync-store`** — substantial partial implementation:
- Phases 1–4 complete: `createSyncStore()` facade, `OperationHandle`/`operation-manager.js`, optimistic client-generated IDs (create-game, history-branch), optimistic revert/approve/reject/rescind flows with rollback
- Phase 8 partial: failed create-game surfaces an alert banner; not yet unified across all operation types
- Unit, integration, and E2E coverage added for completed phases

Remaining: Phases 5 (invite-copy on pending games), 6 (full pulsing-button/skeleton system), 7 (pending history items), 8 (unified failure UX), 9 (local-first history nav), 10 (absorb live-sync.js), 11 (dead store cleanup), 12 (offline support). See architecture doc for full phase breakdown.

**Branch `claude/fervent-allen`** — independent implementation pass also in progress.

## References
- Architecture & eng plan: `docs/features/SYNC_STORE_ARCHITECTURE.md`
- Active implementation: branch `codex/client-local-sync-store`
- Independent implementation: worktree/branch `claude/fervent-allen`
