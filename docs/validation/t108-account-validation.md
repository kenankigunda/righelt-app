# T-108 account validation

This record separates automated local proof from checks that still require a deployed environment or a physical device. The approved contracts and complete test plan live in the sibling backlog under `backlog/docs/tickets/t-108/`.

## Evidence map

| Plan rows | Executable proof |
| --- | --- |
| U-01 | `auth-foundations.test.mjs`, `auth-foundations.integration.test.mjs`, and `account-profiles.test.mjs`: names, Unicode/password boundaries, pinned blocklist, recovery parsing, hashing and profile allowlist. |
| U-02 | `auth-controls.test.mjs`, `account-controller.test.mjs`: exact expiry, activity, internal continuation and generation checks. |
| I-01 | `test-runtime/auth-game-authority.test.mjs` and `auth-game.test.mjs`: forged actors/context on HTTP/socket routes, projection and reconciliation boundaries. |
| I-02, I-03 | `auth-credentials.integration.test.mjs`: real D1 uniqueness/concurrency, credential generations, lost responses/retries, and injected failure at every transaction boundary for nine credential operations. |
| I-04 | `test-runtime/auth-game-authority.test.mjs`: revocation versus commit/output, missed notification, restart and reconstructed socket attachments. Actual provider isolate eviction remains unverified. |
| I-05 | `account-journal.integration.test.mjs`, `account-controller.test.mjs`, and authority runtime tests: delayed storage/network callbacks, A→B→A, immutable contexts and simultaneous same-account commands. |
| I-06 | `test-runtime/account-cutover.test.mjs`, `account-cutover.test.mjs`, and `e2e/auth/cutover.spec.mjs`: legacy reads, old writers/sockets, permanent activation and maintenance races. |
| I-07 | `auth-controls.test.mjs`, credential integration, API worker tests and `account-operations.test.mjs`: Origin/cookie/request protections, abuse limits, private-service boundaries and deployment smoke contracts. |
| E-01–E-04 | `e2e/auth/accounts.spec.mjs`, `invite-continuity.spec.mjs`, `cutover.spec.mjs`, and `recovery-context.spec.mjs`: full workflows against the real local HTTPS Pages/API/D1/private hashing stack in Chromium, Firefox and WebKit. |
| UX proof | Account E2E plus `account-form-resilience.spec.mjs`: native labels/autofill, focus, cancellation, recovery exports, retained errors/inputs, reduced motion, enlarged CSS and constrained mobile viewport. |
| R-01 | Local Workers/D1 tests prove transaction behavior and production-like proxy/cookies. Deployed hashing evidence is partial; see `tools/t108-feasibility/evidence/RESULTS.md`. |

## Review findings and regression proof

- Cross-tab account changes retire stale settings forms and delayed play continuations. Their regressions failed before the fixes.
- A second browser using the same account can resume its seat. Simultaneous commands at one revision produce one accepted result and one stale rejection; the losing browser can continue after refreshing.
- Legacy games preserve history and links. Account IDs cannot claim a guest seat by matching its old identity string.
- Preparation maintenance blocks old writers before permanent activation. Activation racing an admitted guest command rolls back its state and receipt. Existing guest sockets lose authority after activation.
- Live board refresh preserves the focused coordinate so Enter still reaches the sign-in gate. A remote-update browser regression failed before the fix; all nine keyboard/invite cases passed afterward.
- Recovery/code-replacement finish requires the exact prepared form context, including retries. Real D1 regressions rejected same-account and cross-account shared-cookie mismatches without writes; the two-tab browser case passed in all three engines.
- Credential failure injection covers every statement boundary of registration, login, logout, password change, initial acknowledgment, recovery prepare/finish and replacement-code prepare/finish. Failed batches leave durable credential/session state unchanged; successful retries retain the documented revocation semantics.

## Execution status

The full `pnpm test` run passed on 2026-10-03 using Node 22 and pnpm 9:

- 395 unit tests: 86 engine and 309 web.
- 632 integration/runtime/stress tests: 74 engine, 222 API handler, nine API worker, 223 web, 100 seeded stress runs and four real Workers/D1 tests.
- 98 general browser cases and 69 account browser cases across Chromium, Firefox and WebKit. Ten general cases are intentional representative skips.
- Typecheck and generated-runtime consistency passed.

Independent combined review cleared the reviewed implementation and separately ran four operation-context regressions. Local browser binaries were installed macOS builds (Chromium 1223, Firefox 1522, WebKit 2287), while CI uses its pinned Linux installation. Local success does not supersede CI evidence: subsequent PR99/100 browser jobs reported timing/startup failures. The repairs below passed their focused checks; current-head CI remains an acceptance gate.

## CI repair proof

- Initial play gates now await complete session hydration. A held-session regression failed before the fix and passed in all three engines afterward.
- Post-login continuation marks its successfully loaded route ready before locating the preserved action. A held background invite read reproduced the missing join before the fix.
- Snapshot refresh now rebuilds a preserved branch selection from current legal actions and invalidates delayed results from the prior snapshot. Tests reject removed actions and stale responses. Branch browser fixtures confirm the existing selected target after pending synchronization finishes.
- Thirty affected account browser cases and nine repeated Chromium branch cases passed. The pre-cutover PR99 transplant separately passed 12 browser cases and its 23 controller tests. Combined repair web suites passed 310 unit and 224 integration tests; independent source and fixture reviews cleared.
- Intermittent credential requests returned Wrangler's plain-text worker-restart response. Inspection and an injected fetch rejection proved that this message can misclassify an ordinary internal forwarding failure: the proxy compares a request URL containing its path against a base URL. No actual restart is established. The optional CI-only diagnostic hook reports strictly allowlisted exception classifications without request values, preserves responses and restores the exact pinned dependency after shutdown. Four guard/redaction/behavior/restoration tests and a real instrumented registration smoke pass. No mutation retry, weaker hash or speculative dependency upgrade was added.
- The repaired full run passed all non-browser stages and 96 general browser cases, with two scenario-flyout fixture failures. The traces showed redundant clicks toggling the already-selected piece's supply overlay. The fixtures now assert retained source selection before selecting a target. Six repeated cases and twelve adjacent scenario/branch cases passed; independent review confirmed that all mode-switch and saved-coordinate assertions remain.
- Final local verification on `cd87d19` passed all 98 general browser cases (7.1 minutes; ten intentional skips) and all 69 account browser cases (3.6 minutes). The preceding full run passed typecheck, generated consistency and every non-browser stage on identical application code. The last correction changed only the reviewed scenario test fixture. Current-head CI results are recorded in the PR and shared backlog.
- Both lower PR general browser CI suites then passed. A WebKit account-switch case exhausted its test budget during repeated registration setup. That setup now uses real registration, acknowledgment and logout endpoints in an isolated cookie context; UI play/login/switch and stale-continuation assertions remain. Nine three-engine repetitions and three additional pinned-Firefox repetitions pass; independent review cleared. The full pinned-WebKit account lane also passed 18 cases while investigating the intermittent forwarding failure. The revised CI runs retain their original timeouts.

## Remaining external proof

- Complete deployed Free-plan hash CPU/memory/cold-start/consumption evidence remains unpassed. Existing partial observations are not a feasibility pass. The user authorized implementation to continue while those measurements remain open.
- Actual Cloudflare isolate eviction/hibernation and deployed closure timing remain separate from reconstructed local attachments.
- Physical iPhone Safari and in-app-browser handoff remains untested. Separate automated browser contexts establish cookie isolation, not physical-device acceptance.
- CSS enlargement and reduced viewport height do not establish real browser 200% zoom or software-keyboard behavior.
- No production deployment, permanent activation or merge to main has been performed. The PR workflow has no preview deployment job, so there is no current deployed preview to certify.
- T-087 owns computer-opponent stories and focused/explanatory presentation; T-108 supplies account-backed preference state. T-107/T-115 consume the account gate for their play/analysis features. Ratings and richer statistics remain T-116.
