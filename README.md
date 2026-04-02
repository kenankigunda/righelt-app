# Righelt

This repository is the foundation for the Righelt web app.

## Repository Layout

- `docs/`
  - `RIGHELT_RULES_SPEC.md` (formal source-of-truth game specification)
  - `RIGHELT_WEB_APP_SPEC.md` (formal source-of-truth web app behavior specification)
  - `RIGHELT_ENGINE_TEST_MATRIX.md` (engine acceptance scenarios)
  - `RIGHELT_EXECUTION_PLAN_MILESTONE_2_ENGINE.md` (engine implementation + validation plan)
  - `RIGHELT_PLAYER_RULES.md` (player-facing rules guide)
- `archive/`
  - Archived files from the legacy implementation

## Purpose

- Use the documents in `docs/` as the authoritative rules and validation basis for the rewrite.
- Keep `archive/` intact for historical reference only.

## UI Button Hover Addendum

- Button and button-link hover styling follows the existing hover-capability rule and is gated by `data-hover-capability="hover"`.
- Apply button hover effects only as progressive enhancement; do not change required behavior on non-hover/touch devices.

## AI Workflow

- Repo-level default agent rules live in `AGENTS.md`.
- Non-default workflows and advanced AI runbooks live under `docs/ai/`.

### Team Shorthand

Shorthand definitions are case-insensitive and live in `AGENTS.md` as the source of truth.

## License

This project is closed-source and proprietary. See `LICENSE`.

## Live Game Repair Logging

When legacy persisted game data is loaded, the API may emit a `live_game_shape_repaired` warning if it backfills missing fields (for example legacy move metadata).

- Default behavior is **condensed logging** for large repetitive move backfills.
- Full per-field/per-move mismatch logs are available in **verbose mode**.

Enable verbose repair logs with either option:

- Environment variable: `RIGHELT_VERBOSE_REPAIR_LOGS=1`
- Runtime flag: `globalThis.__RIGHELT_VERBOSE_REPAIR_LOGS = "1"`

## Client Live Transport Diagnostics

The web live transport emits compact diagnostic logs for important sync failures (for example confirm/retry transitions, timeout rollbacks, and true desync states).

- Default behavior logs only high-signal warnings/errors.
- Verbose mode adds detailed informational traces (for example stale snapshot suppression, history-mode change events, and revert request/approval traces).

Enable verbose client diagnostics with any of:

- Environment variable: `RIGHELT_VERBOSE_CLIENT_LOGS=1`
- Runtime flag: `globalThis.__RIGHELT_VERBOSE_CLIENT_LOGS = "1"`
- Runtime alias: `globalThis.__RIGHELT_VERBOSE_LIVE_TRANSPORT_LOGS = "1"`
- Browser storage: `localStorage.setItem("righelt.verboseClientLogs", "1")`

## Server Live Room Diagnostics

The live game Durable Object emits compact server diagnostics for high-impact runtime issues in request/approval flows and websocket delivery.

- Default behavior logs high-signal warnings (for example revert request/approval rejections, websocket send failures, and heartbeat-expired sessions).
- Verbose mode adds event-flow traces (for example commit events, websocket replay vs state-sync behavior, and presence transition details).

Enable verbose server diagnostics with either option:

- Environment variable: `RIGHELT_VERBOSE_SERVER_LOGS=1`
- Runtime alias: `globalThis.__RIGHELT_VERBOSE_SERVER_LOGS = "1"` or `globalThis.__RIGHELT_VERBOSE_GAME_ROOM_LOGS = "1"`
