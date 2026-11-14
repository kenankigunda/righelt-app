# CI partition release and recovery

The tooling and seeded sync lanes support one or four isolated Node partitions.
`NODE_PARTITIONS` in `scripts/testing/catalog.mjs` selects the required PR layout.
Nightly and complete local inventory remain unpartitioned. All tests remain required.

Tooling assignment uses deterministic coarse duration weights in
`scripts/testing/partition.mjs`; new files join automatically. Quick files run
before expensive orchestration within each partition. Keep sequential file
execution: the native SDK regression temporarily modifies installed dependency
bytes. Each CI runner owns its installation and output directory.

Stress partitions own seeds by `(seed - 1) % 4`. Each seed retains its complete
server, journal, client and socket sequence. Never parallelize these seeds in one
process, since their browser globals are shared. `T114_SEED=N pnpm test:sync-stress`
remains a local replay command, but replay cannot produce gate evidence.

The runner passes partition identity through dedicated environment variables.
Receipts normalize observed filenames relative to the checkout. Aggregation
independently verifies tooling membership and all expected stress seed IDs and
outcomes. Missing, foreign, duplicate, skipped and interrupted proof cannot pass.
The first structured failure is annotated immediately using the tested revision;
other tests continue and normal logs and receipts remain preserved. Expected
fault-injection log messages never trigger that annotation.

## Release order

1. Merge reader and runner support while `NODE_PARTITIONS=1`. Layout v4 retains
   the existing nineteen lanes. Register the exact prospective v5 catalogue and
   generated workflow hashes for twenty-five lanes. Keep historical layouts.
2. Install the merged release in a separate detached checkout, with frozen
   dependencies and an isolated skill root. Qualify old and new imports there.
   Never replace files in a harness used by an active validation run.
3. Obtain the product coordinator's acknowledgment of the compatible release's
   explicit next-run command before changing the shared CI layout. Acceleration
   waits if capacity, compatibility or acknowledgment is unavailable. Product
   implementation, validation and delivery do not depend on this workstream.
4. In a focused cutover PR, set `NODE_PARTITIONS=4` and regenerate workflows.
   Recheck the exact registered fingerprints after integrating current main.
   Unknown layouts must fail closed; never import candidate registry data as
   installed policy. Preserve the required `PR validation` aggregate.
5. Verify actual main CI, imports and ordinary deployment identity. Hand off
   the verified release path, revision, evidence and fallback to the coordinator.

Use scoped pinned Node and pnpm in the entire command tree. Benchmark only with
spare local and remote capacity. Begin with a small paired sample, measure queue,
setup, execution, preservation and aggregation separately, and expand only to
answer a concrete uncertainty. Do not add a statistical p95 gate or retire
coverage as part of this change.

## Recovery

If the new scheduling compromises delivery or evidence correctness, revert the
cutover through a protected PR first. Retain backward-compatible reader support.
The coordinator may execute this fallback if the acceleration owner is unavailable.
An older harness may not understand newer product contracts, so do not downgrade
it merely to restore the old CI scheduling. Keep failed attempts and exact
release identities. Normal branch protection and deployment safeguards apply.

No new scheduler, global lock service, runtime manager or publication flow is
needed. Paused publication and unrelated schedules remain unchanged.
