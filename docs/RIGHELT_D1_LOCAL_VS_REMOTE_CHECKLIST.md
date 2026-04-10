# Righelt D1 Local vs Remote Checklist

This document clarifies which D1 database the repo uses in local development versus after deploy, and which migration command to run in each case.

## Current Setup

The API Worker binding is defined in [`apps/api/wrangler.toml`](/Users/kenankigunda/Documents/righelt/righelt-app/apps/api/wrangler.toml).

- Bound D1 name: `righelt-db-dev`
- Binding name used by the app: `DB`

Important distinction:

- `pnpm dev:api` runs the local Worker runtime and uses Wrangler's local D1 emulation by default.
- `pnpm dev:web` proxies `/api/*` to the local API Worker during local development.
- The deployed site and deployed Worker use the remote Cloudflare D1 database.

These are not the same database, even if they share the same binding name in config.

## Which Database Am I Hitting?

Use this table:

| Scenario | Runtime | Database |
|---|---|---|
| `pnpm dev:api` | local Wrangler Worker dev server | local Wrangler D1 state |
| `pnpm dev:web` + `pnpm dev:api` | local Pages proxy + local Worker | local Wrangler D1 state |
| deployed site (`righelt.pages.dev`) | Cloudflare Pages proxy + remote Worker | remote Cloudflare D1 |
| `wrangler d1 migrations apply ...` | local command | local Wrangler D1 state unless `--remote` is passed |
| `wrangler d1 migrations apply ... --remote` | local command against Cloudflare | remote Cloudflare D1 |

## Local Development Checklist

Use this when you want your local split-stack dev session to have the latest schema.

1. Apply migrations to local Wrangler D1:

```bash
pnpm db:local
```

2. Start the local API Worker:

```bash
pnpm dev:api
```

3. Start the local Pages dev server:

```bash
pnpm dev:web
```

4. Verify the app behavior locally.

5. If local schema still seems stale, stop and restart `pnpm dev:api`.

## Remote Dev Database Checklist

Use this when you want the deployed app's database schema updated.

1. Apply migrations to the remote D1 database:

```bash
pnpm --dir apps/api exec wrangler d1 migrations apply righelt-db-dev --config wrangler.toml --remote
```

2. Verify applied migrations:

```bash
pnpm --dir apps/api exec wrangler d1 migrations list righelt-db-dev --config wrangler.toml --remote
```

3. Confirm the newest migration appears in the applied list.

## Deploy Workflow Behavior

The deploy workflow in [`.github/workflows/deploy.yml`](/Users/kenankigunda/Documents/righelt/righelt-app/.github/workflows/deploy.yml) applies remote D1 migrations before deploying `righelt-api`, then deploys Pages.

Current behavior:

- target environment: `Dev`
- D1 target: `${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev}`
- migration mode: `--remote`

That means a normal deploy run updates the remote Cloudflare D1 database, not your local Wrangler D1 state.

## Practical Rule of Thumb

If you changed `db/migrations/*.sql`, do both:

1. Apply the migration locally so `pnpm dev:api` matches the new schema.
2. Apply the migration remotely, or let the deploy workflow do it before deploy.

## Commands Summary

Local schema update:

```bash
pnpm db:local
```

Equivalent expanded command:

```bash
pnpm --dir apps/api exec wrangler d1 migrations apply righelt-db-dev --config wrangler.toml
```

Remote schema update:

```bash
pnpm --dir apps/api exec wrangler d1 migrations apply righelt-db-dev --config wrangler.toml --remote
```

Remote migration status:

```bash
pnpm --dir apps/api exec wrangler d1 migrations list righelt-db-dev --config wrangler.toml --remote
```

## Emergency Retention Cleanup Workflow

Use the GitHub Actions workflow `DB Retention Cleanup` when you need to purge stale live-game data from the remote D1 database to recover space quickly.

Important behavior:

- This is an emergency, on-demand cleanup only. It is not part of normal deploys.
- Staleness is defined by `live_games.latest_activity_at`, not `created_at`.
- The cleanup deletes whole stale games and their dependent live rows in D1.
- `DB_RETENTION_HOURS` is required on every run. There is intentionally no default.

How to set `DB_RETENTION_HOURS` for a run:

1. Open GitHub Actions for this repo.
2. Select the `DB Retention Cleanup` workflow.
3. Choose `Run workflow`.
4. Enter the retention window in the `retention_hours` field. Example: `48`.
5. Start the workflow. The job maps that input into the `DB_RETENTION_HOURS` env var and validates it before any deletion runs.

What to expect in the workflow logs:

- A preflight line showing the chosen retention window and target D1 database.
- A pre-cleanup report listing stale row counts for `live_games`, `live_events`, and `live_invites`.
- The delete step executing against the remote D1 database.
- A post-cleanup report showing the remaining stale row counts after deletion.

## Local Retention Cleanup Verification

Use the local helper when you want to verify the exact cleanup flow against Wrangler's local D1 state before running the remote workflow.

Prerequisite:

1. Apply the current schema locally:

```bash
pnpm db:local
```

Run the local helper:

```bash
pnpm db:cleanup:local -- --hours 48
```

What the local helper does:

- Requires `--hours` on every run. There is intentionally no default retention window.
- Validates `--hours` as a positive integer before touching the database.
- Prints the chosen retention window, target local D1 database name, and local persist path.
- Reports stale row counts before cleanup.
- Runs the same checked-in cleanup SQL used by the GitHub workflow.
- Reports stale row counts again after cleanup.

Optional overrides:

```bash
pnpm db:cleanup:local -- --hours 48 --db righelt-db-dev --persist-to /absolute/path/to/local-d1-state
```

Defaults used by the local helper when overrides are omitted:

- DB name: `${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev}`
- Persist path: `.wrangler/state/api-local-dev`

The local helper targets local Wrangler D1 state only. The GitHub workflow targets the remote Cloudflare D1 database.
