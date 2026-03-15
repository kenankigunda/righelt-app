# Branch Audit

Snapshot taken on 2026-03-15 from the local repository state in `/Users/kenankigunda/Documents/righelt` after `git fetch --prune origin`.

Notes:
- Merge status is evaluated against the local `main` branch.
- Remote status is based on the refreshed upstream refs and tracking state from the fetch above.
- `Worktree` uses short labels so checked-out branches can be distinguished across attached worktrees.

## (a) Already Merged To `main`, And Not Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `main` | n/a | `origin/main` exists, up to date (`=`) | `primary` | Baseline |

## (b) Already Merged To `main`, But Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/client-history-local-nav` | Yes | `origin/main` exists, up to date (`=`) | `wt-5b34` | No remaining code diff; this worktree branch currently points at the same commit as `main` |

## (c) Not Merged To `main`, But Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/computer-player` | No | `origin/codex/computer-player` exists, up to date (`=`) | `wt-b058` | Adds `docs/RIGHELT_COMPUTER_PLAYER_PLAN.md` with the computer-player implementation plan |
| `codex/tutorial-mode` | No | `origin/codex/tutorial-mode` exists, up to date (`=`) | `wt-f466` | Adds `docs/features/tutorial-mode/EXECUTION_PLAN.md` with the tutorial-mode execution plan |

## (d) Not Merged To `main`, And Not Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|

## (e) Branches Which Only Exist On The Remote, With No Code Diff Relative to `main`

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|

## (f) Branches Which Only Exist On The Remote, With Some Code Diff Relative to `main`

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/f-030-remove-offline-mode` | Unknown locally | Remote-only (`origin/codex/f-030-remove-offline-mode`) | `-` | Removes offline mode in shell/live transport and related tests |
| `codex/f-030-shell-presence-fixes` | Unknown locally | Remote-only (`origin/codex/f-030-shell-presence-fixes`) | `-` | Stabilizes live participant presence and websocket freshness handling across shell sync, routing, and API handler tests |
| `codex/f-032-live-authority-integration` | Unknown locally | Remote-only (`origin/codex/f-032-live-authority-integration`) | `-` | Adds the F-032 live-authority orchestration kickoff docs: the feature plan, coordination log, and stream briefs under `docs/features/F-032-live-authority/` |
| `codex/game-room-worker-binding-fix` | Unknown locally | Remote-only (`origin/codex/game-room-worker-binding-fix`) | `-` | Adds the game-room worker deployment and binding flow across wrangler config, API handler guards, tests, and setup scripts |
| `codex/invite-accept-propagation-fix` | Unknown locally | Remote-only (`origin/codex/invite-accept-propagation-fix`) | `-` | Updates `docs/RIGHELT_WEB_APP_SPEC.md` with invite accept propagation guidance |
| `codex/mobile-overflow-snapshot` | Unknown locally | Remote-only (`origin/codex/mobile-overflow-snapshot`) | `-` | Tightens mobile board and shell width constraints in `apps/web/shell/shell.css` and `apps/web/styles.css` |
| `codex/overlay-line-centers-20260302` | Unknown locally | Remote-only (`origin/codex/overlay-line-centers-20260302`) | `-` | Aligns overlay lines to piece centers and includes broader playground, fixture, interaction, style, engine, API handler, and docs changes |
| `codex/rush-highlighting-arrowhead-layering` | Unknown locally | Remote-only (`origin/codex/rush-highlighting-arrowhead-layering`) | `-` | Updates `apps/web/board-adapters/engine-playground-adapter.js` and its test to render preview arrowheads above arrow shafts |
| `codex/rush-highlighting-preview-arrows` | Unknown locally | Remote-only (`origin/codex/rush-highlighting-preview-arrows`) | `-` | Updates `apps/web/board-adapters/engine-playground-adapter.js` and its test to hide illegal action preview arrows |
| `codex/shell-live-payload-leak-fix` | Unknown locally | Remote-only (`origin/codex/shell-live-payload-leak-fix`) | `-` | Reduces shell live payload size and adjusts shell history/press animation behavior |
| `codex/turn-control-fix-checkpoint` | Unknown locally | Remote-only (`origin/codex/turn-control-fix-checkpoint`) | `-` | Applies the turn-control handoff checkpoint changes in shell transport and API handler tests |
| `codex/turn-handoff-broken-attempt` | Unknown locally | Remote-only (`origin/codex/turn-handoff-broken-attempt`) | `-` | Contains a WIP turn-handoff attempt in live transport and integration tests |

## Worktree Labels

| Label | Path |
|---|---|
| `primary` | `/Users/kenankigunda/Documents/righelt` |
| `wt-5b34` | `/Users/kenankigunda/.codex/worktrees/5b34/righelt` |
| `wt-b058` | `/Users/kenankigunda/.codex/worktrees/b058/righelt` |
| `wt-f466` | `/Users/kenankigunda/.codex/worktrees/f466/righelt` |
