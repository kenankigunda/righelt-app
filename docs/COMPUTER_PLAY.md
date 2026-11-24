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

Repeated same-phase computer progress uses at most one pending animation frame and reads the current route, account and game when it renders. Control, recovery and phase-change notifications render immediately and cancel queued progress frames. Session state, control authority, progress accounting and watchdogs still update immediately. Hidden-page cancellation fences old frames, and returning to the page requests fresh presentation. One local performance entry records progress counts and render duration without identity data or network telemetry.

## November 24 optional comparison models

Candidate B and Candidate C are optional experimental opponents for Babs, Tau and Horus. Incumbent remains the default, and Candidate A remains available. Existing games keep their exact saved model identity. These candidates use the original trained calculations and unchanged public search settings. Playing strength remains unestablished.

Candidate B, `candidate-b-20261124-1230`, is the broad-run checkpoint after 34,048 new updates. Its checkpoint SHA-256 is `c2cdc2ee1c32f066bec627f5a53ec8faea77cdff7bda922a9546321f9abfdb8c` and its ONNX SHA-256 is `961e218328cea1b3d347e130e1f99f0e97152935a69190b6a38b26b99f07dd00`.

Candidate C, `candidate-c-20261124-2626`, is the final saved checkpoint after 70,144 total new updates, including 512 updates from seven certified policy demonstrations. Its checkpoint SHA-256 is `4d3bb8747e4470b853d3a1be3553a7ce9e9c927e2187a99973adbaa0ea45a645` and its ONNX SHA-256 is `c79c65b79f2205e0841104f543a0dcab7c758c33bce2fb6157830d198d94029e`. Both exports are 322,842 bytes. The broad and final audits record 370 and 569 fresh terminal games respectively. Inherited replay and repeated training samples remain separately identified in the retained reports.

The original numerical reports remain failed under their strict value tolerance. On November 24, the owner explicitly accepted the small discrepancies as within margins and authorized continued release preparation. The recorded acceptance permits at most `0.00005` absolute value-score difference for these exact exports. Policy comparisons retain their original tolerance, and finite FP32 outputs, output shapes, immutable identities and legal-action masks remain required. No arithmetic experiment or changed weights are shipped. Native comparisons covered 1,000 validation positions. The actual browser workers covered the same 1,000 positions in Chromium, Firefox and WebKit with equal complete legal-action masks. Browser value differences were at most `0.000016511` for B and `0.000027955` for C. This is compatibility evidence under the owner exception, not a strength result.

Targeted teaching corrected the exposed S10-28 defense choice before consolidation. The final published-Horus retention check completed all eight searches and found that this correction did not survive consolidation: S10-28 and S05-07 selected known losing completed turns, while S05-01 remained unknown. This is a scoped tactical miss, not a general strength comparison. The separately frozen advisory check completed all 18 claims: both models executed the reviewed retreat-to-win and supply-cut motifs with all three profiles, yielding 12 passing model/profile/case observations. These two exposed roots belong to one reviewed family and do not establish broader improvement or generalization. All training archives, checkpoints, numerical failures and unused arithmetic experiments are preserved. Training stopped after its two approved resource recoveries, and the incumbent was not promoted or replaced.
