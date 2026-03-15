# Righelt Pages + Worker Split Runbook

This runbook describes the split-stack production shape:

- Pages project `righelt` serves the site and proxies `/api/*`
- Worker `righelt-api` owns D1, `GameRoomDO`, and all API execution

## Required Cloudflare Bindings

### Pages project `righelt`

- service binding `API_SERVICE -> righelt-api`
- no `DB` binding
- no `GAME_ROOMS` Durable Object binding

### Worker `righelt-api`

- D1 binding `DB`
- Durable Object binding `GAME_ROOMS -> GameRoomDO`

## Deploy Order

1. Apply D1 migrations through `apps/api`
2. Deploy `righelt-api`
3. Deploy Pages project `righelt`
4. Run direct Worker health smoke
5. Run proxied Pages health smoke
6. Run create-game smoke through the Pages origin

## Verification Commands

Direct Worker health:

```bash
curl -fsS https://righelt-api.kenankigunda.workers.dev/api/health
```

Expected signal:

- `"ok": true`
- `"bindings": { "db": true, "gameRooms": true }`

Pages proxy health:

```bash
curl -fsS https://righelt.pages.dev/api/health
```

Expected signal:

- same payload as direct Worker health

Create-game smoke:

```bash
curl -fsS -X POST 'https://righelt.pages.dev/api/shell/games?offline=1' \
  -H 'content-type: application/json' \
  --data '{"identityId":"smoke-player","playgroundMode":false,"offlineLocal":false}'
```

Expected signal:

- `"ok": true`
- `game.id` is present

## Local Development

Run Pages only:

```bash
pnpm dev:web
```

This starts the site on `http://localhost:8788` only. API-backed flows will return `local_api_unavailable` until the local API Worker is also running.

Alternate local Pages ports for concurrent worktrees:

- `pnpm dev:a` or `pnpm dev:web:a` -> `http://localhost:8789`
- `pnpm dev:b` or `pnpm dev:web:b` -> `http://localhost:8790`
- `pnpm dev:c` or `pnpm dev:web:c` -> `http://localhost:8791`

Run the API Worker only:

```bash
pnpm dev:api
```

Alternate local API worker ports for concurrent worktrees:

- `pnpm dev:api:a` -> `http://127.0.0.1:8792`
- `pnpm dev:api:b` -> `http://127.0.0.1:8793`
- `pnpm dev:api:c` -> `http://127.0.0.1:8794`

Run the full split stack in one command:

```bash
pnpm dev:all
```

`pnpm dev:all` starts the local `righelt-api` Worker first, waits for `http://127.0.0.1:8787/api/health`, and then starts the Pages site on `http://localhost:8788`. Local `/api/*` requests are proxied to the local API Worker, and local live WebSocket traffic connects directly to `ws://127.0.0.1:8787`.

Alternate full-stack variants keep the Pages and API worker ports paired:

- `pnpm dev:all:a` -> Pages `8789`, API `8792`
- `pnpm dev:all:b` -> Pages `8790`, API `8793`
- `pnpm dev:all:c` -> Pages `8791`, API `8794`

If you need a fresh local D1 state per suffix, run the matching migration command first:

- `pnpm db:local:a` or `pnpm d1:migrate:dev:a`
- `pnpm db:local:b` or `pnpm d1:migrate:dev:b`
- `pnpm db:local:c` or `pnpm d1:migrate:dev:c`

## Recovery Rules

If direct Worker health is unhealthy:

- fix `righelt-api` first
- do not debug Pages until the Worker is healthy

If direct Worker health is healthy but Pages proxy health is unhealthy:

- fix `API_SERVICE` binding or the proxy function
- do not add D1 or Durable Object bindings back to Pages
