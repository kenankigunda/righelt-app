# Remote-Only Branch Summaries

This document is the curated data source for plain-language summaries used in branch audit section `(f) Branches Which Only Exist On The Remote, With Some Code Diff Relative to main`.

When a remote-only branch is listed here, `Audit branches` should prefer this curated summary over any automatically synthesized fallback.

## Summaries

| Branch | Curated Summary |
|---|---|
| `codex/f-030-remove-offline-mode` | Removes offline mode in shell/live transport and related tests |
| `codex/f-030-shell-presence-fixes` | Stabilizes live participant presence and websocket freshness handling across shell sync, routing, and API handler tests |
| `codex/game-room-worker-binding-fix` | Adds the game-room worker deployment and binding flow across wrangler config, API handler guards, tests, and setup scripts |
| `codex/invite-accept-propagation-fix` | Updates `docs/RIGHELT_WEB_APP_SPEC.md` with invite accept propagation guidance |
| `codex/mobile-overflow-snapshot` | Tightens mobile board and shell width constraints in `apps/web/shell/shell.css` and `apps/web/styles.css` |
| `codex/overlay-line-centers-20260302` | Aligns overlay lines to piece centers and includes broader playground, fixture, interaction, style, engine, API handler, and docs changes |
| `codex/rush-highlighting-arrowhead-layering` | Updates `apps/web/board-adapters/engine-playground-adapter.js` and its test to render preview arrowheads above arrow shafts |
| `codex/rush-highlighting-preview-arrows` | Updates `apps/web/board-adapters/engine-playground-adapter.js` and its test to hide illegal action preview arrows |
| `codex/shell-live-payload-leak-fix` | Reduces shell live payload size and adjusts shell history/press animation behavior |
| `codex/turn-control-fix-checkpoint` | Applies the turn-control handoff checkpoint changes in shell transport and API handler tests |
| `codex/turn-handoff-broken-attempt` | Contains a WIP turn-handoff attempt in live transport and integration tests |
| `codex/f-032-live-authority-integration` | Adds the F-032 live-authority orchestration kickoff docs: the feature plan, coordination log, and stream briefs under `docs/features/F-032-live-authority/` |
| `codex/action-transmission-fixes` | Hardens shell action-transmission recovery across live transport, durable-object live state, and related tests |
| `codex/client-history-local-nav` | Refactors client history reconciliation across shell transport, optimistic live state, durable-object live state, and related tests |
| `codex/computer-player` | Adds `docs/RIGHELT_COMPUTER_PLAYER_PLAN.md` with the computer-player implementation plan |
| `codex/db-utilization-regression-fix` | Fix compact live-state rehydration regressions across `packages/api-handler/src/shell-live-db.ts` and `packages/api-handler/test/live-transport.test.mjs` |
| `codex/history-destruction-flat-indent` | Flattens history destruction rows across the board adapter contract, engine board adapter, and board runtime |
| `codex/history-destruction-pulse` | Adds pulsing history destruction overlays across the board adapter contract, engine board adapter, and board runtime |
| `codex/history-destruction-pulse-v2` | Adds a subtler history destruction pulse across the board adapter contract, engine board adapter, and board runtime |
| `codex/home-page-paging-animation` | Smooths home page carousel transitions across shell app, shell CSS, and mobile layout coverage |
| `codex/manual-scenario` | Fixes commander forced-move scenario history across the catalog scenario data and live transport integration paths |
| `codex/playground-workflow-game-authority-adapter` | Experiments with player-turn correction across shell host/transport, durable-object live state, and authority-adapter tests |
| `codex/scenario-management-improvements-home-card-width-cap` | Caps home game card width in shell CSS and the mobile layout test |
| `codex/supply-command-sequences-fix` | Adds live-sync diagnostics and local fallback across client move generation, API routing, and generated engine output |
| `codex/tutorial-mode` | Adds `docs/features/tutorial-mode/EXECUTION_PLAN.md` with the tutorial-mode execution plan |
