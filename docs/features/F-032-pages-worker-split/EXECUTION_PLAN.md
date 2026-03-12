# F-032 Pages/Worker Split Execution Plan

## Summary

Split the runtime into two deploy targets:

- Pages project `righelt` remains the public site origin and proxies `/api/*`
- Worker `righelt-api` becomes the sole owner of HTTP API execution, D1, WebSocket handling, and `GameRoomDO`

The browser contract stays unchanged on `https://righelt.pages.dev/api/...`.

## Architecture

### Pages

- serves static assets
- runs a thin Pages Function proxy for `/api/*`
- binds `API_SERVICE -> righelt-api`
- owns no D1 binding
- owns no `GAME_ROOMS` Durable Object binding

### Worker

- entrypoint in `apps/api`
- imports `handleApiRequest` and `GameRoomDO` from `packages/api-handler`
- owns `DB`
- owns `GAME_ROOMS`
- owns Durable Object migrations

## Serial Implementation Order

1. Extract `apps/api` as the dedicated Worker runtime.
2. Convert Pages to config-file mode with a `/api/*` proxy function.
3. Update local dev so `pnpm dev:api` and `pnpm dev:web` run separately.
4. Update CI/CD to migrate and deploy `righelt-api` before Pages.
5. Update runbooks and setup docs to reflect the split-stack ownership model.

## Validation

Required acceptance:

- `pnpm typecheck`
- `pnpm test:engine`
- `pnpm test:api-handler`
- `pnpm test:api-worker`
- `pnpm test:web`

Split-stack regression coverage:

- direct Worker `/api/health`
- Pages proxy request/response forwarding
- split-stack health check through Pages proxy
- create-game flow through Pages proxy

## Manual Changes

Cloudflare:

1. Deploy Worker `righelt-api`
2. Ensure Worker owns `DB` and `GAME_ROOMS -> GameRoomDO`
3. In Pages project `righelt`, add service binding `API_SERVICE -> righelt-api`
4. Remove any old Pages-side `DB` or `GAME_ROOMS` bindings

GitHub Actions:

1. Ensure `Dev` environment includes:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_PAGES_PROJECT=righelt`
   - `CLOUDFLARE_API_BASE_URL=https://righelt-api.kenankigunda.workers.dev`
   - optional `CLOUDFLARE_D1_DB_NAME`

Verification:

1. `curl -fsS https://righelt-api.kenankigunda.workers.dev/api/health`
2. `curl -fsS https://righelt.pages.dev/api/health`
3. `POST https://righelt.pages.dev/api/shell/games?offline=1`
