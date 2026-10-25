# Storage writer activation

This rollout enables larger compressed game states and metadata-only writes. The user authorized preparation, coordinated merge/deployment and full activation in the recovery chat on October 25, 2026. It does not authorize changing account activation, models, database generation, archive mode, budget settings, retention, publication or paused schedules. Preserve all games, histories, receipts and provenance, including the canaries.

## Ownership and prerequisites

The recovery chat owns this activation PR, its canary and evidence. The app improvements chat remains the sole deployment coordinator. Obtain one explicit deployment window and exact source revision before changing deployment variables. A local test window is separate from deployment ownership. Do not compete with training or another chat's tests.

Actual reader deployment `19d3edd59b90a8aadebe489d4e5b0e578d5eb33d` introduced migration 0022, format-2 metadata readers and expanded-state readers. Later deployed `a20c2c7f2cb82a321a8998066b1028fb7e69f597` retains them. Verify the actual public SHA, API Worker tag, database/bucket bindings, generation, compression and migration before activation. A reader SHA variable is a recorded prerequisite, not proof that the reader is deployed.

There is no intrinsic dependency on unmerged PR160. Preserve deployed shared-command journal/receipt support and bounded legacy-version discovery. If the activation candidate adopts PR160 behavior, integrate and validate that entire contract first.

## Controlled scope

`RIGHELT_STORAGE_WRITER_CANARY_GAME_ID` passes through preflight and deployment to `STORAGE_WRITER_CANARY_GAME_ID`. With an explicit game ID, an enabled writer operates only on that game. Unrelated games retain legacy writes. With empty scope, enabled writers operate globally. Readers, command receipt lookup and archive restoration are never limited by this scope.

The preflight rejects an invalid game ID or a scope with no enabled writers. Both enabled writers still require compression and a recorded compatible reader SHA. The runtime uses the same scope predicate for expanded encoding and metadata retention.

While a canary scope is configured, deploy only code containing this gate and its deployment-variable wiring. An older deployer can ignore the new scope and accidentally apply the enabled booleans globally. The exclusive deployment window is mandatory. Refresh queued feature branches against actual main before later deployment.

## Acceptance evidence

- Codec integration: the selected game writes expanded states and format 2, unrelated games retain old limits and full payload writes, all upgraded readers load both representations, rollback preserves an existing expanded save.
- Real Worker/D1 integration: scoped metadata retains payload bytes, scope changes restore ordinary writes, a large accepted command with a lost response resolves to the same receipt after restart, and an out-of-scope size rejection preserves the prior board/history.
- Deployment tests: both workflow steps pass the same scope, invalid scope and missing reader/compression prerequisites fail before deployment.
- Operator integration: lost creates before and after arrival retain the original identity/game ID, and final verification resumes its recorded command after lost replies or a saved-settlement interruption.
- Existing compatible PR158 release proof covers the unmodified browser journal, history, undo/control receipts, migration, archive/restore and trained-play boundaries. Record its exact provenance. Current candidate CI and the released validator remain final integration gates.

## Deployment sequence

1. Merge the reviewed activation source with both writer variables absent/false and empty scope. Wait for main CI and normal deployment. Confirm migration 0022 and the exact deployed reader. Do not claim activation at this point.
2. Run `node scripts/storage-writer-canary.mjs plan --receipt PRIVATE_RECEIPT --origin https://righelt.pages.dev --revision MERGED_SHA`. It performs reads and records two new synthetic game IDs and one isolated guest identity. It does not create a production game. Keep the receipt private. Preserve the exact current archive, budget, generation, compression, account and resource bindings recorded by this step.
3. During the agreed window, set Dev `RIGHELT_STORAGE_LARGE_STATES_READER_SHA` and `RIGHELT_STORAGE_METADATA_READER_SHA` to the verified compatible deployed revision. Set both corresponding `*_ENABLED` variables to `true` and `RIGHELT_STORAGE_WRITER_CANARY_GAME_ID` to the receipt's primary ID. Dispatch the normal deployment workflow for the same merged revision. Verify actual Worker bindings before gameplay. No unrelated settings change.
4. Run the operator's `play` action with the same arguments and `--apply`. It creates only the two recorded self-play games, journals immutable legal commands before sending them, and grows the primary save beyond the old raw-state limit. It checks unchanged compressed history bytes after a metadata update, format 2, a control game still using format 1, duplicate receipt identity, reload continuity and socket delivery. It stops on provider, revision, ownership or generation mismatch. Do not replace a failed receipt, game or command. Resume the same action after a reviewed repair.
5. Retain provider CPU/error evidence for the agreed canary window. Review failures and new resource pressure. The operator checks actual persisted compressed bytes and checksum through read-only queries restricted to its two owned games. It never seeds production history or modifies older games. The generated history consists of real legal moves, rather than fabricated retained records.
6. Run `promotion-check` without `--apply`. It requires complete canary proof less than one hour old, the same source revision and the exact canary Worker. Obtain coordinator acceptance of that evidence, then clear only `RIGHELT_STORAGE_WRITER_CANARY_GAME_ID`. Keep both writer flags true. Deploy the same reviewed revision through the normal workflow.
7. Run `final --apply`. It verifies global bindings, advances only the recorded primary game with one durable command, proves metadata retention on the former control game, and verifies duplicate/reload/socket continuity. The final command is identified in the journal before dispatch so resumption cannot invent another command. Record actual global Worker version, source, provider evidence and unchanged unrelated settings. Only then report full activation.

## Rollback

If canary proof fails, retain its receipt and all production records. Set both new writer flags false and clear the writer scope before deploying a compatible rollback. Never deploy an older gate-unaware build with scoped writer booleans still true. Metadata writes then return to full payload writes. New writes on a state above the old limit can be rejected safely, while compatible readers continue to display it. Do not truncate it or reconstruct an earlier missing command.

After expanded states or format 2 exist, every rollback must retain the PR158 readers, migration and shared journal/receipt contract. Disabling writer flags does not authorize a rollback below that floor. Do not restore older database payloads, delete canaries, change generation, disable active archives, reset accounts or alter model provenance as part of writer rollback.

All local/CI failures and partial runs remain evidence. The earlier PR158 production human/computer move proof and visual gap remain historical gaps until new direct evidence covers those exact behaviors. This storage canary establishes its own explicitly authorized scope and must not retroactively mark the old checks passed.
