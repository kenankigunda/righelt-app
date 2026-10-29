# Computer play

Babs, Tau and Horus can run in the browser while accounts are disabled. Preparation verifies the shipped model and runtime before game creation. Closing preparation creates no game. Search results are client-reported evidence, not a claim of playing strength.

Guest games use the same persisted browser identity and ownership model as existing guest friend games. Keep that browser's storage to retain control after reload. This is not authenticated account ownership: guest identity identifiers are part of the existing public game protocol. Computer control checks the owning identity, device lease and generation; changing control fences stale workers. Accepted moves require matching durable decision evidence.

Computer search evidence and game history are public game data. Private notes and on-demand analyses remain account-only; guest exports contain no private notes or analyses. Enabling account enforcement keeps retained guest games read-only. Disabling accounts never grants guest access to account-owned games.

For practical use, check preparation time, perceived move quality, responsiveness on a phone, reload recovery, undo, and rematch. Record the game link and any confusing interaction when reporting a problem. Clearing browser storage can lose guest control. No training or account activation is required for guest computer play.

## Pass and End Turn

Pass is a top-level action. It is legal before a sequence starts. End Turn closes an already-started sequence only when the engine permits closure. Required retreats, follows and supply obligations still apply. Both human and computer submissions use this same engine contract.

End Turn is stored as a turn-control event and command receipt. It has no move-history row or move number. Turn-end removals finalize the preceding move. A computer End Turn retains its matching attempt proof on the receipt, without overwriting that move's proof.

The frozen `absolute-v1` model metadata names policy slot 2800 `passIndex`. Runtime code calls it `TURN_CONTROL_POLICY_INDEX`. The legal-action map decodes it as either Pass or End Turn for the current position. Search and generated training decisions carry the correct semantic action directly. Archived training replay recognizes only the old bare Pass that closes a rush, applies the currently legal End Turn in the same policy slot, and requires the exact recorded before/after hashes, controller, encoding, legal mask and policy provenance. Archived warmup chains retain their exact initial/final-state hashes. Raw actions and evidence are never rewritten; live submissions and newly generated decisions use the current semantic action. There is no submission-time translation shim and no new weights or training run are required. The model file, tensor dimensions and configuration hash remain unchanged, preserving checkpoint, manifest and export identity. Rename the metadata key only in an explicit future encoding version and regenerate its training/export artifacts together.

## Action contract rollout

Action contract version 2 is separate from sync protocol version 2. API responses advertise `X-Righelt-Action-Contract: 2`. Socket messages carry `actionContractVersion`. New durable command envelopes bind that version into their fingerprint.

Deploy the API before the web client. The client checks the server contract before optimistically admitting End Turn. An unsupported pair enters the existing static upgrade state and waits for user-controlled refresh. It never loops automatic reloads. Old continuation Pass requests receive `upgrade_required` rather than being reinterpreted. Existing accepted receipts are reconciled before contract fencing, so lost acknowledgments remain recoverable.

Current snapshots and receipts remain supported. Historical continuation Pass rows remain invalid live engine inputs. The isolated trainer replay adapter preserves valid old rush-closure records without relaxing current legality or full-state hashes. Keep every production game, including synthetic smoke games, its history, receipts and model provenance for training; no hosted deletion, reset, retention cleanup or destructive migration is authorized in this program. Preserve accounts, model assets, accepted receipts, archived tombstones and uncertain-command safeguards. Document and prove stale-client and pending-command fencing before such a reset.

## October 29 experimental model release

New games use `trained-20261029-1086`, a continuation-trained attention model. Existing games retain `initial-1554` until their owner explicitly chooses Update opponent. Cached clients that omit a model identity also retain the original default. The original model asset stays available. Public profile settings and search budgets are unchanged.

The fixed ONNX export has SHA-256 `f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f`. It passed native-to-ONNX numeric checks on 1,000 validation states and numeric plus full legal-mask checks in Chromium, Firefox and WebKit. These establish export compatibility, not playing strength.

The frozen 54-game comparison completed all attempts, with 40 terminal results and 14 nonterminal results. Only 9 of 18 groups finished all three games, and the conservative trajectory deduplication rule left 3 complete unique groups. Strength and regression assessment remain inconclusive. On October 29, the owner explicitly authorized a best-effort production release for additional manual testing despite this coverage gap. The model remains experimental. This decision does not change the historical evaluation results.

Rollback means restoring the previous current-model catalog entry while preserving both assets and already pinned game identities. Do not delete accepted games, history or model provenance.

The release also hardens a slow-computer save boundary. Completed calculations share the existing guarded control renewal before evidence saving, then recheck the acknowledged lease before gameplay admission. If evidence saving outlasts that lease, the result stays recorded but unsubmitted. Fresh control requires a fresh calculation and proof. Already admitted commands retain their original durable outcome.

A command-journal timeout keeps gameplay fenced while at most two owner-scoped recovery passes inspect actual stored commands, reconcile their original receipts and verify storage. They retain exact command IDs and fingerprints. Failed shared admission is eligible only for routine control acquisition or renewal. Failed user pause, switch and other shared intentions require manual recovery, even if storage becomes readable. Missing shared-control intent is not recreated. Invalid records, conflicts, unavailable storage and exhausted recovery continue to require explicit attention. Owner/account/storage-generation changes cancel stale recovery. The transaction deadline is unchanged.

A new durable command may arrive while a read-only reconciliation occupies the send slot. Successful, current reconciliation releases that slot and wakes the existing queue. Failed or stale reconciliation cannot trigger this wakeup. The original command identity and normal send guards remain binding.

Computer progress presentation uses at most one pending animation frame and reads the current route, account and game when it renders. Session state, control authority, progress accounting and watchdogs still update immediately. Hidden-page cancellation fences old frames, and returning to the page requests fresh presentation. One local performance entry records counts and render duration without identity data or network telemetry.
