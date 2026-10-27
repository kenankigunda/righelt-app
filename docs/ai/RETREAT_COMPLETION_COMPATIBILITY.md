# Completion-preserving retreats

The chosen live rule keeps a Push legal when at least one defender retreat allows the attacker to complete the Follow sequence with the recorded pushing group supplied. The defender may choose only those completion-preserving squares. Existing capture when there is no geometrically available retreat square remains unchanged.

A geometric square is orthogonally adjacent, empty, and not the reserved Follow point. Completion filtering must not turn a retained position with geometric squares into a capture. A previously recorded stranded Follow remains ongoing; the owner may use the existing Undo/recovery flow. No Pass, End Turn, winner or replacement move is invented.

## Live authority and pending commands

Action contract 3 advertises the changed Retreat legality. The server checks durable receipts before checking the action contract. An already accepted or rejected old command retains its original result, command ID and fingerprint. An unsettled old contract command is durably rejected as `upgrade_required`; a missing contract is also rejected for Retreat. No old command is translated or resubmitted with a new identity.

Human action lists, computer masks, search and API submission share the current engine validator. State serialization, deterministic hashes, action slots (2801), model inputs and raw history remain unchanged. Old model assets remain available; their selected action still must pass the current legal mask.

## Historical interpretation

The separate provenance field `retreatSemantics` names the rule used for an action/mask:

- `geometric-retreat-v1` interprets historical retreat geometry.
- `completion-preserving-retreat-v2` applies the current completion requirement.

Missing provenance means geometric semantics only at explicit archive replay/import adapters. Unknown values, including null, reject. Live validation defaults to completion-preserving semantics and never accepts a caller-selected historical mode through an HTTP payload.

New live moves, generated decisions, prepared warmups and game archives record the current name. Catalog export/import and history branch seeds preserve each move’s interpretation; only the private import adapter can select historical replay, and ordinary live HTTP ignores archive-mode injection. Local catalog writers reject unknown/null provenance. Replay verifies the historical full or partial mask under its recorded semantics, then verifies the unchanged controller, encoding, target policy and exact before/after hashes. Production corpus starts retain the raw historical action and its interpreted provenance; those actions are not imitation labels. This is independent of the existing historical Rush Pass to End Turn adapter, which preserves its original slot and raw action.

The completion solver itself is unchanged: it searches geometric retreat successors existentially. Its completed-rule cache can therefore share those answers across interpretations. Current versus historical legal masks are not cached. A regression alternates both modes within one decision cache and requires current masks to remain unchanged.

## Qualification pending

The captured causal regression contains exact pre-Push, after-Push and both retreat states from a model-free replay of a generated game. Its provenance records the original source and receipt hash. It verifies that the Push stays available, the safe retreat leaves a legal Follow, and replay of the unsafe historical retreat retains its exact stranded-state hash.

Required verification includes engine and codec tests, archival full/partial mask replay and warmups, Python provenance retention, current/old pending command receipt outcomes, generated JavaScript parity, real human/computer continuation workflows, and required full CI and released validation. Source preparation alone does not qualify this change. No active training source, checkpoint, record, model or clock is changed by this work.
