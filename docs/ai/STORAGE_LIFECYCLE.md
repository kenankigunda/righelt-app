# Production storage recovery and retention

The approved recovery deletes all existing games and accounts. Historical games in the replacement database remain available through their existing links: cold games move to a private R2 archive after seven days without meaningful player activity, and resume when someone plays. History browsing, receipt retries and socket heartbeats do not restore a game or extend its retention.

## Current production state

Recovery and compression are deployed. Production uses `righelt-db-prod` (`4ce7cf1e-627e-427d-99c8-438f34d51aeb`) and generation `reset-986736d3-c72e-4539-9edc-6597847f64e7`. The former full database was fenced, verified and retired. The private recovery receipt remains in `test-results/storage-reset/receipt.json` and must stay outside Git.

The private Standard bucket `righelt-archives` exists, with public access disabled and no custom domains. The committed configuration binds it but defaults archive deployment mode to `disabled`. Compression remains enabled. Archive activation follows the staged procedure below.

## Recovery sequence

Use Node 22 and the existing OS-keyring Cloudflare login. The operator pins Wrangler because the older installed version cannot read the current encrypted OAuth credential. Run from the intended candidate checkout. Every mutation requires explicit targets, a private receipt and `--apply`. Never export credentials into a shell variable.

1. Before merge/deployment, set repository variable `RIGHELT_STORAGE_GENERATION` to the receipt's generation and remove a stale `CLOUDFLARE_D1_DB_NAME` override or set it to `DB`. Deployment preflight rejects a different migration target and a missing generation. Keep `RIGHELT_STORAGE_COMPRESSION=false` for first recovery.
2. Run `node scripts/storage-reset.mjs fence --old righelt-db-dev --new righelt-db-prod --receipt test-results/storage-reset/receipt.json --apply`. This records Time Travel information before putting the old database in maintenance. The tool refuses an activated account cutover because that requires a different reviewed recovery procedure.
3. Deploy the reviewed commit using the normal deployment workflow. It applies all migrations to the replacement and deploys both API and web while maintenance remains enabled. Old Worker versions still target the fenced old database. New Durable Object names, HTTP writes, WebSocket URLs, frames and browser journals use the new generation.
4. Run the operator's `reopen` action with the same arguments plus `--origin https://righelt.pages.dev --apply`. It requires the old fence and the deployed generation before opening the new guest database.
5. Run `verify` with those arguments. It creates a disposable smoke game and checks accepted play, exactly-once retries, reload, history, invitations and two generation-fenced WebSocket snapshots across reconnect. Also confirm delivery in the browser and repeat with two stale tabs before retirement. Read-only `verify` cannot authorize deletion.
6. Only after the new production canary passes, run `retire` with the same arguments. It requires a successful canary less than one hour old, the deployed generation and the old fence. This deletes the old database. Do not retire it while checking rollback behavior.

If deployment fails, keep both databases closed and repair the candidate. Before retirement, recovery means rebinding the old database and restoring its recorded Time Travel bookmark if necessary; the old generation must also be restored. A database bookmark does not back up Durable Object state. Do not reopen old writers alongside new writers or revert storage readers while compressed payloads or archives exist.

## Compression activation

After recovery canaries pass, deploy `RIGHELT_STORAGE_COMPRESSION=true`. Exact game JSON is gzip-compressed and checksummed; no history replay or engine recomputation occurs. The database retains a small Home card and one authoritative compressed payload. Full-state events are no longer retained; durable command receipts and legacy tombstones remain the retry authority. Existing sockets still receive transient events, and reconnect receives a full snapshot.

Disabling compression writes is supported by the new reader: the next successful mutation atomically replaces the compressed authority with full JSON. Do not deploy an older reader against compressed data. Inspect `storage-usage.mjs` and provider storage observations before and after activation; never infer billed size from JSON length alone.

## Archive activation and free-tier guards

One activation PR adds deployment controls, isolated fixtures and bounded archive continuation. `RIGHELT_STORAGE_ARCHIVE_MODE` in GitHub environment `Dev` selects `disabled`, `canary`, `active` or `drain`. Missing mode defaults to disabled. Deployment derives a temporary configuration beside the API config, preserving relative paths, resources and generation, then removes the temporary file. Unknown modes, changed production resources and invalid canary settings fail preflight before deployment.

- `disabled`: bucket bound, archive and budget flags false, no scheduled trigger. This is only the initial pre-archive state.
- `canary`: archives and guards true, schedule `* * * * *`, only `RIGHELT_STORAGE_ARCHIVE_CANARY_GAME_ID` selected for maintenance. The canary may refresh shared storage observations but skips unrelated cleanup. Ordinary reads and restores remain available.
- `active`: archives and guards true, schedule `0 */6 * * *`. Cold games are normally discovered within six hours after seven inactive days.
- `drain`: new archives false, guards true, six-hour maintenance retained for restores and safe cleanup. Keep the bucket and compatible readers.

Archive capture uses separate serialized room invocations, with at most 64 background chunk invocations per game per sweep. Each receipt chunk still handles at most five rows. Interrupted or exhausted chains retain their cursor for the next sweep. Errors and quota rejection stop the chain. Existing presence alarms are unchanged.

### Operator sequence

Use Node 22 and the keychain-backed Wrangler login. Never export a credential. Every canary mutation requires `--apply`. Before starting, verify the bucket is private, Standard and the only R2 consumer in the account. Record D1 size and the existing public deployment. Do not change database bindings, compression, storage generation or account activation.

1. Merge after final-head CI and bounded independent review. Deploy with archive mode disabled through the normal workflow. Verify revision, private binding and ordinary play.
2. Run `node scripts/storage-archive-canary.mjs prepare --receipt test-results/storage-archive-activation/receipt.json --origin https://righelt.pages.dev --revision MERGED_SHA --apply`. It records a new disposable game before creating it and persists commands before sending them. It accepts fifteen commands and binds the private receipt to revision, origin, resources and generation.
3. Run `node scripts/storage-usage.mjs --apply --exclusive-bucket` after confirming exclusive usage. Set Dev archive mode to `canary`, set the canary game variable to the receipt's game ID, and dispatch the normal deployment workflow. Confirm the resulting Worker version and minute trigger.
4. Run the canary operator's `age` action with the same explicit arguments and `--apply`. Only the receipt's owned game at the expected revision is aged. Poll the `status` action until its manifest is published, its live payload is absent and its live receipts have been pruned.
5. Run `verify --apply`. It checks exact board/history, Home, invitations, read-only retention, archived retries, restoration, new-command retries, reload, reconnect and a subsequent accepted command delivered to two simultaneous WebSockets. Record provider logs and a real browser archive/history/restore walkthrough. Check an ordinary game too.
6. Run `promotion-check` without `--apply`. It requires complete proof less than one hour old matching the public revision, Worker version, resources and generation. Set `RIGHELT_STORAGE_ARCHIVE_ACTIVATED=true`, remove the canary game variable and set mode `active`. Dispatch the normal workflow for the same merged revision. The activation latch makes later disabled deployments fail preflight.
7. Verify the active flags, six-hour trigger, absence of the canary/minute trigger, private boundaries and a fresh gameplay smoke. Observe the first normal six-hour maintenance completion for the active Worker before final acceptance. Preserve its log and updated storage observations with the local evidence report.

If a canary fails, retain its private receipt and evidence. Resume the same command IDs when retrying. After activation, rollback is `drain`, never disabled or older readers. A drained deployment keeps guards, objects, restoration and the maintenance schedule. Do not resume paused validation publication or automations.

Shared policy is in `packages/shared-types/src/storage-policy.js`. D1 has a 500 MB planning ceiling, with warning at 70% and growth admission stopped at 80%. Restores reserve conservative headroom based on verified uncompressed bytes, SQLite pages, indices and staging, across crashes and restarts. Failed admission leaves the verified archive authoritative. Reservations are released after trustworthy live verification. R2 stops at 8 GB stored, 800,000 Class A and 8,000,000 Class B operations over a conservative rolling 31-day window. This includes the whole boundary day and avoids resetting allowance at a calendar boundary that differs from the account billing cycle. These are conservative internal caps below the [Standard storage free allowance](https://developers.cloudflare.com/r2/pricing/), not a provider-enforced spending limit. The account renewal date can differ from the calendar month, as described in [Cloudflare billing policy](https://developers.cloudflare.com/billing/understand/billing-policy/). All archive reads/writes reserve operations atomically; uncertain external results remain charged. Stale or unhealthy observations fail closed.

Each routine sweep selects at most 20 games. Each capture/restore invocation handles at most five receipt/tombstone rows; background restore draining is limited to 64 steps and later scheduling/retries continue larger histories. Cleanup removes at most 100 rows per transient table and two old objects. Active rooms serialize storage transitions with play. The verified manifest is published before any authoritative live payload is removed. Invitations, Home catalog, exact game state, receipts and tombstones survive archiving. Corrupt/missing objects fail closed, leaving recovery evidence intact.

After disabling new archives, retain the R2 binding and scheduler so archived readers, pending restores, quota observations and safe garbage collection keep working. Disable only `STORAGE_ARCHIVES_ENABLED`; never remove archive objects or their binding to roll back activation. Restore verifies existing retry evidence before accepting it, and never overwrites a conflicting receipt. Orphan object deletion waits at least a day and requires no live manifest/chunk reference.

## Acceptance evidence

Required proof includes both JSON and gzip atomic persistence failures, lost commit responses, real sockets and restart recovery; complete codec round trips for undo and continuation states; archive capture/readback faults; long-history receipt recovery and staged restoration; retained guest/account migrations; exact cutover authority and session guards; capacity and concurrent operation reservations; immediate rearchiving; meaningful seat activity; generation-fenced browser reset; and the broad existing gameplay, sync, history, account and responsive browser suites.

A deployed Cloudflare canary is still required: local Miniflare cannot establish production CPU, subrequest or provider quota behavior. Observe size and archive operation rates over real traffic before raising any caps or increasing scheduler frequency. Free-tier storage is bounded even with archiving; the guards stop growth before exhaustion rather than promising unlimited retention.
