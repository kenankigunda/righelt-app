# Righelt Free-Tier Execution Plan (Milestone 1)

Status: Step-by-step implementation plan for standing up the free-tier architecture and verifying end-to-end deployment with one simple test action.

Milestone success criterion:
- The deployed production app provides one button that triggers a backend action and returns a response visible in the UI.

## 1. Prepare Local Tooling

1. Install Node.js 20+, `pnpm`, and `wrangler`.
   ```bash
   npm i -g pnpm wrangler
   node -v
   wrangler -v
   ```
2. From the repository root, initialize required directories.
   ```bash
   mkdir -p apps/web
   mkdir -p apps/worker/src
   mkdir -p db/migrations
   mkdir -p .github/workflows
   ```

## 2. Create Cloudflare Free-Tier Resources

1. Create a Cloudflare account.
2. Create one D1 database for development (example: `righelt-db-dev`).
3. Create one Pages project (example: `righelt-web`).
4. (Optional for milestone) Create one standalone Worker service (example: `righelt-api`).
5. Use environment-qualified naming for future databases:
   - `righelt-db-dev`
   - `righelt-db-staging`
   - `righelt-db-prod`
6. Capture:
   - `CLOUDFLARE_ACCOUNT_ID`
   - D1 `database_id`
7. Replace `REPLACE_WITH_D1_DATABASE_ID` in:
   - `apps/web/wrangler.toml`
   - `apps/worker/wrangler.toml` (if using standalone Worker deployment)

## 3. Create Initial Milestone Schema

1. Create `db/migrations/0001_initial.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS milestone_actions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     message TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   ```

## 4. Implement Minimal Backend on Same Origin

1. Implement shared API handler logic for:
   - `GET /api/health` returning `{ "ok": true }`
   - `POST /api/test-action`:
     - insert one row into `milestone_actions`
     - return `{ "ok": true, "actionId": ..., "createdAt": ... }`
2. Wire same-origin Pages Functions route:
   - `apps/web/functions/api/[[path]].ts`
   - Binds D1 as `DB` via `apps/web/wrangler.toml`
3. (Optional) Keep `apps/worker/src/index.ts` for standalone Worker deployment/testing.

## 5. Implement Minimal Frontend (One Button)

1. In `apps/web`, add a basic page with:
   - a button labeled `Run Test Action`
   - click handler calling `POST /api/test-action`
   - response renderer showing returned JSON
2. Call same-origin `/api/*` endpoints directly (no hardcoded Worker URL config file).

## 6. Validate Locally Before Deployment

1. Apply D1 migration locally:
   ```bash
   wrangler d1 migrations apply righelt-db-dev --local --config apps/web/wrangler.toml
   ```
2. Run Pages locally with Functions:
   ```bash
   pnpm dev:web
   ```
3. (Optional) Run standalone worker locally:
   ```bash
   pnpm dev:worker
   ```
4. Click button and verify JSON includes a non-null `actionId`.

## 7. Add GitHub Actions CI/CD

1. Create `.github/workflows/ci.yml`:
   - install dependencies
   - lint/typecheck
   - run tests
2. Create `.github/workflows/deploy.yml`:
   - trigger on push to `main`
   - apply D1 migrations
   - deploy Pages frontend (with Functions)
   - deploy standalone Worker only if needed

## 8. Configure GitHub Repository Secrets

Set the following secrets:
1. `CLOUDFLARE_API_TOKEN`
2. `CLOUDFLARE_ACCOUNT_ID`
3. `CLOUDFLARE_PAGES_PROJECT`
4. (Optional) `DEPLOY_STANDALONE_WORKER=true` if you want workflow to also deploy `apps/worker`.

## 9. Deploy to Production

1. Commit and push the implementation.
2. Wait for `deploy.yml` workflow to succeed.
3. Open the production Pages URL.
4. Verify `/api/health` on same domain returns `{ "ok": true }`.

## 10. End-to-End Milestone Test

1. Open deployed app in browser.
2. Click `Run Test Action`.
3. Verify UI shows success JSON containing:
   - `ok: true`
   - `actionId` (non-null)
   - `createdAt`
4. Optional: query D1 and confirm inserted row exists.

## 11. Pass/Fail Criteria

Pass when all are true:
1. App is publicly reachable.
2. Button click returns a live backend response in production.
3. Backend persists the action to D1.
4. Flow works without local services.

Fail if any of the above conditions are not met.
