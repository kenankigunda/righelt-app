# Righelt Free-Tier Reference Architecture (v1)

Status: Recommended deployment and operations architecture for low-user launch on free tiers.

This architecture is optimized for:
- Lowest possible monthly cost at launch (target: $0).
- Strong command-line operability.
- GitHub Actions CI/CD.
- Codex-assisted development workflows.

It is aligned to:
- `docs/RIGHELT_WEB_APP_SPEC.md` (including Playground mode).
- `docs/RIGHELT_RULES_SPEC.md`.
- `docs/RIGHELT_ENGINE_TEST_MATRIX.md`.

## 1. Goals and Constraints

- Run the full web app (live games, viewers, invites, presence, history, tutorial flags, playground mode) on free tiers.
- Keep architecture simple enough for a small team.
- Preserve deterministic rule evaluation and replayability.
- Avoid click-heavy operations; prefer repo-driven infrastructure and scripts.

## 2. Platform Selection

Primary platform:
- Cloudflare Pages (frontend hosting)
- Cloudflare Workers (HTTP API)
- Cloudflare Durable Objects (per-game realtime coordination)
- Cloudflare D1 (durable relational storage)

Optional support services:
- Cloudflare KV (lightweight counters/tokens)
- Cloudflare R2 (exports and backup artifacts)

CI/CD:
- GitHub Actions

## 3. High-Level Architecture

Components:
1. `apps/web`: frontend (home, game board, history sidebar, tutorial, playground controls).
2. `apps/web/functions`: same-origin API routes (Pages Functions).
3. `packages/api-handler`: shared HTTP API handler logic.
4. `packages/game-engine`: deterministic game engine shared by server runtime and tests.
5. `packages/shared-types`: command/event schemas and shared DTOs.
6. `db/migrations`: D1 SQL migrations.

Runtime flow:
1. Client sends HTTP command (`/api/games/:id/commands`) or opens game WebSocket.
2. Worker routes game-scoped operations to `GameRoomDO(gameId)`.
3. `GameRoomDO` validates authority and legality (using `game-engine`), applies action, appends event(s), and broadcasts updates.
4. Durable records are written to D1 (`games`, `participants`, `game_events`, snapshots, etc.).
5. Lobby and history queries read from D1 projections.

## 4. State Model and Authority

Authoritative execution:
- `GameRoomDO` is the single writer for each game and serializes all game actions.
- D1 is the durable source for replay/history and recovery.

Persistence strategy:
- Event-sourced per game (`game_events` append-only with monotonically increasing `event_seq`).
- Snapshot every N moves (`game_snapshots`) for efficient history reconstruction.

## 5. Playground Mode Integration

Game fields:
- `mode`: `STANDARD | PLAYGROUND`
- `playground_controller_device_id`: device controlling both seats while in playground

Rules:
- Both logical seats (`P1`, `P2`) remain intact; only control mapping differs.
- In playground mode, only the controller device can submit actions for either side, respecting turn order and legality.
- Playground UI preview overlays may include non-submittable destination hints when blocked solely by destination supply; these are carried separately from legal actions in preview payloads.
- Playground apply responses may also carry transient `removedPieces` notices so the client can animate and explain forced removals without mutating engine history/state contracts.
- Invite recipients may join only as `Viewer` while playground is active.
- `exit_playground` converts to standard seating and re-enables normal player-join policies.

## 6. Identity, Role, and Authorization

Identity:
- Device-local token persisted by browser; maps to server-side `device_id`.

Authorization model:
- Seat identity (`P1`/`P2`) is distinct from seat controller (device allowed to act).
- Command authorization checks seat controller and turn ownership.
- Join policy checks source context:
  - player-shared invite
  - viewer-shared invite
  - home-page list entry

## 7. Realtime and Presence

Transport:
- Game WebSocket endpoint: `/api/games/:id/ws`.

Core server events:
- `state_sync`
- `event_appended`
- `presence_changed`
- `join_request_created`
- `join_request_resolved`
- `playground_exited`
- `error`

Presence:
- Heartbeats tracked in `GameRoomDO`.
- Timeout marks participant disconnected and emits `presence_changed`.
- Reconnect uses `lastSeenEventSeq` catch-up replay before interaction resumes.

## 8. API Surface (Reference)

- `POST /api/games` (create; supports `mode`)
- `POST /api/games/:id/invites`
- `POST /api/games/:id/join`
- `POST /api/games/:id/join-requests/:requestId/approve`
- `POST /api/games/:id/commands`
- `POST /api/games/:id/exit-playground`
- `GET /api/games/:id`
- `GET /api/games/:id/history`
- `GET /api/lobby`
- `GET /api/tutorial-state`
- `POST /api/tutorial-state/complete`

## 9. D1 Schema (Minimum)

Required tables:
- `devices`
- `games`
- `participants`
- `invites`
- `join_requests`
- `game_events`
- `game_snapshots`
- `viewer_metrics`
- `tutorial_state`

Required indices/projections:
- Lobby sort key on `games.latest_activity_at DESC`
- `game_events(game_id, event_seq)`
- participant lookup by `(game_id, device_id)`

## 10. Repository and Ops Layout

Recommended structure:
- `apps/web`
- `apps/web/functions`
- `packages/api-handler`
- `packages/game-engine`
- `packages/shared-types`
- `db/migrations`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`

CLI-first commands (example):
- `pnpm test`
- `pnpm test:engine`
- `pnpm dev:web`
- `pnpm deploy:staging`
- `pnpm deploy:prod`

## 11. CI/CD (GitHub Actions)

`ci.yml` (PRs):
1. Install dependencies.
2. Lint/typecheck.
3. Unit tests.
4. Engine acceptance matrix tests.

`deploy.yml` (main/tag):
1. Build frontend artifacts.
2. Apply D1 migrations.
3. Deploy Pages (with Functions) via Wrangler.
4. Run post-deploy health checks.

## 12. Free-Tier Guardrails

To stay within free quotas:
- Coalesce presence updates and heartbeat frequency.
- Batch realtime event frames where possible.
- Snapshot every N moves to reduce replay reads.
- Paginate lobby/history APIs.
- Rate limit command endpoints per device/game.
- Reject oversized or malformed payloads early.

## 13. Recovery and Durability

- Event log allows deterministic rebuild of game state.
- Snapshots reduce recovery time.
- Optional scheduled export of D1 data to R2 for additional backup.

## 14. Scale Path (When Free Tier Is Exceeded)

Phase 1:
- Keep architecture unchanged, move to paid usage on same Cloudflare stack.

Phase 2:
- Add stronger lobby projections/caching and optimize event/read patterns.

Phase 3:
- Introduce multi-region strategies only if latency and traffic require it.

This staged path minimizes migration risk while preserving current app contracts.
