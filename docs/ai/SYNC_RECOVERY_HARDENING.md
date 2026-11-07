# Sync and recovery hardening

This change addresses three demonstrated liveness gaps in main `5a7d6c7`. The mobile production incident remains a separate diagnosis: the server accepted four rush steps, but the phone's exact failed request and local recovery state were unavailable. These fixes must not be called a proven repair for that historical incident.

## Findings and fix

| Failure state | Source cause | Resulting behavior |
| --- | --- | --- |
| A false offline hint leaves the game disconnected until a later online event. | The outer store closes sockets and removes desired games, contradicting the socket client's hint-only policy. | The active route stays desired. Healthy sockets continue, and failed sockets retain bounded HTTP/reconnect recovery. Logout, retirement and leaving the game still disconnect. |
| A valid socket keeps receiving heartbeats while input remains blocked. | Initial state arrival is treated as completion of asynchronous readiness. A legitimate admission/epoch deferral is never retried. | State receipt and accepted readiness are separate. Valid current frames retry deferred readiness under one connection owner. Stale sockets cannot complete a replacement's recovery. |
| A synchronous WebSocket constructor exception prevents fallback. | Construction happens before timeout ownership without a catch. | The ordinary HTTP recovery and bounded reconnect owner handle the failure. Error and metric observers cannot interrupt it. |
| Application completion logs expose invitation tokens. | Raw request pathname is logged. | Logs contain canonical route templates, including categorical unknown routes. Provider-managed invocation metadata is a separate configuration concern. |
| A long recovery has no remotely available evidence. | Issue reports are browser-local, and some stalled episodes have no failed request to create an incident. | Scalar recovery transitions, refusal gates and a delayed blocked snapshot can reach existing server observability logs through an independent upload path. |

Unknown gameplay outcomes retain their original durable envelope and sender. Timeout does not become rejection. No new automatic gameplay replay, admission permission, lease takeover or deadline relaxation is introduced.

## Independent review loop

The first reviews examined transport/journal ownership, mobile lifecycle/computer control, and diagnostics privacy/operations separately. Reviewers authored composed regression tests before product fixes. Against unchanged product code, ten tests produced three passes and seven failures. The repaired code passed all ten, followed by additional stale-socket and throwing-observer cases.

A second review challenged the combined source and primary results. It found uploader retirement could leave an ignored-abort request pending, completion evidence could precede ready-state normalization, accepted/deferred readiness metrics lacked a result, and local proxy origin rewriting could reject valid reports. Each finding received a narrow correction and targeted coverage. Upload allowance is shared across transport/account replacement within a page. A new document load starts a new allowance.

Review is bounded to the coherent change and subsequent changed findings. Tests distinguish implemented failure modes from the unproven production trigger.

## Failure-mode test plan

| Mode | Primary proof |
| --- | --- |
| False offline hint at startup or during a healthy socket | Real facade/transport integration, desired game retained and healthy socket preserved. |
| Offline hint followed by actual socket failure, online event, or page restoration | Real facade integration, HTTP recovery and replacement socket without gameplay writes. |
| Lost reply after server commit | Real journal/API integration, identical original envelope and one committed move. |
| Readiness waits on admission that is replaced by another refused action | Real transport/rules/IndexedDB integration, false readiness then current-frame retry, zero admitted commands. |
| Heartbeat bursts during an unresolved command | One readiness owner, original journal identity, one sender and one eventual commit. |
| Replacement socket while old readiness is pending | Old completion cannot mark replacement ready or release its owner. |
| Constructor, metric or diagnostic consumer throws | Fallback proceeds and recovery authority remains intact. |
| Silent recovery past the intervention boundary | One delayed scalar snapshot reaches the actual API without creating a gameplay/reconcile request. |
| Diagnostics offline, malformed, stalled, rejected or flooded | Byte/event/time/rate bounds, no recursive report, no gameplay effects, retirement aborts and settles ownership. |
| Auth or storage-generation failure | Reporting route remains independent of auth, DB and DO access. All gameplay routes retain their existing gates. |
| Mobile rush workflow | One touch workflow in Chromium and WebKit: accepted rush, positive same-socket later heartbeat under a false hint, synthetic page restoration, successful server report, failed later report, accepted second rush, two distinct command IDs and two revisions. |

The browser test uses a disposable catalog-style test position and emulated touch. Synthetic pagehide/pageshow tests application lifecycle handlers, not an operating-system suspension. Physical iPhone background eviction, network switching and real radio loss remain device acceptance. Existing recovery pressure, socket ownership, journal, computer lease, storage reset and auth suites cover adjacent variants. The CI matrix and released validator remain release gates.

## Remote diagnostics contract

The authoritative contract is `packages/shared-types/src/recovery-diagnostics.js`. The browser output is generated. It is deliberately narrower than full local issue reports.

- `/api/diagnostics/recovery` writes structured `client_recovery_diagnostics` logs through existing Worker observability. It does not persist gameplay data, read game authority, or touch D1/DO/authentication. No new service, database migration or provider configuration is introduced.
- Client uploads use the raw first-party fetch path with credentials omitted and redirects rejected. They never enter account requests, command journals or gameplay retry loops. Failed batches are dropped. Reports are memory-only and discarded on retirement.
- Event values are validated twice. Allowed values include generated event/episode/request correlation IDs, strict game identifiers, recovery gates, counters, event cursors, pending age, flags and build observations. Player/account identities, authorization context, credentials, invitation URLs/tokens, full boards/actions, raw headers/bodies, raw browser strings, timezone/location and arbitrary error text are excluded.
- Observed deployment SHA is separate from loaded-build evidence. Reading fresh deployment metadata cannot establish which cached asset bytes a browser loaded. Loaded build remains unavailable unless independently stamped/proven.
- Maximum body is 16 KiB and 16 events. Client memory holds at most 64 events, with dropped counts marked. A page allows at most 20 batches per hour across uploader replacements. Each request owns a five-second deadline, independently raced even if a fetcher ignores abort. Retirement settles that wait.
- Intake sheds load at 120 requests per minute per Worker isolate. This is not distributed anti-abuse protection. Same-origin browser requests are required. Local proxy hops accept only explicit configured origins on loopback destinations. Production does not trust forwarded origins or wildcard origins.
- Reports describe untrusted client claims. A 202 response acknowledges the logging call, not durable retention. Provider sampling, access and retention remain external constraints. Deduplicate by event ID. Missing reports do not prove an event did not occur.
- Application route redaction does not establish that provider-managed invocation metadata contains no URLs. Existing observability configuration is unchanged.

Use `docs/ai/CLOUDFLARE_INVESTIGATION.md` for bounded read-only queries. Filter the diagnostic event, then correlate the game/episode/request with API and room timing logs. Treat the latest observed request as context unless the report explicitly identifies a request failure. Server receipts remain the authority for command outcomes.
