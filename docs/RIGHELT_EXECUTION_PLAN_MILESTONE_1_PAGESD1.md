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

1. Cloudflare Pages (static + Pages Functions proxy)
2. Cloudflare Worker `righelt-api`
3. Cloudflare D1 (`righelt-db-dev`)
3. GitHub Actions
   - `CI` workflow for typecheck
   - `Deploy` workflow for migration + deploy

## Required Cloudflare Resources

1. Pages project: `righelt`
   - URL: `https://righelt.pages.dev`
   - Service binding `API_SERVICE -> righelt-api`
2. Worker: `righelt-api`
   - URL: `https://righelt-api.kenankigunda.workers.dev`
   - Owns D1 + `GameRoomDO`
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
   - `CLOUDFLARE_API_BASE_URL=https://righelt-api.kenankigunda.workers.dev`
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

1. Pages app:
   - `apps/web/index.html`
   - `apps/web/main.js`
   - `apps/web/functions/api/[[path]].js`
   - `apps/web/wrangler.toml`
   - `apps/web/deploy-meta.json`
2. API Worker:
   - `apps/api/index.js`
   - `apps/api/wrangler.toml`
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
2. Set D1 binding in API Worker Wrangler config:
   ```bash
   pnpm cf:set-db -- --name righelt-db-dev --id <D1_DATABASE_ID>
   ```
3. Confirm `apps/api/wrangler.toml` now has real `database_name` and `database_id`.
4. In Cloudflare Pages project `righelt`, add service binding `API_SERVICE -> righelt-api`.
5. Ensure GitHub `Dev` environment has secret/vars listed above.

## Local Verification (Optional but Recommended)

1. Apply migrations locally:
   ```bash
   pnpm d1:migrate:dev -- --local
   ```
2. Start API Worker dev server:
   ```bash
   pnpm dev:api
   ```
3. Start Pages dev server:
   ```bash
   pnpm dev:web
   ```
4. Open local app and click `Run Test Action`.
5. Confirm response JSON with `ok: true` and non-null `actionId`.

## Deployment Flow (Current)

On push to `main`, `.github/workflows/deploy.yml` does:

1. Install dependencies
2. Validate required env vars/secrets
3. Apply D1 migrations through `apps/api`
4. Deploy `righelt-api`
5. Stamp `apps/web/deploy-meta.json` with UTC timestamp + commit SHA
6. Deploy Pages (`wrangler pages deploy .`)
7. Smoke test direct Worker health, proxied Pages health, and create-game through Pages

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
6. Confirm direct Worker health:
   - `https://righelt-api.kenankigunda.workers.dev/api/health` returns the same binding payload.

For split-stack operations and recovery, use [`docs/RIGHELT_PAGES_WORKER_SPLIT_RUNBOOK.md`](/Users/kenankigunda/Documents/righelt/docs/RIGHELT_PAGES_WORKER_SPLIT_RUNBOOK.md).

## Notes for Future Milestones

1. Add `righelt-db-staging` and `righelt-db-prod`.
2. Split deploy workflows by environment (`Dev`, `Staging`, `Prod`).
3. If later needed, add staging/prod variants of both Pages and Worker deploy targets.
