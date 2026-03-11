# Cloudflare Pages Binding Runbook

Use this runbook when the deployed site reports a missing runtime binding, especially when game creation fails with `server_misconfigured_game_rooms_binding`, `/api/health` shows `"gameRooms": false`, or the Pages dashboard says `No durable objects found`.

## Required Production Binding

The production Pages project `righelt` must expose this Durable Object binding:

- binding name: `GAME_ROOMS`
- Durable Object class: `GameRoomDO`
- source Worker script: `righelt-game-rooms`

The Durable Object class is hosted by the dedicated Worker config in [`apps/game-room-worker/wrangler.toml`](/Users/kenankigunda/Documents/righelt/apps/game-room-worker/wrangler.toml). The Pages app binds to that Worker from [`apps/web/wrangler.toml`](/Users/kenankigunda/Documents/righelt/apps/web/wrangler.toml).

## Restore Production

1. Deploy the Durable Object Worker so Cloudflare has a registered class to bind:
   ```bash
   pnpm exec wrangler deploy --config apps/game-room-worker/wrangler.toml
   ```
2. Open Cloudflare Dashboard.
3. Go to `Workers & Pages` -> `righelt` -> project settings for Functions/Bindings.
4. Add or repair the Durable Object binding:
   - binding: `GAME_ROOMS`
   - class: `GameRoomDO`
   - script: `righelt-game-rooms`
5. Save the project settings.
6. Redeploy the current `main` revision to Pages if Cloudflare does not apply the binding immediately to the active deployment.

If the dashboard currently shows `No durable objects found`, step 1 has not happened yet for the account/environment you are editing.

## Verify After Restore

1. Check health:
   ```bash
   curl -fsS https://righelt.pages.dev/api/health
   ```
2. Expected signal:
   - `"ok": true`
   - `"bindings": { "db": true, "gameRooms": true }`
3. Check live game creation:
   ```bash
   curl -fsS -X POST 'https://righelt.pages.dev/api/shell/games?offline=1' \
     -H 'content-type: application/json' \
     --data '{"identityId":"smoke-player","playgroundMode":false,"offlineLocal":false}'
   ```
4. Expected signal:
   - HTTP `200`
   - JSON body with `"ok": true`

## Regression Signal

The deploy workflow in [`.github/workflows/deploy.yml`](/Users/kenankigunda/Documents/righelt/.github/workflows/deploy.yml) now deploys the `righelt-game-rooms` Worker before the Pages deployment, and still fails the smoke test when the head deployment reports a missing `GAME_ROOMS` binding.
