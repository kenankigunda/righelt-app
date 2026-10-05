# Execution contract

## Commands and artifacts

The runner uses its own pinned harness checkout for responsive proof and report tests, while executing the candidate checkout's own full test commands and local stack. This allows validating a base that predates the tooling without copying code into it. Publishing uses the separate keychain-compatible `scripts/validation/publisher` workspace dependency from the pinned harness (the app dev runtime remains unchanged), so the invoking checkout does not need publishing dependencies. Record harnessRevision and harnessFingerprint separately from candidate revisions; changes invalidate only checks whose declared inputs or executor changed; preserve compatible successful receipts and record their original provenance. Keep the harness checkout unchanged during a run. If a stream changes user-facing contracts, extend the harness coverage and rerun affected stages; do not hide incompatibility.

```
node scripts/validation/cli.mjs local --candidate /absolute/candidate --base origin/main
node scripts/validation/cli.mjs integrated --candidate /absolute/candidate --manifest /absolute/manifest.json --out /absolute/run-directory
node scripts/validation/cli.mjs integrated --candidate /absolute/candidate --manifest /absolute/manifest.json --out /absolute/run-directory --resume
node scripts/validation/cli.mjs local --candidate /absolute/candidate --resume /absolute/run-directory/run.json
pnpm validate:report --run /absolute/run-directory/run.json
```

Use a version 2 manifest with `repository`, `base`, ordered `prs`, and explicit `questions`. Each question names its acceptance question, relevant path prefixes, and final `checks`; optional `boundaryChecks` selects additional checks at affected feature boundaries. Each PR may name explicit boundary `tests` and a `rationale`. Unmapped product changes or a changed boundary without selected tests/checks block readiness. The final candidate runs the complete existing browser matrix. See `manifest-v2.example.json`; replace its example scope deliberately. Version 1 requires `--legacy` and is reserved for historical reproduction.

`lanes: 2` runs independent general and fresh account browser work concurrently in separate worktrees, databases, ports and output directories. `lanes: 1` runs sequentially. Retained database upgrade boundaries always stay sequential. Compilation failures block dependent work, while independent report checks continue. Dependency installation is reused only with matching manifests, configuration, runtime and installed-lock receipt. Keep the installed harness stable throughout execution.

Use `status --run RUN_JSON --cursor CURSOR` for compact changes, active work, failures and next actions. Full command output streams to private logs; command summaries are bounded. Open deeper logs only to answer a specific unresolved question.

Use `import-ci --candidate PATH --repository OWNER/REPO --run-id ID --expected EXPECTED_JSON --out PRIVATE_DIRECTORY`, then pass its `ci-import.json` through `--ci-evidence`. The expected checks specify exact commands, executor configuration, resolved dependency and runtime identities. The importer verifies actual checkout trees, successful steps, workflow source and provenance artifacts. Missing or incompatible receipts cause local execution, never an assumed pass. CI credits the broad final checks; retained-account upgrades and other gaps still run locally.

Stopped checkpoints include private databases, generated configuration, stable secret, browser state and continuity records. Verify provenance, integrity, session expiry and referenced check/image artifacts before restoring an isolated copy. A missing, expired, corrupt or incompatible checkpoint regenerates from the nearest valid predecessor. Preserve every attempt and failed result.

Report assembly and captions never invoke product tests. Run full viewer tests when report tooling changes; otherwise validate report data and image integrity and inspect the local Markdown summary; perform a hosted smoke check only when publication is explicitly enabled. Save progress locally. Deliver `evidence.md` directly in the Codex task at human-review readiness, a material blocker requiring review, and final readiness. Publishing is paused by default; resume only on explicit user instruction by restoring the project and setting `publicationEnabled: true` in shared settings. Missing hosted URLs do not block local evidence delivery.

Run files and raw logs live under ignored test-results. Only site/ is publishable. The main manifest records private coordination state; never upload it wholesale. Report source includes a deliberately allowlisted public projection.

A shared exclusive lock prevents two validation stacks from occupying port pair 9888/9887. A conflicting server is an error, never silently reused. Inspect lock owner before clearing an abandoned lock; never kill another run.

## Coverage and repairs

Establish one baseline, then validate behavior introduced by each stage and its affected contracts. Reuse compatible unchanged evidence with exact head/base, harness, configuration and artifact provenance. Run the full applicable checks and fresh/retained integrated lanes at the final combined checkpoint or when changed contracts invalidate earlier proof; do not repeat every cumulative suite at every intermediate merge. Verify previous-stage synthetic identity, game, role and history. Add account or schema-specific continuity assertions whenever a stream introduces those capabilities. Login is not proven by a legacy anonymous identity check.

When the candidate defines `test:e2e:auth`, run that candidate-owned suite in a separate Auth E2E lane when required by introduced scope or the final combined checkpoint, preserving its failures and artifacts. This supplements guest journeys; it does not establish retained-account migration proof. Add contract-aware account continuity and responsive login assertions when those features change.

`tools/t108-feasibility/` is known private probe tooling. Run its dedicated harness/runtime/preflight checks and assess its documented deployed-evidence gate separately; mapping it as tooling does not waive that gate or prove account behavior. Unknown `tools/` paths remain coverage gaps.

Changed `tools/ai-trainer/` and `tools/ai-benchmark/` paths require the candidate's `test:trainer` and `test:ai-benchmark` lanes respectively. These checks do not launch budgeted training or evaluation. Browser-model checks require their documented model/corpus environment; report any skipped cases and retain native/browser parity CI plus actual-phone acceptance as separate gates. Mapping these directories is not evidence of trained strength or production readiness.

The default proof journey covers creation, moves, viewer sync, reload and reconnection. The full E2E suite covers history and adjacent flows. For changed surfaces select meaningful walkthrough checkpoints: mobile/touch and desktop context images by default. Capture a close-up, another layout, or another scroll position only when it answers a concrete review question. Keep all existing behavioral assertions and client/browser coverage; record nonvisual proof as text. Add missing accessibility, focus, geometry, loading/error and interaction assertions; never mistake images for assertion coverage. Target stable snapshots only when visual appearance itself is a requirement.

Classify failures from primary logs: product regression, invalid/racy assertion, environment mismatch, infrastructure/deployment. Reproduce the smallest case against the matching build; add failing-first coverage for real bugs. Fix synchronization instead of masking races with sleeps or broad retries. Validate the failing case, affected subsystem and required full pass.

Use separate source repair worktrees when useful, but deliver their coherent commits to the canonical feature PR rather than opening repair PRs. Follow `docs/ai/PR_WORKFLOW.md`. Fetch before pushing; preserve concurrent commits without force-pushing. Across distinct features, fix ownership follows the earliest source PR requiring the change. Rebuild from current source heads after repair. Record conflict decisions, tests and scope in the manifest findings. If material decisions are needed, ask with a recommendation and continue unaffected work.

Inspect PR required checks and review rules using GitHub metadata. A missing check result is unknown, not passed. Verify configured preview jobs, URLs and actual current artifact; distinguish deployment success from inspection. Require independent review for timing, accessibility, responsive UI, deployment, authorization or test-validity changes.

## Readiness

Refresh each PR record with checks/review (`passed`, `pending`, `failed`), preview (`passed`, `pending`, `failed`, or verified `not-configured`), conflicts boolean, open/draft flags and waitingFor prerequisite numbers. Record the provenance URLs and head for every gate. The stage must have matching head/base, passed checks, no coverage gaps and actual agent visual inspection.

Use four statuses: merge-ready; validated but waiting on prerequisites; not merge-ready; unverified/stale. Include next action and owner. Local tests alone never establish PR readiness. Recheck remote base and PR heads at handoff and before merging.

After a real merge, rebuild the next stage against actual remote base (including squash/rebase effects). Preserve the completed run and its notification/authorization history. Create the next manifest/run for the remaining open PRs, removing already merged prerequisites from the ordered list only after verifying their actual merge commits; record those settled prerequisites and the prior run path in the new run's coordination metadata. Transfer still-active authorization and tracked report conversations under the run lock; never transfer consumed authorizations. If no open PRs remain, stop monitoring. Do not reuse a simulated tree solely because it looked similar.

## Account-capable validation stages

The account harness selects source capabilities before execution and runs the candidate's own auth E2E suite plus responsive account proof. Fresh lanes use a new private account database. At the first account-capable retained stage, stop the guest stack and clone only its local `api-state/v3/d1` files into the account fixture's `state/v3/d1`; retain the local database binding ID so migrations apply to the copied database. Durable Object caches are excluded to exercise authoritative database rehydration. The clone records private source fingerprints and refuses to overwrite unrelated existing state. Subsequent stages reuse that account database and its private stable HMAC key.

Account proof preserves real acknowledged account sessions, ownership, history, preferences, and password login across stages. Where the cutover schema exists, a real UI-registered, acknowledged `validation_canary` permanently activates the local cutover before normal play resumes. Verify the original guest game's public history remains available, authenticated accounts cannot claim its seats, and requests carrying the original guest identity cannot mutate authoritative history or event sequence. Header-only protocol upgrades without credentials must also fail. Do not replace retained guest data with a newly seeded fixture as upgrade evidence.

Only fixed loopback fixture controls are exposed; they reject browser Origin headers and accept no caller-supplied SQL. Every database command is local. Private continuity files include synthetic credentials and cookie state and must stay outside the published site. Mask recovery codes in context, component, thumbnail, and full-page evidence; unredacted debugging traces remain private. Inspect actual screenshots and require every expected account workflow, viewport, and checkpoint before claiming complete evidence.

The independent UX scope includes friend/self-play, account continuity, unavailable computer-story presentation, and their adjacent recovery flows. Actual trained-computer preparation, start, undo, results, and rematch remain excluded until their source stream is explicitly included; unavailable state is not proof of those journeys.
### Capture boundaries

Component evidence shows only pixels visible within the viewport and clipping ancestors; reveal or scroll a component deliberately before capturing another view. Labels identify visible-area crops. Do not stitch fixed, sticky or modal surfaces into full-page images: repeated controls misrepresent the app. Keep whole-viewport context for those surfaces and capture additional named scroll positions when necessary. Ordinary scrolling documents can retain full-page evidence.

## Bounded execution and evidence reuse

Choose a bounded test plan before running: introduced behavior, affected neighboring contracts, retained-state risks, exact candidate/harness revisions, and the final combined gates. Current-head CI may satisfy the same required check only when its platform/configuration and artifact contract match; cite the exact job and revision. A Linux result does not prove a macOS-only workaround. Do not reuse incompatible checks from another revision or substitute unit tests for browser/state-continuity acceptance.

After a narrow repair, rerun its failing-first case and affected subsystem, then execute only invalidated final checks. Reuse compatible successful final evidence. Preserve valid unrelated proof. One independent reviewer receives a coherent diff and the primary evidence; ask for a bounded re-review only of changed findings. Parallel work is useful only when independently bounded and must not compete for shared browser ports.

The report should show a curated set of meaningful checkpoints, not every repetitive screenshot. Retain the full raw inventory privately and identify selected originals by digest and viewport. Selection does not waive required responsive states or permit unseen images to be marked reviewed.

Ready for review, ready to merge and ready to activate are distinct decisions. A missing deployment/provider/canary requirement remains an activation or release requirement according to its source; it is not automatically satisfied by merged code. Conversely, an operational follow-up must not silently expand a bounded code-review task. State the requirement and its owner explicitly. Scheduling is opt-in and a paused schedule stays paused until explicitly resumed.

## Human review and stopping rules

Open the report with the contextual walkthrough and confidence summary. Captions name the preceding action, changed behavior and review focus. Keep check records, reused evidence, unresolved risks, failure screenshots, private trace references and historical attempts expandable. Behavioral completeness requires assertions with client/browser, revision, result and provenance; visual completeness requires inspection of the selected changed surfaces. Screenshot counts establish neither.

Bound independent review to changed behavior, coverage and concrete risks; stop once its acceptance questions are answered. Further stress runs, browser permutations, screenshots or diagnostics require an explicit unresolved risk. Introduced or materially worsened defects require repair. Escalate serious pre-existing defects; record unrelated minor issues separately. An unreproduced intermittent failure may remain disclosed after appropriate diagnostics and a successful final pass unless evidence indicates an introduced security, data-integrity or core-flow blocker. Preserve its failure history.

Explicit merge approval supplies human acceptance without image-by-image sign-off. Activation-only requirements do not block merging code proven safe while disabled, including automatic deployment behavior. Keep product merge and activation authorization separate. Authoritative policy remains `docs/ai/PR_WORKFLOW.md`.
