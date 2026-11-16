# One-time global program amendment

This controller-only operation records the direct human extension of the existing Runpod program to `2026-11-17T04:59Z` (`1794891540000`). It preserves the original acceptedAt and every existing campaign anchor, manifest, phase, intent, funding/prearm record, lease, attempt and unknown-owner fence. Individual campaigns remain bounded by existing policy. It grants no provider launch, scientific admission or extra money.

Use the private admin CLI against an existing program campaign whose private control repository contains the immutable operator receipt:

```
node tools/hosted-compute/cli.mjs program-window-binding CAMPAIGN
node tools/hosted-compute/cli.mjs program-window-amend CAMPAIGN --receipt PRIVATE_REFERENCE_JSON
```

The first command returns `original`, `current`, prior `amendments`, `ledgerSha256` and `bindingSha256`. Root prepares a create-only receipt in the existing private control repository and supplies its exact repository/commit/path/canonical-SHA reference. The receipt has exactly:

- `schema: 1`, `kind: operator-program-deadline-amendment`, distinct32-hex `id`.
- Fresh integer `createdAt`, `expiresAt`, at most15 minutes apart. Application must precede the original program end and the existing18:00Z repair cutoff.
- `expectedBindingSha256` from the current binding and `original` copied exactly from it, including original acceptedAt/deadline/campaign/intent hash.
- `newDeadline: 1794891540000` and `preserveExistingAuthorities: true`.
- `authority: {kind: user-approved-program-deadline-extension, evidenceSha256: HASH}` bound to the retained direct human instruction.

The serialized admin transition compares the complete current program/ledger binding, permits one extension, persists its immutable receipt reference and original anchor in append-only history, and changes only `manualProgram.deadline`. An exact-reference retry returns the prior result even after expiry. A different reference cannot amend again. Worker tokens cannot read or mutate this admin authority.

Read back `program-window-binding` after application. The actual-spend ledger binding changes intentionally, so obtain a fresh actual-spend reconciliation and fresh funding before a new admission. Raising deployed authorization to the already approved total100USD is a separate Root configuration action. It does not increase the total ceiling or revise old receipt fields.

The global extension does not lengthen the15-minute manual campaign or its startup/admission windows. Longer NEW finite public work requires its separately reviewed contract and image qualification. Root owns controller deployment and live application. No raw Durable Object edit is needed.
