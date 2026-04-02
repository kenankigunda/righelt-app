# Righelt

This repository is the foundation for the Righelt web app.

## What Lives Here

Righelt is organized around formal specs, implementation packages, and test lanes that stay aligned with CI.

- `apps/web` contains the Pages-hosted web client.
- `apps/api` contains the Cloudflare Worker entrypoint and local worker config.
- `packages/game-engine` contains the authoritative game engine logic.
- `packages/api-handler` contains the shared live-game and API handling logic.
- `packages/shared-types` contains shared runtime and contract types.
- `db/` contains D1 migrations and database operations runbooks.
- `docs/` contains product specs, testing strategy, execution plans, and operational runbooks.
- `archive/` preserves legacy implementation material for reference only.

## Getting Started

1. Install dependencies with `pnpm install`.
2. Start the default local stack with `pnpm dev:all`.
3. Run the core non-watch validation flow with `pnpm test`.

Useful variants:

- `pnpm dev:web` starts only the web app.
- `pnpm dev:api` starts only the API worker.
- `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:e2e` run individual test lanes.

## Read This First

The repo uses a few documents as the main source of truth, depending on what you are changing:

- `docs/RIGHELT_RULES_SPEC.md` for formal game rules.
- `docs/RIGHELT_WEB_APP_SPEC.md` for web app behavior and UX requirements.
- `docs/RIGHELT_ENGINE_TEST_MATRIX.md` for engine acceptance scenarios.
- `docs/TESTING_STRATEGY.md` for unit, integration, and E2E lane ownership.
- `docs/WORKFLOW_COVERAGE.md` for workflow coverage inventory and gaps.
- `docs/RIGHELT_PLAYER_RULES.md` for the player-facing rules guide.

## Developer Notes

- UI information architecture and frontend interaction conventions live in `docs/UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md`.
- Diagnostic and verbose logging toggles live in `docs/DEBUGGING_AND_DIAGNOSTICS.md`.
- Repo-level AI collaboration rules and shorthand live in `AGENTS.md`.
- Non-default AI workflows and runbooks live in `docs/ai/`.

## License

This project is closed-source and proprietary. See `LICENSE`.
