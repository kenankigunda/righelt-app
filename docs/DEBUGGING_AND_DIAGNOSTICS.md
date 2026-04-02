# Debugging And Diagnostics

This document collects the repo's opt-in verbose logging and runtime diagnostics toggles.

## Live Game Repair Logging

When legacy persisted game data is loaded, the API may emit a `live_game_shape_repaired` warning if it backfills missing fields such as legacy move metadata.

- Default behavior uses condensed logging for large repetitive move backfills.
- Verbose mode enables full per-field and per-move mismatch logs.

Enable verbose repair logs with either option:

- Environment variable: `RIGHELT_VERBOSE_REPAIR_LOGS=1`
- Runtime flag: `globalThis.__RIGHELT_VERBOSE_REPAIR_LOGS = "1"`

## Client Live Transport Diagnostics

The web live transport emits compact diagnostic logs for important sync failures such as confirm/retry transitions, timeout rollbacks, and true desync states.

- Default behavior logs only high-signal warnings and errors.
- Verbose mode adds detailed informational traces such as stale snapshot suppression, history-mode change events, and revert request or approval traces.

Enable verbose client diagnostics with any of:

- Environment variable: `RIGHELT_VERBOSE_CLIENT_LOGS=1`
- Runtime flag: `globalThis.__RIGHELT_VERBOSE_CLIENT_LOGS = "1"`
- Runtime alias: `globalThis.__RIGHELT_VERBOSE_LIVE_TRANSPORT_LOGS = "1"`
- Browser storage: `localStorage.setItem("righelt.verboseClientLogs", "1")`

## Server Live Room Diagnostics

The live game Durable Object emits compact server diagnostics for high-impact runtime issues in request or approval flows and websocket delivery.

- Default behavior logs high-signal warnings such as revert request or approval rejections, websocket send failures, and heartbeat-expired sessions.
- Verbose mode adds event-flow traces such as commit events, websocket replay vs state-sync behavior, and presence transition details.

Enable verbose server diagnostics with either option:

- Environment variable: `RIGHELT_VERBOSE_SERVER_LOGS=1`
- Runtime alias: `globalThis.__RIGHELT_VERBOSE_SERVER_LOGS = "1"` or `globalThis.__RIGHELT_VERBOSE_GAME_ROOM_LOGS = "1"`
