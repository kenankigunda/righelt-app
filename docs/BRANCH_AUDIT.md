# Branch Audit

Snapshot taken on 2026-03-11 from the local repository state in `/Users/kenankigunda/Documents/righelt` after `git fetch --prune origin`.

Notes:
- Merge status is evaluated against the local `main` branch.
- Remote status is based on the refreshed upstream refs and tracking state from the fetch above.
- `Worktree` uses short labels so checked-out branches can be distinguished across attached worktrees.

## (a) Already Merged To `main`, And Not Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `main` | n/a | `origin/main` exists, up to date (`=`) | `-` | Baseline |
| `codex/client-move-generation` | Yes | `origin/codex/client-move-generation` exists, up to date (`=`) | `-` | No code diff; tip is already merged and branch is 25 commits behind `main` |
| `codex/investigation-20260311` | Yes | `origin/codex/investigation-20260311` exists, up to date (`=`) | `-` | No code diff; it currently points at the same commit as `main` |
| `codex/invite-connection-flow-fix-restart` | Yes | `origin/codex/invite-connection-flow-fix-restart` exists, up to date (`=`) | `-` | No code diff; tip is already merged and branch is 17 commits behind `main` |

## (b) Already Merged To `main`, But Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/engine-validation-ui` | Yes | `origin/codex/engine-validation-ui` exists, up to date (`=`) | `wt-f466` | No code diff; tip is already merged and branch is 194 commits behind `main` |
| `codex/history-board-ui` | Yes | `origin/codex/history-board-ui` exists, up to date (`=`) | `wt-5b34` | No code diff; tip is already merged and branch is 6 commits behind `main` |

## (c) Not Merged To `main`, But Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/computer-player` | No | `origin/codex/computer-player` exists, up to date (`=`) | `wt-b058` | 1 commit ahead; adds `docs/RIGHELT_COMPUTER_PLAYER_PLAN.md` |
| `codex/investigation-20260311-branch-audit` | No | `origin/codex/investigation-20260311-branch-audit` exists, up to date (`=`) | `primary` | 1 commit ahead; changes `AGENTS.md` and updates `docs/BRANCH_AUDIT.md` |

## (d) Not Merged To `main`, And Not Checked Out On A Worktree

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/f-030-remove-offline-mode` | No | `origin/codex/f-030-remove-offline-mode` exists, up to date (`=`) | `-` | 1 commit ahead across 8 files; removes offline mode in shell/live transport and related tests |
| `codex/f-030-shell-presence-fixes` | No | `origin/codex/f-030-shell-presence-fixes` exists, up to date (`=`) | `-` | 2 commits ahead across 8 files; presence/websocket freshness fixes in shell sync, routing, and API handler tests |
| `codex/invite-accept-propagation-fix` | No | `origin/codex/invite-accept-propagation-fix` exists, up to date (`=`) | `-` | 1 commit ahead; doc-only change in `docs/RIGHELT_WEB_APP_SPEC.md` |
| `codex/mobile-overflow-snapshot` | No | `origin/codex/mobile-overflow-snapshot` exists, up to date (`=`) | `-` | 1 commit ahead; CSS-only changes in `apps/web/shell/shell.css` and `apps/web/styles.css` |
| `codex/overlay-line-centers-20260302` | No | `origin/codex/overlay-line-centers-20260302` exists, up to date (`=`) | `-` | 22 commits ahead across 25 files; overlay alignment plus broader playground, fixture, interaction, style, engine, API handler, and docs changes |
| `codex/shell-live-payload-leak-fix` | No | `origin/codex/shell-live-payload-leak-fix` exists, up to date (`=`) | `-` | 9 commits ahead across 7 files; reduces live payloads and adjusts shell history/press animation behavior |
| `codex/turn-control-fix-checkpoint` | No | `origin/codex/turn-control-fix-checkpoint` exists, up to date (`=`) | `-` | 1 commit ahead across 7 files; turn-control handoff checkpoint changes in shell transport and API handler tests |
| `codex/turn-handoff-broken-attempt` | No | `origin/codex/turn-handoff-broken-attempt` exists, up to date (`=`) | `-` | 1 commit ahead across 5 files; WIP turn-handoff attempt in live transport and integration tests |

## (e) Branches Which Only Exist On The Remote, With No Code Diff Relative to `main`

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/board-runtime-portability` | Unknown locally | Remote-only (`origin/codex/board-runtime-portability`) | `-` | No code diff relative to `main`; remote ref is 53 commits behind `main` |
| `codex/cloudflare-startup-optimizations` | Unknown locally | Remote-only (`origin/codex/cloudflare-startup-optimizations`) | `-` | No code diff relative to `main`; remote ref is 181 commits behind `main` |
| `codex/engine-core` | Unknown locally | Remote-only (`origin/codex/engine-core`) | `-` | No code diff relative to `main`; remote ref is 212 commits behind `main` |
| `codex/engine-resolve` | Unknown locally | Remote-only (`origin/codex/engine-resolve`) | `-` | No code diff relative to `main`; remote ref is 203 commits behind `main` |
| `codex/f-030-shell-integration` | Unknown locally | Remote-only (`origin/codex/f-030-shell-integration`) | `-` | No code diff relative to `main`; remote ref is 120 commits behind `main` |
| `codex/f-030-shell-orchestration-plan` | Unknown locally | Remote-only (`origin/codex/f-030-shell-orchestration-plan`) | `-` | No code diff relative to `main`; remote ref is 159 commits behind `main` |
| `codex/f-031-live-transport-integration` | Unknown locally | Remote-only (`origin/codex/f-031-live-transport-integration`) | `-` | No code diff relative to `main`; remote ref is 139 commits behind `main` |
| `codex/f-031-turn-move-split` | Unknown locally | Remote-only (`origin/codex/f-031-turn-move-split`) | `-` | No code diff relative to `main`; remote ref is 141 commits behind `main` |
| `codex/fix-shell-rerender-selection` | Unknown locally | Remote-only (`origin/codex/fix-shell-rerender-selection`) | `-` | No code diff relative to `main`; remote ref is 47 commits behind `main` |
| `codex/game-engine-20260226` | Unknown locally | Remote-only (`origin/codex/game-engine-20260226`) | `-` | No code diff relative to `main`; remote ref is 73 commits behind `main` |
| `codex/invite-accept-loop-fix` | Unknown locally | Remote-only (`origin/codex/invite-accept-loop-fix`) | `-` | No code diff relative to `main`; remote ref is 35 commits behind `main` |
| `codex/live-site-debug` | Unknown locally | Remote-only (`origin/codex/live-site-debug`) | `-` | No code diff relative to `main`; remote ref is 52 commits behind `main` |
| `codex/milestone-2-integration-base` | Unknown locally | Remote-only (`origin/codex/milestone-2-integration-base`) | `-` | No code diff relative to `main`; remote ref is 193 commits behind `main` |
| `codex/retreat-shell-fix` | Unknown locally | Remote-only (`origin/codex/retreat-shell-fix`) | `-` | No code diff relative to `main`; remote ref is 38 commits behind `main` |
| `codex/rush-push-fixes` | Unknown locally | Remote-only (`origin/codex/rush-push-fixes`) | `-` | No code diff relative to `main`; remote ref is 170 commits behind `main` |
| `codex/rush-push-improvements` | Unknown locally | Remote-only (`origin/codex/rush-push-improvements`) | `-` | No code diff relative to `main`; remote ref is 40 commits behind `main` |
| `codex/test-gap-coverage-pass` | Unknown locally | Remote-only (`origin/codex/test-gap-coverage-pass`) | `-` | No code diff relative to `main`; remote ref is 166 commits behind `main` |
| `codex/transport-holistic-fix` | Unknown locally | Remote-only (`origin/codex/transport-holistic-fix`) | `-` | No code diff relative to `main`; remote ref is 31 commits behind `main` |
| `codex/ui-harness-piece-overlays` | Unknown locally | Remote-only (`origin/codex/ui-harness-piece-overlays`) | `-` | No code diff relative to `main`; remote ref is 188 commits behind `main` |
| `codex/update-engine-test-matrix-v2` | Unknown locally | Remote-only (`origin/codex/update-engine-test-matrix-v2`) | `-` | No code diff relative to `main`; remote ref is 218 commits behind `main` |
| `codex/webapp-spec-board-independence` | Unknown locally | Remote-only (`origin/codex/webapp-spec-board-independence`) | `-` | No code diff relative to `main`; remote ref is 163 commits behind `main` |

## (f) Branches Which Only Exist On The Remote, With Some Code Diff Relative to `main`

| Branch | Merged to `main` | Remote exists / up to date | Worktree | Difference vs `main` |
|---|---|---|---|---|
| `codex/f-032-live-authority-integration` | Unknown locally | Remote-only (`origin/codex/f-032-live-authority-integration`) | `-` | 2 commits ahead across 6 files on the remote-only branch |

## Worktree Labels

| Label | Path |
|---|---|
| `primary` | `/Users/kenankigunda/Documents/righelt` |
| `wt-5b34` | `/Users/kenankigunda/.codex/worktrees/5b34/righelt` |
| `wt-b058` | `/Users/kenankigunda/.codex/worktrees/b058/righelt` |
| `wt-f466` | `/Users/kenankigunda/.codex/worktrees/f466/righelt` |
