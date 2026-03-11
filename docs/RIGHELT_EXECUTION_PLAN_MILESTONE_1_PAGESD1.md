# Righelt Execution Plan - Milestone 1

> **MILESTONE STATUS: COMPLETE**
> Completed on February 23, 2026.
> Verified end-to-end: Pages deploy + same-origin API + D1 write via one-button test.

This document is the current from-scratch setup guide for Milestone 1 in this repository.

## Goal

Deploy a Pages-hosted web app that:
1. Shows deployment metadata (`deployedAt`, `commitSha`).
2. Calls same-origin API endpoint `POST /api/test-action`.
3. Persists to D1 (`milestone_actions`) and returns JSON response.

## Architecture Used

1. Cloudflare Pages (static + Pages Functions)
2. Cloudflare D1 (`righelt-db-dev`)
3. GitHub Actions
   - `CI` workflow for typecheck
   - `Deploy` workflow for migration + deploy
4. No standalone Worker in Milestone 1

## Required Cloudflare Resources

1. Pages project: `righelt`
   - URL: `https://righelt.pages.dev`
   - Runtime bindings must include Durable Object `GAME_ROOMS -> GameRoomDO` from script `righelt-game-rooms`
2. Worker script: `righelt-game-rooms`
   - Hosts Durable Object class `GameRoomDO`
3. D1 database: `righelt-db-dev`
4. API token with permissions:
   - `Account > Cloudflare Pages: Edit`
   - `Account > Workers Scripts: Edit`
   - `Account > D1: Edit`

## Required GitHub Actions Configuration

Repository/Environment setup is currently based on environment `Dev`.

1. **Secret** (in `Dev` environment):
   - `CLOUDFLARE_API_TOKEN`

2. **Variables** (in `Dev` environment):
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_PAGES_PROJECT=righelt`
   - optional: `CLOUDFLARE_D1_DB_NAME=righelt-db-dev`

## Required Local Tooling

1. Node.js 20+
2. pnpm 9+
3. wrangler CLI (optional globally; repo uses pinned local Wrangler)

Install once:

```bash
npm i -g pnpm wrangler
```

## Repository Files That Drive Milestone 1

1. Pages/API app:
   - `apps/web/index.html`
   - `apps/web/main.js`
   - `apps/web/wrangler.toml`
   - `apps/web/deploy-meta.json`
2. Durable Object host worker:
   - `apps/game-room-worker/index.js`
   - `apps/game-room-worker/wrangler.toml`
3. API handler:
   - `packages/api-handler/src/index.ts`
4. D1 migration:
   - `db/migrations/0001_initial.sql`
5. CI/CD:
   - `.github/workflows/ci.yml`
   - `.github/workflows/deploy.yml`
6. Helper script:
   - `scripts/set-d1-binding.mjs`

## One-Time Setup Steps (From Scratch)

1. Clone repo and install dependencies:
   ```bash
   pnpm install
   ```
2. Set D1 binding in Pages Wrangler config:
   ```bash
   pnpm cf:set-db -- --name righelt-db-dev --id <D1_DATABASE_ID>
   ```
3. Confirm both [`apps/web/wrangler.toml`](/Users/kenankigunda/Documents/righelt/apps/web/wrangler.toml) and [`apps/game-room-worker/wrangler.toml`](/Users/kenankigunda/Documents/righelt/apps/game-room-worker/wrangler.toml) now have real `database_name` and `database_id`.
4. Deploy the Durable Object Worker once so Cloudflare registers class `GameRoomDO`.
5. In the Cloudflare Pages project, confirm the runtime bindings include Durable Object `GAME_ROOMS -> GameRoomDO` from script `righelt-game-rooms`.
6. Ensure GitHub `Dev` environment has secret/vars listed above.

## Local Verification (Optional but Recommended)

1. Apply migrations locally:
   ```bash
   pnpm d1:migrate:dev -- --local
   ```
2. Start Pages dev server:
   ```bash
   pnpm dev:web
   ```
3. Open local app and click `Run Test Action`.
4. Confirm response JSON with `ok: true` and non-null `actionId`.

When testing live game creation locally through Wrangler, also run the Durable Object Worker locally. Cloudflare's Pages Durable Object model expects the Worker exporting the class to run separately from the Pages app during local development.

## Deployment Flow (Current)

On push to `main`, `.github/workflows/deploy.yml` does:

1. Install dependencies
2. Validate required env vars/secrets
3. Apply D1 migrations (`wrangler d1 migrations apply ... --remote`)
4. Stamp `apps/web/deploy-meta.json` with UTC timestamp + commit SHA
5. Deploy Pages (`wrangler pages deploy .`)

Deploy workflow is serialized (`concurrency` enabled) to prevent overlapping runs.

## Production Verification Checklist

1. Open `https://righelt.pages.dev`.
2. Confirm `Deployment info` shows current deploy timestamp + latest commit short SHA.
3. Click `Run Test Action`.
4. Confirm success response:
   - `ok: true`
   - `actionId` present
   - `createdAt` present
5. Confirm API health:
   - `https://righelt.pages.dev/api/health` returns JSON `{ "ok": true, ... }`.
6. Confirm the health payload reports `"bindings": { "db": true, "gameRooms": true }`.

## Production Restore Note

If production returns `server_misconfigured_game_rooms_binding`, `/api/health` reports `"gameRooms": false`, or the Pages UI shows `No durable objects found`, deploy the `righelt-game-rooms` Worker first, then repair the live Pages binding and rerun the smoke checks in [`docs/CLOUDFLARE_PAGES_BINDING_RUNBOOK.md`](/Users/kenankigunda/Documents/righelt/docs/CLOUDFLARE_PAGES_BINDING_RUNBOOK.md).

## Notes for Future Milestones

1. Add `righelt-db-staging` and `righelt-db-prod`.
2. Split deploy workflows by environment (`Dev`, `Staging`, `Prod`).
3. Optionally reintroduce standalone Worker only when background jobs or independent API lifecycle is needed.
