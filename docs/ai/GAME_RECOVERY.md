# Game recovery and local diagnostics

A game has one generation-fenced HTTP recovery owner. Socket repair runs independently. A confirmed receipt settles its original command; authoritative reconciliation can resume mutations while socket repair continues. Unknown outcomes retain the command journal and tentative projection. Timeout never means rejection.

After successful HTTP recovery, failed replacement sockets that never became ready repair in the background without interrupting board input. Failed HTTP fallback, newer advertised state, lifecycle restoration, and loss of a ready socket require blocking recovery again. Stronger evidence supersedes an in-progress background pass and forces a fresh snapshot; late responses cannot restore obsolete readiness.

## Deadlines and lifecycle

HTTP requests include body parsing within five seconds. Journal opening and each transaction have five-second deadlines. A complete recovery pass owns work for at most ten seconds, including hydration and existing attempts. Failure releases ownership and schedules another pass using bounded jittered backoff. Command overdue feedback starts fifteen seconds from durable submission metadata; retries and refresh restoration preserve that timestamp.

Manual reconnect supersedes older recovery and socket owners. Repeated button presses share the same attempt. It preserves identity, original command envelopes, dependencies, history selection, and durable journal records. Late hydration, responses, and callbacks are fenced. `pageshow`, visibility restoration, and online transitions resume recovery; retiring a client removes its listeners.

Shared mutations remain blocked while a command is unknown, an explicitly required snapshot is missing, or storage/session safety cannot be established. Settled receipts stay in memory when exact journal cleanup fails, and Retry saving retries cleanup without resubmitting accepted intent. Normalized state comparison is shared by client and server and clones inputs before resolution.

## Server acceptance and delivery

State, event, and receipt persistence remain atomic and serialized. Acknowledgment follows commit without awaiting ordered socket delivery. Delivery captures event and authorization environment, preserves per-game order, reads public names once per broadcast, and rechecks each recipient's current authorization. Delivery failure is repaired through HTTP reconciliation. A client deadline never releases a server mutation queue while a write is still running.

Request IDs are UUIDs forwarded through Pages and API, returned on HTTP responses, and correlated with command/revision/build timing logs. IDs confer no authority. Version metadata uses the Cloudflare version binding. No protocol version bump or database migration is needed.

## Presentation and diagnostics

Routine reconnecting uses a board background sweep immediately, the shared angular loading cue after 200 milliseconds, and a reconnecting alert after four continuous seconds. Retries preserve the episode clock. Recovery removes feedback immediately. Reduced motion uses a static treatment, and loading remains silent. Shared loading primitives match PR #129; recovery owns blocking and timers.

Unexpected issues and overdue work expose a muted caret with a 44-pixel hit target. Details include a compact summary and Copy. Copies contain human-readable context plus versioned JSON; clipboard failure leaves selectable text. Open resolved reports stay available until dismissed, and Recent issues in the debug panel restores local reports after refresh.

Evidence is allowlisted and local only. It excludes credentials, authorization context, raw headers/bodies, player identities/names, invite secrets, IP/location, and unrelated history. Limits are 24 hours, 200 retained events, 20 reports, and one MiB. Initial evidence is immutable; recovery attempts append. Persistence is debounced, guarded, independent of the command journal, and falls back to memory. Clear diagnostics removes retained reports.

## Investigation and release gates

Use [the read-only Cloudflare workflow](CLOUDFLARE_INVESTIGATION.md). The reported production game must never be mutated for testing. Accepted push and retreat receipts, deployment timing, and a cancelled socket establish a plausible trigger; they do not prove historical response consumption or client transitions. The persisted 21.5-second move gap does not measure the reported wait.

Regression coverage includes HTTP recovery with failed sockets, lost commit replies, stale generations, journal deadlines, response parsing deadlines, page restoration, two tabs, Worker restarts, history, push/retreat/follow, diagnostics, and quiet/reduced-motion presentation. Run installed pinned validation tools with an explicit candidate checkout and keep publication paused. Automated WebKit probes do not replace a physical iPhone acceptance pass.

Merge and deployment activation require separate authorization. After authorized deployment, use a disposable game and inspect acknowledgment latency, queue wait, pending-command age, recovery duration, and repeated connection repairs. Do not resume paused schedules or create monitoring implicitly.
