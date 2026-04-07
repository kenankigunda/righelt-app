# Branch Audit

Snapshot taken on 2026-04-07 from the local repository state in `/Users/kenankigunda/Documents/righelt` after `git fetch origin --prune`.

Notes:
- Merge status is evaluated against the local `main` branch.
- Remote status is based on refreshed upstream refs from the fetch above.
- `Worktree` uses short labels so attached worktrees can be distinguished in the audit.
- Detached worktrees do not count as a named branch being checked out; only `primary` is currently attached to a branch.
- The `/private/tmp/*` worktrees are still registered as detached, prunable entries, so they remain in the legend but do not place any branch into categories `(b)` or `(c)`.
- Local cleanup has reduced named local branches to just `main`; every remaining non-`main` branch in this snapshot is remote-only.

## (a) Already Merged To `main`, And Not Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `main` | n/a | origin/main exists, up to date (`=`) | primary | Baseline |

## (b) Already Merged To `main`, But Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|

## (c) Not Merged To `main`, But Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|

## (d) Not Merged To `main`, And Not Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|

## (e) Branches Which Only Exist On The Remote, With No Code Diff Relative to `main`

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|

## (f) Branches Which Only Exist On The Remote, With Some Code Diff Relative to `main`

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/action-transmission-fixes` | Unknown locally | Remote-only (`origin/codex/action-transmission-fixes`) | - | Hardens shell action-transmission recovery across live transport, durable-object live state, and related tests |
| `codex/client-history-local-nav` | Unknown locally | Remote-only (`origin/codex/client-history-local-nav`) | - | Refactors client history reconciliation across shell transport, optimistic live state, durable-object live state, and related tests |
| `codex/computer-player` | Unknown locally | Remote-only (`origin/codex/computer-player`) | - | Adds `docs/RIGHELT_COMPUTER_PLAYER_PLAN.md` with the computer-player implementation plan |
| `codex/db-utilization-regression-fix` | Unknown locally | Remote-only (`origin/codex/db-utilization-regression-fix`) | - | Fix compact live-state rehydration regressions across `packages/api-handler/src/shell-live-db.ts` and `packages/api-handler/test/live-transport.test.mjs` |
| `codex/f-030-remove-offline-mode` | Unknown locally | Remote-only (`origin/codex/f-030-remove-offline-mode`) | - | Removes offline mode in shell/live transport and related tests |
| `codex/f-030-shell-presence-fixes` | Unknown locally | Remote-only (`origin/codex/f-030-shell-presence-fixes`) | - | Stabilizes live participant presence and websocket freshness handling across shell sync, routing, and API handler tests |
| `codex/f-032-live-authority-integration` | Unknown locally | Remote-only (`origin/codex/f-032-live-authority-integration`) | - | Adds the F-032 live-authority orchestration kickoff docs: the feature plan, coordination log, and stream briefs under `docs/features/F-032-live-authority/` |
| `codex/game-room-worker-binding-fix` | Unknown locally | Remote-only (`origin/codex/game-room-worker-binding-fix`) | - | Adds the game-room worker deployment and binding flow across wrangler config, API handler guards, tests, and setup scripts |
| `codex/history-destruction-flat-indent` | Unknown locally | Remote-only (`origin/codex/history-destruction-flat-indent`) | - | Flattens history destruction rows across the board adapter contract, engine board adapter, and board runtime |
| `codex/history-destruction-pulse` | Unknown locally | Remote-only (`origin/codex/history-destruction-pulse`) | - | Adds pulsing history destruction overlays across the board adapter contract, engine board adapter, and board runtime |
| `codex/history-destruction-pulse-v2` | Unknown locally | Remote-only (`origin/codex/history-destruction-pulse-v2`) | - | Adds a subtler history destruction pulse across the board adapter contract, engine board adapter, and board runtime |
| `codex/home-page-paging-animation` | Unknown locally | Remote-only (`origin/codex/home-page-paging-animation`) | - | Smooths home page carousel transitions across shell app, shell CSS, and mobile layout coverage |
| `codex/invite-accept-propagation-fix` | Unknown locally | Remote-only (`origin/codex/invite-accept-propagation-fix`) | - | Updates `docs/RIGHELT_WEB_APP_SPEC.md` with invite accept propagation guidance |
| `codex/manual-scenario` | Unknown locally | Remote-only (`origin/codex/manual-scenario`) | - | Fixes commander forced-move scenario history across the catalog scenario data and live transport integration paths |
| `codex/mobile-overflow-snapshot` | Unknown locally | Remote-only (`origin/codex/mobile-overflow-snapshot`) | - | Tightens mobile board and shell width constraints in `apps/web/shell/shell.css` and `apps/web/styles.css` |
| `codex/overlay-line-centers-20260302` | Unknown locally | Remote-only (`origin/codex/overlay-line-centers-20260302`) | - | Aligns overlay lines to piece centers and includes broader playground, fixture, interaction, style, engine, API handler, and docs changes |
| `codex/playground-workflow-game-authority-adapter` | Unknown locally | Remote-only (`origin/codex/playground-workflow-game-authority-adapter`) | - | Experiments with player-turn correction across shell host/transport, durable-object live state, and authority-adapter tests |
| `codex/rush-highlighting-arrowhead-layering` | Unknown locally | Remote-only (`origin/codex/rush-highlighting-arrowhead-layering`) | - | Updates `apps/web/board-adapters/engine-playground-adapter.js` and its test to render preview arrowheads above arrow shafts |
| `codex/rush-highlighting-preview-arrows` | Unknown locally | Remote-only (`origin/codex/rush-highlighting-preview-arrows`) | - | Updates `apps/web/board-adapters/engine-playground-adapter.js` and its test to hide illegal action preview arrows |
| `codex/scenario-management-improvements-home-card-width-cap` | Unknown locally | Remote-only (`origin/codex/scenario-management-improvements-home-card-width-cap`) | - | Caps home game card width in shell CSS and the mobile layout test |
| `codex/scenarios-previews-cleanup` | Unknown locally | Remote-only (`origin/codex/scenarios-previews-cleanup`) | - | Preserves the debug-mode and mini-board previews merge on an older base, so the remote tip still differs broadly from current `main` |
| `codex/shell-live-payload-leak-fix` | Unknown locally | Remote-only (`origin/codex/shell-live-payload-leak-fix`) | - | Reduces shell live payload size and adjusts shell history/press animation behavior |
| `codex/supply-command-sequences-fix` | Unknown locally | Remote-only (`origin/codex/supply-command-sequences-fix`) | - | Adds live-sync diagnostics and local fallback across client move generation, API routing, and generated engine output |
| `codex/turn-control-fix-checkpoint` | Unknown locally | Remote-only (`origin/codex/turn-control-fix-checkpoint`) | - | Applies the turn-control handoff checkpoint changes in shell transport and API handler tests |
| `codex/turn-handoff-broken-attempt` | Unknown locally | Remote-only (`origin/codex/turn-handoff-broken-attempt`) | - | Contains a WIP turn-handoff attempt in live transport and integration tests |
| `codex/tutorial-mode` | Unknown locally | Remote-only (`origin/codex/tutorial-mode`) | - | Adds `docs/features/tutorial-mode/EXECUTION_PLAN.md` with the tutorial-mode execution plan |
| `revert-44-codex/db-utilization-improvement-3` | Unknown locally | Remote-only (`origin/revert-44-codex/db-utilization-improvement-3`) | - | Revert "Compact live game persistence and purge legacy runtime data" across branch content |

## Worktree Labels

| Label | Path |
|---|---|
| `primary` | `/Users/kenankigunda/Documents/righelt` |
| `wt-righelt-main` (detached) (prunable) | `/private/tmp/righelt-main` |
| `wt-righelt-main-doc-pick` (detached) (prunable) | `/private/tmp/righelt-main-doc-pick` |
| `wt-righelt-main-pick` (detached) (prunable) | `/private/tmp/righelt-main-pick` |
| `wt-righelt-push` (detached) (prunable) | `/private/tmp/righelt-push` |
| `wt-5b34` (detached) | `/Users/kenankigunda/.codex/worktrees/5b34/righelt` |
| `wt-b058` (detached) | `/Users/kenankigunda/.codex/worktrees/b058/righelt` |
| `wt-f466` (detached) | `/Users/kenankigunda/.codex/worktrees/f466/righelt` |
