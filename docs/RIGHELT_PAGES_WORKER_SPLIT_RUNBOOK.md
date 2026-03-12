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

1. Start the API Worker:

```bash
pnpm dev:api
```

2. Start the Pages site:

```bash
pnpm dev:web
```

`pnpm dev:web` proxies `/api/*` to `http://127.0.0.1:8787` when `API_SERVICE` is not available, so local split-stack development does not depend on deployed Cloudflare bindings.

## Recovery Rules

If direct Worker health is unhealthy:

- fix `righelt-api` first
- do not debug Pages until the Worker is healthy

If direct Worker health is healthy but Pages proxy health is unhealthy:

- fix `API_SERVICE` binding or the proxy function
- do not add D1 or Durable Object bindings back to Pages
