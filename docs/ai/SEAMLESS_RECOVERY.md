# Seamless recovery

This feature addresses the October 2026 recovery reports. The confirmed October 24 Horus failure was a precommit `storage_payload_too_large` error. The saved game had 1,986,418 raw JSON bytes and 45,390 compressed bytes. Another move crossed the old raw 2 MB limit. Missing generation headers on the resulting failure were incorrectly described as a storage reset. The original complete command envelope is unavailable. Do not reconstruct or resubmit it.

## Contracts

- Preserve original durable command IDs, bodies, fingerprints and receipts. Unknown delivery is never rejection. Receipt, authoritative state and archive changes commit atomically.
- Apply/end-turn retain board/revision guards. Shared undo and computer-control operations use their existing decision/request IDs and lease-generation guards. They have the same durable journal and receipt path, with capability negotiation. A client with a saved shared operation must not submit it to a server that lacks the capability.
- Browser reachability flags are hints. Socket reconnect and HTTP recovery have separate responsibilities. The transport owns HTTP requests/retries, including uncertain shared writes. Successful HTTP recovery permits play while a socket is repaired. Conditional reconciliation polls every 5 seconds, then every 30 seconds after a minute without a ready socket. Hide/disconnect/retirement cancels polling.
- Recovery feedback stays quiet for four seconds, aside from the existing board loading cue. The status is neutral until 15 seconds without progress. Storage admission, authentication and upgrade failures remain actionable immediately. Retry generations do not restart the episode clock.
- History projection is negotiated per HTTP request and socket, including hibernation attachments. Old clients receive full games. New clients retain all move summaries and the latest full move. Older boards load through a read-only decision endpoint. A failed read preserves the current view, cached selections work offline, and return-to-live invalidates an outstanding selection. Inspected pending boards survive assignment of their durable IDs.
- Metadata representation 2 retains the compressed history and applies current card metadata when reading. Metadata commits still run revision, account, cutover and capacity guards. An archive captures the merged game and restores a full representation.

## Reader before writer

Both writer settings default to false. No production activation is authorized by this change.

1. Apply migration 0022 and deploy this reader with both flags disabled. The migration preserves payload bytes, foreign keys and all payload guards. Verify existing live and archived games.
2. Record the deployed reader commit. Keep every later deployment and rollback candidate at or beyond that reader capability. Earlier code cannot read metadata representation 2 or expanded states.
3. Separately authorize and verify canary activation. Larger states require compression and `RIGHELT_STORAGE_LARGE_STATES_READER_SHA`. Metadata writes require compression and `RIGHELT_STORAGE_METADATA_READER_SHA`. The deployment script checks that the recorded revision has the expected shape. The release owner must verify the actual deployed capability, it does not prove deployment from a string.
4. Expanded JSON is bounded at 16 MiB. New compressed rows and cards are bounded at 1,900,000 bytes. Readers retain support for existing 2,000,000-byte compressed rows. Chunk and restore bounds stay enforced.
5. Disabling larger writes does not prevent reading or restoring existing large states. Known precommit write-limit failures record a receipt without rewriting the saved payload. Disabling metadata writes returns subsequent commits to full payload writes. Roll back only to a compatible reader.

## Coordination

Canonical implementation: `codex/seamless-recovery`, isolated checkout `righelt-seamless-recovery`, initially based on main `74a0c30`.

The app improvements chat owns board geometry, visual feedback, phase wording, identities and undo viewing intent. Its release ledger is `righelt-context-explanations/docs/ai/CONTEXTUAL_BOARD_FEEDBACK.md`. Existing release order remains 150 → 154 → 149 → 151 → 152 → 156 → follow-on, refreshed against actual main after each merge. The engine stream owns the next deployment. Reserve migration 0022 with that owner before landing.

The training chat is held pending a fresh readiness signal from both app work and this feature. Heavy recovery validation supersedes the earlier planning-only resource clearance. No merge, deployment, model activation, storage generation change or production deletion is implied. Evidence publication and schedules remain paused.

## Validation

Retain the private logs in `test-results/seamless-recovery/`. Failed development attempts remain evidence, not successful validation. The first broad ad hoc API/web invocation omitted the repository IndexedDB preload and is not a canonical suite result. Rerun through the repository runners.

Required proof includes real Worker/D1 migration and metadata restart, large save/lost reply/deduplication/archive/restore, known precommit rejection, shared undo/control lost responses and conflicts, socket generation and HTTP fallback, lazy history failure/offline/reordering, nearby approval and branching workflows, browser recovery timing and accessibility, current generated runtime/type checks, full relevant suites, and the pinned released validator. Record exact final revisions and remaining physical-device or production activation gaps in the final evidence report.
