Refer to `AGENTS.md` in this parent workspace first.

If you are working on product code or interpreting team shorthands, also open:

- `__APP_REPO__/AGENTS.md`

That file contains the full repo operating rules, including team shorthands, testing policy, branch conventions, backlog workflow, and ticket workflow instructions.

Default git-aware execution root: `__APP_REPO__`
Prefer direct repo wrapper commands such as `./scripts/git-app.sh`, `./scripts/backlog-sync.sh`, `./scripts/backlog.sh`, and `./scripts/backlog-doc.sh`; use shell wrappers only as a last resort.

## Validation and shepherding

`PR validation` over the exact `pr-gate` profile is the only blocking CI aggregate. `Full validation` is retired and must not be awaited. Broad `nightly-full` results are advisory: failed, pending or missing nightly evidence does not independently block review, merge or deployment. Keep explicit feature acceptance, independent review, authorization, retained-state proof and deployed-identity verification separate. Investigate confirmed product defects without restoring a blanket full-suite gate.

For end-to-end evidence, integrated PR validation, and autonomous repairs, read the released `__VALIDATION_TOOLS__/skills/validate-and-shepherd/SKILL.md`. Use its CLI with `--candidate /absolute/path` for the intended app checkout. The installed tools stay pinned to a merged revision; a candidate branch is not the tooling source. If the released checkout is missing, report the missing installation and prepare the explicit installer command; do not silently use an unmerged candidate skill. Review readiness, merge authorization, and deployment activation are separate. A paused schedule stays paused until explicitly resumed.

## Task resources

Follow the app repo's `docs/ai/RESOURCE_MANAGEMENT.md`. Use supervised launchers for temporary previews and heavy jobs, track run/tab ownership, and clean up task-owned resources at completion or interruption. Memory-pressure cancellation is incomplete validation. Keep Codex and unrelated resources open.

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Within the authorized delivery order, implement, review, push and run CI for the next change while the preceding merge is in main CI or deployment verification. Only the next merge waits for required verification of the preceding deployment. Serialize local heavy jobs through the resource queue and preserve any explicit user wait command. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.

## Durable behavioral proof

Follow the durable testing standard in `docs/ai/TESTING_STRATEGY.md` in the pinned released tools. Test executed production behavior with independent expected answers. Migrate new and affected source-dependent assertions without expanding the frozen legacy inventory. Show targeted negative proof for migrated regressions, retain focused app wiring proof, and use native browser proof for native contracts. Run `check:test-durability` before slower checks. Leave unrelated legacy migration to T-136.
