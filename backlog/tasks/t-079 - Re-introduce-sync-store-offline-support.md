---
id: T-079
title: Re-introduce sync-store offline support
status: To Do
assignee: []
created_date: '2026-04-05'
updated_date: '2026-04-06 02:14'
labels:
  - feature
dependencies:
  - T-020
references:
  - docs/features/SYNC_STORE_ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement Phase 12 from `docs/features/SYNC_STORE_ARCHITECTURE.md`: re-introduce offline support on top of the new sync-store architecture.

Scope:
- Detect offline state inside `createSyncStore()` and route eligible self-play / non-opponent-dependent actions through the local game engine
- Persist offline-capable game state and queued operations via `persistence.js`
- Replay queued operations when connectivity returns
- Return clear failed handles for workflows that cannot proceed offline
- Add unit, integration, and E2E coverage that proves offline-capable workflows behave correctly without relying on manual testing

Notes:
- The online-first sync-store implementation (Phases 1–11) is tracked in `T-020` and is effectively complete on branch `codex/client-local-sync-store`
- This follow-up exists so offline support can be prioritized and implemented independently of the completed online-first migration
<!-- SECTION:DESCRIPTION:END -->
