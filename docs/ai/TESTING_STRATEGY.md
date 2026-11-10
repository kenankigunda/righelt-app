# Testing strategy and evidence profiles

The catalog in `scripts/testing/catalog.mjs` defines two exact evidence profiles. The profiles are not interchangeable.

- `pr-gate` contains every deterministic Node suite, Chromium guest and account workflow smokes, and the Chromium/Firefox/WebKit browser-contract suite.
- `nightly-full` contains the complete catalog: the stable gate lanes plus broad general E2E, account, browser-integration, responsive, archive/reset, recovery, report, and observational performance inventory. It is advisory and never authorizes merge, deployment, release, or activation.

`PR validation` is the authoritative and required aggregate. The temporary `Full validation` compatibility job was retired after the repository ruleset migrated to `PR validation`. Nightly validation never emits the required context. Automatic deployment accepts only a successful `CI` workflow triggered by a push to `main`; manual CI and nightly runs cannot deploy.

## PR gate

Every PR and main push requires type checking, generated-runtime freshness, engine, computer, API, web, sync, and tooling tests. Browser-dependent tooling is isolated so ordinary Node tooling does not install browsers. The browser portion contains:

- a Chromium guest workflow proving boot, create, one legal move, observer convergence, reload, and persistence;
- a Chromium account workflow proving registration/authentication, session acknowledgement, protected game mutation, and session propagation;
- a controlled three-browser contract proving native focus, accessibility semantics, IndexedDB lifecycle, cross-tab generation authority, and tolerant layout behavior.

Geometry comparisons use `max(0.5 CSS px, 1 / devicePixelRatio)` and retain negative controls that exceed 2px or overflow. State and generation acknowledgement replace arbitrary waits in required tests. Screenshot recording and observational performance remain nightly. Do not add blanket Playwright retries, quarantine, or fixed delays to make a gate pass.

## Receipts and retry policy

Receipt schema v2 binds each lane to its evidence profile, exact source and base revisions, tested tree and fingerprint, catalog, suite/browser/shard, runtime, dependencies, attempt, outcome, and complete inventory. Verification rejects stale or foreign source, missing/extra/duplicate lanes, incomplete inventories, wrong profiles, failed or repeat-pass observations, and unlinked attempts.

One fresh-run retry is allowed only when structured evidence proves an owned stack exited unexpectedly or resource supervision ended the run. Assertion failures, inventory gaps, HTTP 5xx, timeout text, `ReferenceError`, Playwright flaky outcomes, and unknown failures are not retryable. A successful linked retry is `infra-recovered` and preserves both receipts. A second failure blocks the gate.

## Nightly validation

`.github/workflows/nightly-validation.yml` runs daily at 09:00 UTC and by manual dispatch. It retains every cataloged lane, including the broad three-browser general and account matrices, archive restoration and generation reset, auth controls, responsive permutations, long recovery and transport cases, screenshots/report validation, and observational performance. Its aggregate summary and artifacts are advisory evidence at the exact revision.

## Affected selection

`scripts/testing/requirements.json` maps production paths and requirement families, including configuration, packages, generated assets, CSS, HTML, JSON, renames, and deletes. Unknown or shared production inputs select the broad stable PR gate. `pnpm test:plan --base origin/main` records the proposal on every PR, but selection remains shadow-only: all PR-gate lanes run for at least 20 distinct PR heads. Narrowing requires a separate reviewed change proving every adjudicated product failure was selected, every production path family maps to proof, and no nightly-only discovery exposed a missing PR requirement.

## Local use and maintenance

Regenerate both workflows with `node scripts/testing/workflow.mjs`; check drift with `node scripts/testing/workflow.mjs --check`. `pnpm test` remains the complete local inventory. Use the lowest deterministic layer that proves a contract, keep one real-stack wiring proof per critical workflow, and move fault permutations into integration tests. Source inspection is reserved for explicit workflow, generated-file, native-fixture, or pinned-third-party compatibility contracts and must appear in the source-inspection allowlist.

General and account stacks own fresh temporary databases, secrets, ports, and output directories. Unexpected owned-process exits retain first-cause diagnostics. Raw service logs remain private when they can contain bindings or request data; uploaded diagnostics are sanitized and do not by themselves prove successful behavior.

## Local and integrated delivery

`PR validation` over the exact `pr-gate` profile is the only blocking CI aggregate. `Full validation` is retired and must not be awaited. Broad `nightly-full` results are advisory: failed, pending or missing nightly evidence does not independently block review, merge or deployment. Keep explicit feature acceptance, independent review, authorization, retained-state proof and deployed-identity verification separate. Investigate confirmed product defects without restoring a blanket full-suite gate.

Final integrated execution must derive its CI checks from the PR profile and its additional browser work from explicit release questions. Neither check selection nor command generation may silently invoke the broad E2E or account matrices. Profile identity survives import and receipt loading; a smoke receipt never proves a broader journey.

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Within the authorized delivery order, implement, review, push and run CI for the next change while the preceding merge is in main CI or deployment verification. Only the next merge waits for required verification of the preceding deployment. Serialize local heavy jobs through the resource queue and preserve any explicit user wait command. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.
