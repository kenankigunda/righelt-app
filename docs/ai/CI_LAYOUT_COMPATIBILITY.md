# CI layout compatibility

The active CI contract is receipt schema v2 with explicit `pr-gate` and `nightly-full` profiles. Candidate evidence is accepted only when its profile, catalog, exact lane inventory, source/base revisions, runtime, dependencies, and retry chain all match. A nightly receipt cannot satisfy PR evidence.

The repository ruleset now requires `PR validation` directly. During bootstrap, CI published:

1. `PR validation`, the real aggregate over exact `pr-gate` receipts.
2. `Full validation`, a one-step compatibility alias that succeeds only when `PR validation` succeeds.

The alias ran no product tests and accepted no evidence. It existed only to preserve the old required context while the new gate was proven on `main`. After the merged revision deployed successfully, ruleset `24890349` changed to require `PR validation` while retaining strict-current-main enforcement, the GitHub Actions integration, and no bypass actors. The alias is now retired.

The fixed layout registry retains `guest-2-v1` for importing historical evidence created by the former 34-lane workflow and defines `pr-gate-v2` for current exact-profile imports. The unused 40-lane experiment and transitional storage-layout policy were removed rather than activated.

Automatic deployment listens only to successful `CI` workflow runs whose triggering event was a push to `main`. Manual CI runs and `Nightly validation` cannot deploy.
