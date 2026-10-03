# Account authorization audit

This inventory tracks T-108.04 against the T-114 transport integration. It is a review checklist, not acceptance evidence. Test results and remaining gaps belong in the T-108 backlog coordination log and test plan.

When account mode is enabled, the server session supplies the actor. A supplied identity, seat, connection ID or session context cannot grant authority. Game ownership has an explicit database version; matching an old guest identity string to an account ID never grants a seat. Account-owned games remain protected if the feature flag is disabled.

## HTTP and room entry points

| Surface | Required account-mode behavior |
| --- | --- |
| `GET /api/shell/bootstrap` | Public bootstrap and explicit authentication-protocol negotiation. |
| `GET /api/shell/games` | Public browsing; personalized lists use the authenticated account only. Debug query parameters cannot select another actor. |
| `GET /api/shell/invites/:token` | Public resolution. Legacy links remain viewable and cannot transfer ownership. |
| `GET /api/shell/games/:id` | Public spectator view or session-derived personalized view. Filter invite tokens, private requests and signed-in analysis data; an empty actor alone does not sanitize the raw game. |
| `POST /api/shell/games` → `/create` | Acknowledged account, protected request, supported protocol; new account-owned game. |
| `POST /api/shell/scenarios/import` → `/create-from-scenario` or `/load-scenario` | Authenticated analysis/play; enforce ownership on an existing target. A legacy source contributes board/history content only, never seats or approvals. |
| `POST /api/shell/history/branch` → `/create-from-scenario` | Same authority rules as import. Requested new IDs cannot reset an existing game. |
| `POST .../:id/join` → `/join` | Session actor requests a seat or viewer role. Invite metadata may identify a target, not the actor. Legacy games cannot gain account-owned seats. |
| `/approve` | Session actor must be the authorized approver. Target identity remains a target only. |
| `/moves`, `/apply`, `/end-turn` | Session actor must match the immutable command envelope and applicable seat. Check session and game revision in the same durable transaction. |
| `/reconcile` | Fresh authorization before disclosing a receipt or attempting a command. Preserve the originating session context in immutable intent. Old-generation reconciliation may report an authorized existing outcome, but cannot execute an unknown old command. |
| `/history`, `/live` | Persist account-specific navigation only with session authority. Public history inspection must not create guest authority. |
| `/play-as-both` | Account actor may claim only the permitted available seat. No client-selected owner. |
| `/presence` | Explicit account presence is authenticated; background presence traffic does not renew inactivity. |
| `/revert-request`, `/revert-approve`, `/revert-reject`, `/revert-rescind` | Enforce requester/approver role from the account session; durable session guard applies to each resulting write. |
| `/legal`, `/piece-moves` | Sign-in and applicable game permissions for analysis. Audit both HTTP and direct room handlers. |
| `POST /api/commands/validate` | Currently a command-shape echo only. It must not execute or persist a command or imply game authorization. |
| `GET /api/health` | Public binding health only; never return secrets. |

## Socket and persistence boundaries

| Boundary | Required behavior |
| --- | --- |
| Upgrade | Exact allowed Origin, supported protocol, cookie-derived actor and matching public session context. Anonymous connections can spectate only. |
| Initial sync and reconnect replay | Recheck authorization, then construct the actor's view. A connection ID is not an authentication session. |
| Inbound command | Bind to the socket's authenticated session, recheck it, and reject identity or context spoofing. |
| Personalized broadcast and receipt | Fresh primary-database authorization read before output. Filter command outcomes separately from game views. Notifications are an optimization, not the authorization source. |
| Hibernation restore | Restore only the connection's captured authentication references, then reauthorize before access. Old guest attachments cannot regain writer authority. |
| Logout/recovery/password change | Write revocation notifications durably with credential/session changes. Close affected sockets; missed delivery cannot permit later output or writes. |
| Candidate persistence | Session guard, T-114 revision guard, state, event and command receipt share a transaction. Do not publish a candidate or successful receipt before durable success. |
| System presence cleanup | May remove stale connection presence without reviving credentials or renewing activity. It cannot grant seats or execute commands. |

The browser generation fence and journal cleanup are T-108.05. Explicit legacy backfill, deployed smoke checks and rollback are T-108.07. Their acceptance remains separate from this server inventory.

## Automated proof locations

- `packages/api-handler/test/auth-game.test.mjs`: public/private projection, retained history selection, receipt filtering, immutable session context and bounded-request errors.
- `packages/api-handler/test-runtime/auth-game-authority.test.mjs`: real D1/room routing, the route spoof matrix, cross-browser ownership, transactional revocation, legacy collisions, rollback protection, socket restoration and notification failures.
- `packages/api-handler/test/auth-credentials.integration.test.mjs`: credential/session revocation and recovery transactions, including concurrent operations and lost responses.

The socket restoration case reconstructs saved attachments in the local runtime. It does not claim actual deployed isolate eviction. A separately bounded client-close observation records the local runtime's approximately ten-second HTTP-triggered handshake delay; immediate authority removal and absence of protected output are independent assertions.
