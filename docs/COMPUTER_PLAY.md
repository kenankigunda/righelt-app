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
