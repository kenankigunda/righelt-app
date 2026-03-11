# Summary

Implement the invite and connection rewrite directly on a single branch, without compatibility shims. Replace the current D1-blob plus isolate-local websocket model with one per-game GameRoomDO, one game-scoped websocket protocol for both invite and game routes, and one D1-backed projection/replay model.

This is a straight rewrite, not a migration layer. Old live shell transport behavior may be deleted as soon as the new path is in place.

# Goal And Success Criteria

Goal:
Make invite join, presence, turn state, and move propagation converge in real time across clients through a single authoritative per-game coordinator.

# Success criteria:

#/invite/:token and #/game/:id both show live background state before role choice.
Joining as viewer or player updates all connected participants without manual refresh.
Join approval upgrades the requester live without polling.
Presence converges across clients via websocket lifecycle plus heartbeats.
Reconnect uses lastEventSeq replay when possible, otherwise state_sync.
The old /api/shell/ws?scope=... invalidation path and /presence-driven normal flow are removed.
Invite/game correctness no longer depends on fixed polling.

# Scope

In scope:
Durable Object game authority
Invite/game websocket protocol
D1 projections and replay log
Shell client rewrite for invite/game live state
Regression and end-to-end test rewrite

Out of scope:
Home-page realtime redesign
Offline playground redesign
Auth expansion beyond current device-local identity
Compatibility support for the old transport
Public APIs And Types
Environment

Extend ApiEnv to include:
DB
GAME_ROOMS

Export GameRoomDO from the API handler entrypoint.

# Supported HTTP Surface

Keep these routes:
POST /api/shell/games
GET /api/shell/games
GET /api/shell/invites/:token
GET /api/shell/games/:id
POST /api/shell/games/:id/join
POST /api/shell/games/:id/approve
POST /api/shell/games/:id/moves
POST /api/shell/games/:id/apply
POST /api/shell/games/:id/end-turn
POST /api/shell/games/:id/history
POST /api/shell/games/:id/live
POST /api/shell/games/:id/play-as-both
POST /api/shell/games/:id/go-online

Add this websocket route:
GET /api/shell/games/:id/ws?identityId=...&lastEventSeq=...

Delete:
GET /api/shell/ws?scope=...

Server Event Types
events.ts becomes a discriminated union only for:
state_sync
event_appended
presence_changed
join_request_created
join_request_resolved
error

Payloads:
state_sync: { eventSeq, reason, game }
event_appended: { eventSeq, reason, game }
presence_changed: { eventSeq, identityId, role, connected, game }
join_request_created: { eventSeq, requesterIdentityId, requestedSeat, game }
join_request_resolved: { eventSeq, requesterIdentityId, accepted, seat, game }
error: { code, message }

Delete the generic payload?: Record<string, unknown> shape.

# Client Socket Messages

Browser sends only:
heartbeat: { type: "heartbeat", identityId, lastEventSeq }
ack: { type: "ack", lastEventSeq }

# Persistence Design

shell_live_games

Add:
event_seq INTEGER NOT NULL

Keep:
game_id
created_at
updated_at
latest_activity_at
offline_local
state_json

shell_live_invites

Keep as-is.

shell_live_events

Columns:
game_id
event_seq
event_type
actor_identity_id
created_at
payload_json

Primary key:
(game_id, event_seq)

shell_live_participants

Columns:
game_id
identity_id
role
joined_at
last_heartbeat_at
connected
session_count

Primary key:
(game_id, identity_id)

shell_live_join_requests

Columns:
game_id
requester_identity_id
requested_seat
source
status
requested_at
resolved_at
resolved_by

Primary key:
(game_id, requester_identity_id)

Authority rule:
GameRoomDO is the only writer for live game state.
D1 stores projection and replay state only.

# Runtime Behavior

Invite And Join
Opening #/invite/:token resolves the token and immediately opens the game websocket.
Opening #/game/:id as a guest immediately opens the game websocket.
Both routes render a live, read-only background board and participants before role choice.

Join as viewer:
applied immediately through the DO
transition to canonical #/game/:id
no refresh

Join as player from player invite:
immediate seat claim if open
otherwise disabled with server-provided reason

Join as player from non-player invite or direct URL:
ensure requester is a viewer
create pending join request
requester remains viewer until approval
approver gets blocking gate from pushed event

Approval:
resolved in DO
accepted requester upgrades immediately
competing requests are dismissed immediately
both sides receive pushed updated game state

Presence
Presence is driven only by websocket sessions and heartbeats.
Heartbeat interval: 15s
Disconnect timeout: 35s
Opening a session increments session_count.
Closing the last session or heartbeat timeout marks disconnected.
GET /api/shell/games/:id must not mutate presence.

Reconnect
Client connects with lastEventSeq.
If the DO can replay missed events, send them in order.
Otherwise send state_sync.
Replay fallback is always state_sync, never polling.

Frontend Data Flow
Invite/game route does one initial HTTP hydrate.
After hydrate, websocket-pushed game payloads are authoritative.
Home page may continue polling.
Fixed invite/game polling is removed.
Recovery fetch is allowed only after websocket reconnect failure.

# Implementation Path

## Phase 1 - Shared Contracts And Schema

Files:
events.ts
index.ts
wrangler.toml
new migration under db/migrations/

Work:
Add GAME_ROOMS env typing.
Export GameRoomDO.
Replace generic server event typing with discriminated unions.
Add client socket message types.
Add D1 migration for event_seq, event log, participants, and join requests.

Done when:
type contracts are fixed
wrangler binding exists
migration is defined
tests assert the new websocket route shape and event typing

## Phase 2 - Backend Authority Rewrite

Files:
new game-room-do.ts
rewritten shell-live.ts
updated index.ts
helper module for projection and replay persistence

Work:
Implement GameRoomDO as sole writer for game state.
Route all game-scoped writes through the DO.
Add websocket handling at /api/shell/games/:id/ws.
Persist projection row, event log row, participants, and join requests after every committed mutation.
Load game state from D1 on cold start or restart.
Delete old in-memory socket subscriber model and legacy websocket route.
Remove GET-side presence mutation.

Done when:
no public mutation path bypasses the DO
old /api/shell/ws route is removed
reconnect replay and state_sync fallback work in tests

## Phase 3 - Frontend Live Session Rewrite

Files:
live-sync.js
live-transport.js
app.js
routes.js if needed

Work:
Replace invalidation socket client with a game-session websocket client.
Support heartbeat, ack, reconnect, and lastEventSeq.
Use the game websocket on both invite and game.
Cache and render pushed game payloads as authoritative state.
Remove normal-use /presence calls.
Remove fixed 2-second invite/game passive refresh loop.
Keep one recovery fetch path after websocket failure.

Done when:
invite and game routes no longer depend on polling for correctness
approval and role upgrade happen live
no client code still references /api/shell/ws?scope=...

## Phase 4 - Integration And Cleanup

Work:
Remove dead compatibility code and tests.
Reconcile backend/frontend assumptions about payload shape and replay.
Run full shared acceptance.
Verify no leftover legacy route or transport path remains.

Done when:
all acceptance suites pass
invite/game live behavior matches spec
old transport path is deleted rather than merely unused

# Test Plan

## Backend Tests

Update or add:
concurrent player2 join and player1 move/end-turn do not fork state
competing join requests serialize deterministically
reconnect after DO restart rehydrates from D1 and replays or resyncs correctly
presence converges after connect, timeout, reconnect
game GET is read-only for presence
/api/shell/ws?scope=... is gone
/api/shell/games/:id/ws returns websocket upgrade behavior or 426 in unsupported runtime

## Frontend Tests

Update or add:
game websocket URL uses /api/shell/games/:id/ws
invite route opens live background session before role choice
requester upgrades from viewer to player without refresh
approver sees blocking gate from pushed event
healthy invite/game sessions do not use fixed polling
reconnect uses lastEventSeq
no client code still points to /presence or legacy websocket route
history sidebar keeps appending live moves while user remains in history mode

## End-To-End Scenarios

Prove:
Player 1 creates game, shares player invite, Player 2 joins, and both clients converge live.
Guest opens direct game URL, requests join, remains viewer while pending, upgrades live when approved.
Join approval updates both sides without refresh.
Presence changes propagate consistently.
History mode still receives new move entries.
Invite/game correctness does not depend on fixed polling.

## Acceptance Commands
pnpm test:api-handler
pnpm --filter @righelt/web test -- live-sync live-transport join routing ui-guards
pnpm --filter @righelt/web test -- shell-render-stability history
pnpm --filter @righelt/web test
pnpm test:engine

# Assumptions And Defaults

Backwards compatibility is not required.
#/invite/:token and #/game/:id remain the public routes.
Invite tokens remain opaque and role-based.
Home polling remains as-is.
Offline playground remains unchanged.
Full pushed game payloads are preferred over granular client-side reducers to keep behavior deterministic and simplify the rewrite.