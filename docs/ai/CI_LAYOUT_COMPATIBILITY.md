# Fixed CI layout compatibility

The installed validation release owns the approved layout registry. Importing evidence never imports or evaluates the candidate catalog. Each policy pins the raw catalog and workflow sources, catalog digest and complete lane set. Unknown source, unknown policy, mixed receipts, missing/extra lanes and downgrade attempts fail closed.

Two topologies have three explicit policies:

- `guest-2-v1`: exact historical 34-lane workflow, before separate storage evidence. Its storage coverage has the historical mandatory-job-status contract, not a new JUnit proof claim.
- `guest-2-storage-v1`: compatibility release, still 34 lanes. The three existing shard-1 storage steps remain mandatory. Their source-bound JUnit and completed test inventories are also mandatory.
- `guest-4-v1`: reviewed future 40-lane layout, with the same storage proof requirement. This release does not activate it.

Use `import-ci --ci-layout POLICY` with the expected policy. The default is the historical `guest-2-v1`; it cannot accept the newer 34-lane workflow or silently downgrade its storage requirement. Both raw source digests must match the named fixed policy. Adding another layout or changing an approved workflow requires a separately reviewed registry update and merged tooling release.

Artifact enumeration consumes every page, with stable totals, exact page lengths, unique identities and a bounded maximum. Highest numeric artifact attempt wins per lane, independent of timestamps. Partial reruns legitimately retain untouched older artifacts. Expired latest, foreign run/head and future-attempt artifacts fail. One suite archive still contains exactly one `*.receipt.json`.

Storage proof files have project-specific paths so merged artifacts do not overwrite one another. A proof binds the original CI run, head, project, job family/shard and execution attempt, full source identity, JUnit hash and observation hash. Exactly the two original storage cases must finish once without skip, failure or retry. Both the aggregate and importer check the selected artifact's attempt and the successful job's complete mandatory steps. Latest jobs metadata is fully paginated and saved before aggregate validation. The latest jobs API can expose a new numeric alias for a carried success. That alias is recorded as metadata, not treated as a new execution or required to equal an old ID. The proof's seal must lie within the reported execution/step time buckets. This is evidence provenance, not performance measurement.

The required check remains `Full validation`, with seven job families. The normal deployment workflow is unchanged and follows successful main `CI` at its exact SHA.

## Release sequence

1. Review and validate this compatibility change using the currently installed release against the unchanged 34-lane topology. Candidate tooling controls are development evidence only.
2. Land only CI/tooling-owned changes on actual main. Do not implicitly land an unmerged product ancestor under a CI-only label.
3. Install the merged tools revision using the released distribution procedure and verify its pin.
4. Refresh the isolated guest-four-shard change onto that actual main, regenerate the workflow, and require exact `guest-4-v1` source identities. Official acceptance of that layout uses the newly installed merged release.

No database, application request, test body, worker count, timeout, assertion or production setting is changed here. No timing benefit is claimed before actual matched CI measurements. Duration balancing, Node batching and separate storage jobs remain future changes.
