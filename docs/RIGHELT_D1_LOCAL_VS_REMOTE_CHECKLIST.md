# Righelt D1 Local vs Remote Checklist

This document clarifies which D1 database the repo uses in local development versus after deploy, and which migration command to run in each case.

## Current Setup

The Pages app binding is defined in [`apps/web/wrangler.toml`](/Users/kenankigunda/Documents/righelt/apps/web/wrangler.toml).

- Bound D1 name: `righelt-db-dev`
- Binding name used by the app: `DB`

Important distinction:

- `pnpm dev:web` runs `wrangler pages dev` locally and uses Wrangler's local D1 emulation by default.
- The deployed site uses the remote Cloudflare D1 database.

These are not the same database, even if they share the same binding name in config.

## Which Database Am I Hitting?

Use this table:

| Scenario | Runtime | Database |
|---|---|---|
| `pnpm dev:web` | local Wrangler Pages dev server | local Wrangler D1 state |
| deployed site (`righelt.pages.dev`) | Cloudflare Pages/Functions | remote Cloudflare D1 |
| `wrangler d1 migrations apply ...` | local command | local Wrangler D1 state unless `--remote` is passed |
| `wrangler d1 migrations apply ... --remote` | local command against Cloudflare | remote Cloudflare D1 |

## Local Development Checklist

Use this when you want your local `pnpm dev:web` session to have the latest schema.

1. Apply migrations to local Wrangler D1:

```bash
pnpm db:local
```

2. Start local dev server:

```bash
pnpm dev:web
```

3. Verify the app behavior locally.

4. If local schema still seems stale, stop and restart `pnpm dev:web`.

## Remote Dev Database Checklist

Use this when you want the deployed app's database schema updated.

1. Apply migrations to the remote D1 database:

```bash
pnpm --dir apps/web exec wrangler d1 migrations apply righelt-db-dev --config wrangler.toml --remote
```

2. Verify applied migrations:

```bash
pnpm --dir apps/web exec wrangler d1 migrations list righelt-db-dev --config wrangler.toml --remote
```

3. Confirm the newest migration appears in the applied list.

## Deploy Workflow Behavior

The deploy workflow in [`/.github/workflows/deploy.yml`](/Users/kenankigunda/Documents/righelt/.github/workflows/deploy.yml) already applies remote D1 migrations before deploying Pages.

Current behavior:

- target environment: `Dev`
- D1 target: `${CLOUDFLARE_D1_DB_NAME:-righelt-db-dev}`
- migration mode: `--remote`

That means a normal deploy run updates the remote Cloudflare D1 database, not your local Wrangler D1 state.

## Practical Rule of Thumb

If you changed `db/migrations/*.sql`, do both:

1. Apply the migration locally so `pnpm dev:web` matches the new schema.
2. Apply the migration remotely, or let the deploy workflow do it before deploy.

## Commands Summary

Local schema update:

```bash
pnpm db:local
```

Equivalent expanded command:

```bash
pnpm --dir apps/web exec wrangler d1 migrations apply righelt-db-dev --config wrangler.toml
```

Remote schema update:

```bash
pnpm --dir apps/web exec wrangler d1 migrations apply righelt-db-dev --config wrangler.toml --remote
```

Remote migration status:

```bash
pnpm --dir apps/web exec wrangler d1 migrations list righelt-db-dev --config wrangler.toml --remote
```
