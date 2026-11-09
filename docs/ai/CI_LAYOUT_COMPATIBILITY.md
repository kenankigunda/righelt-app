# CI layout compatibility

The active CI contract is receipt schema v2 with explicit `pr-gate` and `nightly-full` profiles. Candidate evidence is accepted only when its profile, catalog, exact lane inventory, source/base revisions, runtime, dependencies, and retry chain all match. A nightly receipt cannot satisfy PR evidence.

The repository ruleset still requires the historical `Full validation` context. During bootstrap, CI therefore publishes:

1. `PR validation`, the real aggregate over exact `pr-gate` receipts.
2. `Full validation`, a one-step compatibility alias that succeeds only when `PR validation` succeeds.

No branch protection is disabled or bypassed. After the merged revision succeeds on main, a separately authorized settings change may replace required context `Full validation` with `PR validation`; only then may a cleanup PR remove the alias.

The fixed layout registry retains `guest-2-v1` for importing historical evidence created by the former 34-lane workflow and defines `pr-gate-v2` for current exact-profile imports. The unused 40-lane experiment and transitional storage-layout policy were removed rather than activated.

Automatic deployment listens only to successful `CI` workflow runs whose triggering event was a push to `main`. Manual CI runs and `Nightly validation` cannot deploy.
