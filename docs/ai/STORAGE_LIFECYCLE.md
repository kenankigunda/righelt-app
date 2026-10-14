# Production storage recovery and retention

The approved recovery deletes all existing games and accounts. Historical games in the replacement database remain available through their existing links: cold games move to a private R2 archive after seven days without meaningful player activity, and resume when someone plays. History browsing, receipt retries and socket heartbeats do not restore a game or extend its retention.

## Current preparation

The operator also writes the public generation into the branch configuration, so direct deployment commands carry the same fence. Deployment preflight rejects an environment generation that differs from this configuration. Local fixtures override the production generation.

The candidate binds `DB` to `righelt-db-prod` (`4ce7cf1e-627e-427d-99c8-438f34d51aeb`). That empty replacement is prepared in maintenance mode. The currently deployed `righelt-db-dev` has not been fenced, switched or deleted. The private reset receipt lives at `test-results/storage-reset/receipt.json` in the implementation checkout. Keep it outside Git; it contains the generation and recovery bookmark.

Production R2 is not enabled. Archive, quota enforcement and exclusive-use attestation stay disabled in the committed recovery configuration. The deployment workflow defaults compression writes to false; readers understand both representations. This deliberately makes recovery, compression activation and archive activation separate observable steps.

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

R2 requires the account owner to enable the service. Confirm there are no other untracked R2 consumers in this account. Create a private archive bucket with no public access. Run `node scripts/storage-archive-config.mjs --bucket righelt-archives --exclusive-bucket` to review the exact local configuration; add `--apply` to save it. This adds the binding, hourly scheduler and three guarded flags. It does not create a bucket or deploy.

Before deployment, run `node scripts/storage-usage.mjs --apply --exclusive-bucket` to attest current D1 size and exclusive R2 usage. Inspect an archive/restore canary with a cold test game before enabling normal scheduling. Keep this activation change reviewable and separately authorized.

Shared policy is in `packages/shared-types/src/storage-policy.js`. D1 has a 500 MB planning ceiling, with warning at 70% and growth admission stopped at 80%. Restores reserve conservative headroom based on verified uncompressed bytes, SQLite pages, indices and staging, across crashes and restarts. Failed admission leaves the verified archive authoritative. Reservations are released after trustworthy live verification. R2 stops at 8 GB stored, 800,000 Class A and 8,000,000 Class B operations per month. These are conservative internal caps below the free allowance, not a provider-enforced spending limit. All archive reads/writes reserve operations atomically; uncertain external results remain charged. Stale or unhealthy observations fail closed.

Each scheduler invocation selects at most 20 games. Each capture/restore invocation handles at most five receipt/tombstone rows; background restore draining is limited to 64 steps and later scheduling/retries continue larger histories. Cleanup removes at most 100 rows per transient table and two old objects. Active rooms serialize storage transitions with play. The verified manifest is published before any authoritative live payload is removed. Invitations, Home catalog, exact game state, receipts and tombstones survive archiving. Corrupt/missing objects fail closed, leaving recovery evidence intact.

After disabling new archives, retain the R2 binding and scheduler so archived readers, pending restores, quota observations and safe garbage collection keep working. Disable only `STORAGE_ARCHIVES_ENABLED`; never remove archive objects or their binding to roll back activation. Restore verifies existing retry evidence before accepting it, and never overwrites a conflicting receipt. Orphan object deletion waits at least a day and requires no live manifest/chunk reference.

## Acceptance evidence

Required proof includes both JSON and gzip atomic persistence failures, lost commit responses, real sockets and restart recovery; complete codec round trips for undo and continuation states; archive capture/readback faults; long-history receipt recovery and staged restoration; retained guest/account migrations; exact cutover authority and session guards; capacity and concurrent operation reservations; immediate rearchiving; meaningful seat activity; generation-fenced browser reset; and the broad existing gameplay, sync, history, account and responsive browser suites.

A deployed Cloudflare canary is still required: local Miniflare cannot establish production CPU, subrequest or provider quota behavior. Observe size and archive operation rates over real traffic before raising any caps or increasing scheduler frequency. Free-tier storage is bounded even with archiving; the guards stop growth before exhaustion rather than promising unlimited retention.
