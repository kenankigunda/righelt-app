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
