# Runpod computer-player jobs (T-132)

One Runpod Secure Cloud on-demand GPU Pod runs the learner and game workers. The existing Cloudflare Worker/SQLite Durable Object owns budgets, fenced worker leases, durable work receipts and recovery. A private GitHub cleanup workflow can terminate exact prearmed Pods when the Mac or Cloudflare is unavailable. There is no hosted language-model agent and no Hetzner adapter.

Activation is disabled in the checked-in configuration. Code and local tests do not establish live CUDA, account, image, cleanup or playing-strength qualification. Account setup belongs to the deployment planning operator. Do not activate schedules, publish images, deploy, spend or promote a model without the applicable launch package authority.

## Commands and credentials

Use `pnpm ai:hosted COMMAND`. Operator credentials stay in the dedicated macOS Keychain entries prepared by the setup helper. Never put secrets in arguments, manifests, chat or shell exports. The existing GitHub CLI uses its own keyring login directly for prearming. Its token is never extracted.

| Command | Purpose |
| --- | --- |
| `plan MANIFEST` | Validate and hash frozen work without spending |
| `qualify REPORT_JSON` | Check raw operational drill receipts and cumulative cost feasibility |
| `submit MANIFEST --inputs CHECKOUT` | Verify frozen input bytes, stage and request authorized work |
| `status ID` / `logs ID` | Read status, estimated usage and bounded failure logs |
| `cancel ID` | Fence work and request exact Pod termination |
| `collect ID --out NEW_DIRECTORY` | Require verified compute cleanup, then download and re-read all objects |
| `backup ID --collection DIRECTORY` | Upload through the operator-only S3 adapter and verify a fresh cloud-only restore |
| `backup ID --collection DIRECTORY --accepted-output PHASE/OUTPUT` | Pin an explicitly accepted model and its essential proof |
| `backup-status ID` / `backup-abort ID` | Inspect or abandon pending operator backup work |
| `restore ID --root ROOT_ID --download NEW_DIRECTORY --out NEW_DIRECTORY` | Restore from private cloud objects into an empty destination |
| `accepted ID --out NEW_DIRECTORY` | Retrieve pinned accepted-model essentials |
| `clear ID --collection DIRECTORY --backup-attestation FILE` | Reverify local collection and submit the exact operator restore attestation before clearing temporary campaign objects |

Nonsecret operator settings are `COMPUTE_BACKUP_ENDPOINT`, `COMPUTE_BACKUP_BUCKET` and the public `COMPUTE_LINEAGE_RECIPIENT`. The backup credential provider reads only `com.righelt.hosted-compute.backup-access-key-id`, `.backup-secret-access-key` and `.lineage-age-identity`, account `operator`. Controller administration uses its dedicated credential through the approved operator wrapper. A credential provider can also be injected in process, without exporting secrets.

The controller gets `ADMIN_TOKEN`, `WORKER_SIGNING_KEY`, restricted `RUNPOD_API_KEY` and a read-only `COMPUTE_CONTROL_READ_TOKEN`. The training host gets only its generation-fenced controller token. Neither controller nor training host has the backup bucket binding, S3 credentials, lineage decryption key or GitHub write authority.

## Cash and bounded execution

The schema-2 cash plan has separate, nontransferable ceilings:

- Runpod: at most $100 cash, including purchased unused credit and taxes. Spending prepaid credit is usage, not another cash payment.
- Cloudflare: at most $20 TOTAL attributable subscription, Workers, DO, active R2, backups, lineage, fees and taxes. Existing account base fees count once. Shared included allowances are not assumed unused.

`runpod` records `cashCeilingCents`, `purchasedCreditCents`, `openingCreditCents`, `taxReserveCents`. `cloudflare` records its ceiling, `subscriptionCents`, `workersCents`, `durableObjectsCents`, `activeR2Cents`, `backupR2Cents`, `taxFeesCents`, `retentionDays:30`, `fundedFrom`, `reviewAt` and `owner`. The dated owner review must be within the funded thirty days. Pausing writes does not stop storage or subscription charges. No automatic deletion, monthly renewal, top-ups or extra funding is implied.

Each campaign has `computeUsageCapCents` and `cloudflareUsageCapCents`. Controller reservations accumulate across campaign IDs and never reset at a calendar boundary. Their sum must fit the funded pilot. Reserve qualification, failures, startup, repair, full evaluation, export, collection, backup, restore and cleanup before deciding what learning fits. There is no automatic settlement that reallocates an unused campaign maximum.

A campaign's original absolute deadline is at most 24 hours, including startup and repairs. Recovery cannot renew it or a phase deadline. There are at most two automatic replacement attempts per campaign, still inside the $10/two-hour repair allowance and all original caps. An uncertain create is reconciled, never blindly retried. Worker leases last two minutes, checkpoints are requested every four minutes, publication every two minutes, and admitted work must satisfy the ten-minute lost-work bound.

## Exact ownership and independent cleanup

Prepare a private immutable ownership record BEFORE every create:

```sh
node tools/hosted-compute/prearm.mjs MANIFEST REVIEWED_PREARM_CONFIG NEW_PRIVATE_OUTPUT
```

Run this operator command with the approved outside-process access used for GitHub CLI operations. It uses the existing `gh` keyring session. Configuration binds the verified Runpod account, evidence, random nonce, exact image/configuration, finite phase/generation names, reviewed cleanup runtime revision and earlier funded cutoff. The prearm launch digest excludes only the external-control reference, avoiding a circular hash. The normal full manifest digest still covers that reference.

`accountId` is an exact opaque owner binding. It may be an operator-attested owner reference supported by signed-in account, key-creation and inventory evidence. Label that evidence as operator-attested, not a provider-native account ID or account-API verification. Use the identical reference in cleanup configuration. The Pods credential does not need a broader account-read scope for this contract.

Copy the returned `externalControl` reference into a NEW manifest. Install only the independently reviewed template in the PRIVATE `righelt-compute-control` repository. Freeze the exact prearm commit/path/hash and operator arming variables there. Never replace those variables while a previous campaign has unresolved ownership. Verify private access, default branch, runtime pin, shared GitHub included compute/storage allowance for existing CI/image builds/cleanup/retries, and billing policy before activation. The job condition skips runner allocation when unarmed. No paid GitHub overage is authorized.

`githubUsage.observedAt` records when the allowance evidence was observed. `expiresAt` is the reviewed allocation's validity, not a requirement to refresh a billing screenshot during the run. `autonomousUntil` must cover the campaign cutoff plus its finite cleanup margin. A separate funded `ownerResponseMarginMs`, at least one cleanup interval, extends the forecast beyond that window. Allocation validity and the current billing period must cover the entire forecast. Review starts at `autonomousUntil`, with the full response margin still funded. Unfunded coverage fails before prearm publication. Reserve other CI, image work, full-timeout cleanup jobs and retries explicitly. Storage uses conservative effective included capacity through billing-period end. Overage blocking needs classified user attestation or API evidence. Shared allowance is never treated as exclusively ours.

After the autonomous window, the cleanup job surfaces an overdue-review flag and a failing status while continuing exact owned-Pod cleanup. It stays armed through unresolved ownership. The finite reserve does not fund an arbitrarily long outage or late-create tail and does not authorize new payment, replenishment or automatic storage deletion.

The primary rechecks the external record before every create. Missing, unavailable, ambiguous, expired or terminal authority blocks new work. It does not block cleanup of known owned resources. The fallback has no create, replace or renewal operations. Its underlying Runpod `pods:write` and GitHub contents grants are broader than the code, so keep them isolated.

The workflow runs nominally every five minutes and on manual dispatch, only on the reviewed default branch, with one concurrency group and no cancellation of an in-flight cleanup. GitHub can delay or drop schedules. Native running-Pod expiry is not supported in the inspected interfaces. Neither the schedule nor a cleanup reserve guarantees an exact billing cutoff through arbitrary outages.

At the immutable cutoff, the fallback records a terminal fence and terminates only exact owned Pods. If the fence write fails after a valid prearm read, deadline-based cleanup still proceeds. The original cutoff independently forbids new launches. Failed fence/receipt writes remain unresolved, not success. Termination requires DELETE/GET absence and complete inventory evidence. One empty scan cannot disprove a late uncertain create. Keep checks armed until authoritative reconciliation and later billing review. Never use stop or add independent volumes for this pilot.

## Qualification and useful work per dollar

Freeze an actual fresh all-in quote: exact Secure Cloud GPU/data center, at least eight vCPU, 48 GiB RAM and 80 GB disk, explicit units, digest-pinned image and approved hourly ceiling. Prefer US. Europe is allowed only within the approved set. Freeze `host.minCudaVersion` (CUDA 13.0 for this image) as well. The scheduler request includes that minimum. Actual returned image, GPU count, CPU/RAM/disk, location, CUDA capability, cloud tier and price must match BEFORE exposing input bytes. A real container kernel/driver probe then verifies the qualified runtime hash before hydration. No automatic hardware/location fallback.

Operational qualification binds source, dependency locks, image, CUDA/driver/runtime hash and exact placement/resources. A normal quote timestamp or approved-rate refresh does not invalidate unchanged hardware/runtime proof. A changed configuration invalidates affected proof.

The supervised report must include hash-verified raw drill receipts for correctness, recovery, cleanup, CUDA, disconnected Mac, real host loss and backup restoration. Fixture-only receipts and booleans alone cannot qualify unattended work. A report is trusted operator evidence bound to raw artifacts, not a substitute for performing the drills.

`projectCampaign` checks both cumulative objects and claims against 2,000, every object against 64 MiB, publication/loss time, 720 two-minute publication passes plus retries, growing ledger chunks/reads/writes, repeated copy/hash/transfer and thirty-day retained storage. Supply measured growth, real transfer/overhead, actual all-in account rates/headroom and a reserved Cloudflare campaign allowance. Snapshot renewal is rate limited to the normal heartbeat cadence. Identical committed uploads still pass every fence/checksum check but avoid duplicate pending/commit ledger writes.

Measure the ACTUAL attention pipeline on normal, developed, full-board, long/repetitive and continuation games across all public profiles and both seats. Include search/rules, inference/IPC, replay, updates, checkpoint suspension/copy/upload, export, startup, hydration, deletion, backup and failed work. A tiny canary or headline GPU price cannot size a meaningful learning comparison. Required work/cost/attempt/proof records are complete. Optional detailed observability is sampled at one percent.

## Audited source-only CUDA image

`prepare-context.mjs` exports an explicit allowlist of clean committed source blobs, not a clone or Git history. It excludes credentials, `.ai-runs`, production exports, models, test data and operator backup/control modules. `.compute-source.json` binds exported source, proof-source inventories, dependency locks and reviewed build configuration. Both JavaScript and Python verify that identity. Native historical inventories retain their original Git behavior.

```sh
node tools/hosted-compute/prepare-context.mjs NEW_CONTEXT_DIRECTORY REVIEWED_BUILD_CONFIG
```

The build configuration requires digest-pinned Node/Python bases, `linux/amd64`, Python 3.14, PyTorch 2.14.1 and a qualified CUDA wheel index. The `cuda-wheel-check` Docker target proves Linux/Python wheel availability and import without renting a GPU. It does not prove driver or GPU execution. Pin the final reviewed source/configuration and resulting image digest before paid work. Publish only through the approved temporary GitHub Actions publishing token. No CPU image, SSH or registry password is required by design.

## Actual incumbent and portable recovery

The public incumbent `trained-20261029-1086` is `board-attention-48x2-v1`, not the disposable residual fixture. Its checkpoint hash is `fece7b0b299f3980e257c6c1f29e6f5e5162e32026d73875e78e6c38719c4e44`, round 118, 55,040 updates. The historical root recipe does not fully describe its inherited training method.

The compatible method descriptor must qualify its actual attention architecture, future-fact objective/masks, LR 0.0001/optimizer, teacher roles, curriculum, supplemental observed-value rows at their original replay age, all source inventories and RNG/recovery state. The 955 archive references require a hash-bound portable resolver at EVERY consumer. Preserve original checkpoint/runner bytes. Never reconstruct Mac absolute paths or fall back to them. Unknown/missing archives fail closed.

Operator preparation strips private source IDs from the 28 supplemental rows without changing model inputs, observed labels, masks, order or eviction boundary. Qualification and encrypted lineage bind original versus sanitized projections. Transfer of the closed historical state consumes old pending/unissued identities honestly in a new namespace. It never resumes October's allocation, resets its clock or retries an old ID.

CPU empty-root restoration is separate from engine replay, CUDA/RNG recovery and method admission. A fresh source fix regenerates affected proof/image/manifest/prearm bindings before launch. Active and historical manifests remain immutable.

## Scientific admission and learning

Reliability can proceed independently of unqualified scientific inputs. `purpose:"scientific-comparison"` requires frozen experiment, actual method and family inventories, an explicit stage/arm, a locked candidate for final evaluation, and a hash-bound phase plan. Each phase executes the reviewed `righelt_training.hosted_science` adapter with exact plan, run directory, runtime and recovery arguments. Stage/phase mismatches fail. Automatic transitions require `allWorkComplete:true`; incomplete and missing work remain visible.

The selected first experiment is one qualified policy-target teaching change. This is an exploratory promising-direction screen, not a forced decisive-strength demonstration. The control uses the audited actual incumbent/inherited method. A deeper requested budget is not qualification: the teacher must finish useful corrections on declared enclosure, repair and harder development motifs, with legality/controller/complete-turn and actual effective-work evidence. Node-limit/fallback/unfinished results do not qualify.

The teacher plan freezes `developmentAssessment` with its suite index, BEFORE profile, seed and action/time/operation bounds. Its sole AFTER profile must be the exact target-generation profile. The teacher phase orders `developmentWorkIds(index)` before the selected fresh-pool work IDs. The native caller uses the same loaded teacher weights and original deadline for both steps. Every case/profile receives a retained result or missing disposition. An unqualified suite stops before pool preparation or new target search. The proof and result bind the actual `developmentReportSha256`; a qualification boolean alone cannot unlock training.

Only eligible fresh self-play policy rows can refresh. Original observed values and every mask remain unchanged. Teacher-estimated values are separate metadata. Historical human/computer observations and legal witnesses are not automatically optimal policy targets, optimal nonterminal values, computer defenses or strength wins.

Control and treatment share initial weights/optimizer/RNG/replay/cursor, architecture, inherited loss, starts, source, host and public budgets. Treatment target generation counts inside equal TOTAL caps for each provider. The overall Runpod and Cloudflare ceilings remain separate. Freeze sample sizes, useful-effect/uncertainty rules, scheduled IDs, missing bounds, family correlation, candidate lock and stop rules BEFORE arm outcomes. This initial implementation requires `continuation.maximum:0`. A later paired continuation needs descendant checkpoint transfer and its own reviewed implementation. No checkpoint/menu shopping. If meaningful arms plus full evaluation cannot fit after reserves, stop with infrastructure readiness/calibration.

Admission uses three hash-bound records: `common-calibration` freezes the original incumbent and fixed calibration endpoint, `policy-target-preparation` freezes numeric rules and budgets before teacher outcomes, and `policy-target-exploratory-comparison` binds the completed teacher output before either arm trains. Future training plan hashes remain explicitly deferred until that output exists. All stages preserve the original deadline. Both local submission and the controller validate the referenced bytes before admitting a scientific campaign.

Teacher selections come from executed fresh self-play in the common calibration checkpoint. Training proves that treatment rows were actually sampled. Evaluation loads the exact exported ONNX candidate and original public opponent, then records every scheduled game, including missing or incomplete work.

Validation compares the exact registered outputs of both arms on the same complete start construction, profile, seed and seat pairs. Both validation plans contain the same preregistered `validationAssessment` component. Each executes the all-profile tactical probes before its scheduled games within the existing allocation. Its fixed time slice starts at the controller’s original phase origin and does not renew on replacement. The producer uses the actual original and arm-output ONNX models. Treatment reports bind the exact recovered training dose. Assessment work IDs precede game IDs, and the final lock must use the selected arm’s own validation report artifact. `righelt_training.comparison_report --objects PRIVATE/.objects --request PRIVATE_REQUEST.json` reads only collected, checksum-bound objects and never reruns a player. Its request names the comparison, rules, selection rule and each arm's training/evaluation results. The controller recomputes nomination from verified point results or conservative missing-game bounds. Family bootstrap intervals remain diagnostic. The locked candidate also needs the actual all-profile tactical floor and executed fresh-policy dose proof.

Training and teacher manifests contain only guard-only final exclusions. Raw final material enters a separate evaluation-only campaign AFTER candidate lock, and never returns through snapshots to training. Evaluate all public profiles/both seats with frozen prospective accounting. Old arena defaults are not this schedule. Native/export numeric proof, actual exported inference, browser/phone proof and human acceptance are separate evidence.

After exact launch package approval, routine gated stages and in-scope repairs/reviews proceed automatically while Kenan is offline. New scientific choices, extra funds/services, widened privacy/access, material architecture/public-budget changes and promotion outside scope require review. Agents still need an awake execution surface for engineering or numerical preregistration. With the Mac asleep, finish/stop frozen hosted work, clean up and await agent availability.

## Development evidence and S11

The canonical scientific contract is in the shared T-122 backlog, including the November 14 regional-enclosures/repair amendment. Keep whole source families, active/discarded branches and descendants together across salts. Updated S11 is exposed development, not fresh final or a new start-distribution intervention. Retain S06/S09's shared family, updated S08 identity and older S07/S10 terminal quarantines.

`prepare-development.mjs` accepts only supported, checksum-bound packet shapes. S11 source IDs are preserved separately from display numbers. The retained `cases.json` review shape binds `verification.packetSha256`, preserves its family and human actor provenance, and leaves source purpose unclassified. Only literal command/supply before-and-after predicates and explicitly supplied immediate outcomes are executable goals; opposing-turn trees, incomplete retreat choices, safety and historical profile checks remain reference evidence. Prepared inputs already approved by physical checksum retain that identity separately from their embedded original source ancestry; their real receipts must bind both unchanged. The S11 adapter requires explicit family/purpose/actor provenance and nonzero intended/executed witness coverage. It replays supplied lines, but command/group/projection/paired-effect assertions and the new two-action-prelude certificate remain reference-only until separately supported. No certificate search is repeated per training batch.

The replay-only automatic rush-ending adapter requires complete relevant-continuation proof, persistable settlement, matching recorded cause and exact recorded board. It inserts no End Turn. Unknown/limited/mismatched proof stays quarantined. The S11 packet adapter conservatively keeps terminal-value admission quarantined even when a separate explicit End-Turn witness wins.

G54's five-action push/Follow win is branch-specific, not global shortest proof or autonomous discovery. S10's certificate covers only the next opposing complete turn. S11 captures and command restoration are effects, not forced eventual wins. Its rejected 512-simulation enclosure probe and insufficient repair root are not qualified teachers. Public search budgets, architecture and inherited loss remain unchanged.

## Backup, encrypted lineage and closeout

The operator S3 adapter uses only the separate private backup bucket. It serializes operators with conditional writes and a create-only lock. A crash-held lock requires exact owner/process reconciliation before an authorized operator clears that lock. Never expire it blindly while an old writer may still run.

A root is published only after complete cloud-read restoration verifies weights, optimizer, RNG, replay/cursor and receipts in an empty checkout. The latest two complete roots overall are retained. Accepted models keep small essential proof independently. Encryption uses `age`, an opaque ciphertext reference and independently recoverable key. Minimal lineage contains only necessary original source/family/ancestry/exposure links. Family exposure cannot split, unknown ancestry cannot become independence, and ciphertext/key remain while any retained recovery or accepted-provenance record references them.

Use `--lineage-scope PRIVATE_JSON --recovery-evidence PRIVATE_JSON` for encrypted backup and `--lineage-version VERSION --recovery-evidence PRIVATE_JSON` for restore. These are private regular files. Off-Mac key recovery is an explicit operator assertion backed by the actual recovery exercise, not something a synthetic test proves. The controller validates the exact authenticated operator attestation. It cannot independently inspect the backup bucket or detect a false authorized assertion.

Bulk temporary logs/intermediate artifacts clear only after verified local collection AND verified cloud recovery. No command deletes production games or revives an old allocation. Keep readiness, research promise, tactical floor and owner acceptance distinct. Release consideration requires all three profiles to pass every frozen critical case. Six serious normal-start human games, three per seat, are an experience signal toward the Horus one-in-three aspiration, not statistical certification. Human games can wait until hosts are deleted and backups verified. Promotion is never automatic.

### Safe create diagnostics and unresolved attempts

Provider failures retain only a fixed operation/category/dispatch enum and numeric HTTP status. The controller records these in the saved attempt and `create-failed` event, including worker-token failure before provider invocation. It never serializes arbitrary errors, response bodies/headers, request payloads or environment values. A create must return HTTP 201 and its expected identity; transport errors, malformed responses, unexpected accepted statuses and identity mismatches remain uncertain. No failure automatically authorizes another POST, closes billing, resets a clock or verifies cleanup.

Runpod's current [create contract](https://docs.runpod.io/api-reference-v2/pods/create-a-pod) makes queued placement opt-in through `queue`, which this adapter does not send. Queued records use a [separate inventory](https://docs.runpod.io/api-reference-v2/pods/list-queued-pods). Unexpected HTTP 202 is not treated as a Pod identity. An operator investigating a lost create must preserve the exact account/name/attempt/clock and reconcile any ordinary or queued resource under that ownership, without repeating the request.

A late exact-owned ordinary Pod can be observed, fenced, removed and verified through the existing cleanup path. Queued records require separate operator reconciliation. A definite failed-create conclusion requires authoritative evidence bound to the original request; empty inventories, missing audit rows, zero early billing or an unrelated HTTP response cannot supply that proof. If the old status was discarded, this repair cannot reconstruct it. Keep the original uncertainty, terminal fence, alert and billing/late-visibility reconciliation. This change adds no manual no-create override or evidence-free disarm endpoint. Any operator-resolution mechanism must separately validate an actual bound receipt rather than edit the ledger to fit absence.

### Bounded manual UI admission

Use admin `attempt-binding ID` (GET `attempt-binding`) to read only the retained manifest hash, generation, status and exact last attempt's generation/name/prearm hash/billing start/hourly ceiling, plus its matching launch-event repair timestamp. It returns no artifact bodies, whole ledger, tokens or environment. A staged campaign reports generation zero and no attempt. Worker credentials cannot use this route. The cached billing start precedes asynchronous launch authorization; the later launch-event repair clock is a separate binding. Neither timestamp is edited or reset during admission. Bind the operator funding record to the actual earlier billing start, and the intent repair clock to the retained launch event.

The explicitly authorized manual route uses a distinct staged public-qualification campaign. It never invokes provider create. The original uncertain campaign, manifest, allocation and terminal fence remain intact. A supplemental old-risk reservation and the new campaign cap are allocated cumulatively. Existing reservations cannot be refunded or reduced by choosing another campaign ID. An immutable funding reservation can be assigned to only one manual campaign. Both potential billing streams and protected shutdown reserves must fit the exact immutable operator funding freeze and its absolute admission, work and cleanup/response limits.

Stage with `manual-stage MANIFEST --inputs CHECKOUT`. This uploads verified inputs and does not start work. Then use `manual-prepare ID --intent PRIVATE_JSON --bootstrap NEW_PRIVATE_FILE`. It writes a create-only mode-0600 bootstrap in an existing mode-0700 directory. Its stdout contains only the file location, intent digest and generation. Use the file's exact workdir, startup argv and environment in the UI. Credentials stay in the environment, never the startup command or public evidence.

Prepare last, after input staging, installed-watch verification and the UI draft are ready. The typed admission and bootstrap window is at most five minutes from preparation. Attachment after that same bound is rejected. Preparation returns a worker token, but that token cannot read work or inputs. The bounded startup override polls the authenticated `manual-ready` operation for at most five minutes from intent preparation. That operation grants no work, claim or lease. The unchanged image worker is imported and called once only after exact attachment succeeds. Expiry exits honestly and leaves the prearmed resource subject to cleanup. There is no automatic host retry or assumption that the old worker survives a pending-work rejection.

For a new cold-start admission, the intent may include `startup: {schema: 1, kind: "confirmed-pod-startup", deadline: ABSOLUTE_MS, maximumMs: 900000}`. Its immutable funding receipt must bind the identical `newIntent.startupDeadline`. Create and exact provider-inspected attachment must still finish within the original five minutes. At attachment the controller persists the startup deadline once, bounded by the typed deadline, fifteen minutes from accepted creation, the manifest, prearm and funding cutoff, repair deadline and existing overall deadline. Preparation rejects a typed deadline beyond those existing authority bounds. No old intent or attached attempt is extended.

The generated private bootstrap uses only the existing image's Client and worker modules. It POSTs a claim binding the intent digest, the attached Pod ID and a fresh private process session. Runpod automatically supplies [`RUNPOD_POD_ID`](https://docs.runpod.io/pods/templates/environment-variables). This is an asserted resource locator checked against the inspected attachment, not host attestation. The controller saves the first session before replying. Lost replies can retry that same claim without renewing its deadline. Another session, wrong Pod, expired authority, cancellation, disabled compute or reduced allowance cannot start work. The same Client carries the session on all later worker requests, including input downloads and heartbeats. The runtime probe still runs before hydration. Session values remain private and do not appear in status, events or operator output. Legacy admissions retain their original five-minute bootstrap behavior.

After the UI creates the Pod, use `manual-attach ID --attachment PRIVATE_JSON`. The typed body is `{intentSha256,podId,acceptedAt,accountId}`. `acceptedAt` is the operator-attested conservative UI-click/provider-created lower bound. It must not be later than a provider creation timestamp when returned. Attachment performs a provider GET and verifies exact ID/name, image, hardware, datacenter, Secure placement, CUDA and price before granting access. Repeated exact attachment is idempotent. A different Pod or clock is rejected.

The first accepted new Pod freezes the overall actual program anchor and its 24-hour end in the durable ledger and status. Every subsequent campaign must inherit that end. The short canary's effective campaign deadline also respects its manifest, funded cutoff and fifteen-minute actual interval. Later heartbeats, campaign IDs, phases or recovery cannot reset the global clock. The original uncertain attempt retains its own old clocks. Repair admission separately ends no later than the explicitly authorized November 16, 2026 at 18:00 UTC, with at most 2,000 cents of combined repair exposure. This is a scoped controller authorization, not a change to the frozen worker's global policy.

The intent is a strict object: `schema`, `kind:manual-ui-admission`, random `id`, new `campaignId`, `manifestSha256`, frozen `sourceRevision`, `priorCampaignId`, `priorManifestSha256`, `priorAttempt:{generation,name,prearmSha256,startedAt}`, verified `accountId`, new exact `name`, `registry`, `cleanupReady`, `fundingReservation`, `fundingSha256`, `createdAt`, `expiresAt`, `liabilityUntil`, original `repairStartedAt`, `repairDeadline`, `repairMaxCents`, `priorRiskReserveCents` and `runtimeWindowMs:86400000`. Timestamps are integer milliseconds. `fundingSha256` binds the new manifest cash object. The receipt references bind the actual operator funding freeze and functional cleanup proof. All referenced JSON hashes use SHA-256 of UTF-8 `canonical(decoded JSON)`, distinct from a physical pretty-printed file hash.

The finite registry is `{schema:1,kind:runpod-dual-cleanup-registry,runtimeRevision,references:[oldReference,newReference]}`. Its two same-account ownership sets must be disjoint. Its separately pinned runtime explicitly authorizes the reviewed cleanup upgrade for those references only. The legacy path retains its original strict runtime pin. Add the separate `COMPUTE_CLEANUP_REGISTRY_COMMIT`, `COMPUTE_CLEANUP_REGISTRY_PATH` and `COMPUTE_CLEANUP_REGISTRY_SHA256` variables while preserving every original prearm variable. Failure in either sweep does not suppress the other.

Readiness is an immutable private receipt with `schema:1`, `kind:dual-cleanup-readiness`, exact `registry` reference, `runtimeRevision`, `workflowSourceSha256`, `workflowCommit`, recent `observedAt`, and `run:{id,conclusion:success,headSha,results}`. Each actual result binds one `prearmSha256`, `state`, failure count, absence and durable-receipt status. It is an authenticated operator attestation backed by actual functional no-create run evidence, not independent controller verification of GitHub Actions internals or a guarantee of scheduled delivery. A successful scheduled run is not required. An actual failed functional run is accepted only when complete durable operational results have zero failures, the old ownership set alone carries the retained usage-review warning, the new set has no such warning, and the immutable fresh funding covers both through the bounded liability horizon. Its real failure conclusion and warning remain in the receipt. Timeout, cancellation, missing receipts or actual cleanup failures never qualify. A registry published without installed-watch/readback evidence cannot admit work.

The upgraded registry cleanup lists all ordinary and queued pages. It cancels each exact-owned queued record, rereads its status and resulting Pod ID, and terminates/verifies any exact-owned Pod created in the scheduler race. Missing post-cancellation metadata, changed identity, incomplete inventory or surviving work stays unresolved. Empty inventories never disarm either watch or prove the old create was rejected. Registry/readiness/funding publication and GPU creation remain operator-owned actions, separate from source delivery.

## Three retained cleanup ownership sets

An empty inventory, terminal fence or durable cutoff receipt leaves an uncertain create watched. A later resource may still become visible. Do not replace an unresolved owner's registry entry to make room for another admission.

Existing schema1 `runpod-dual-cleanup-registry` records retain exactly two references. A schema1 `runpod-finite-cleanup-registry` binds exactly three. Every reference is immutable, all records belong to the same account, and exact launch names must be disjoint across every owner. There is no fourth entry, eviction or automatic retirement. The original environment reference stays a required member.

Three-owner manual admission requires the existing fresh actual-spend path. It preserves each unresolved historical attempt regardless of a campaign's cancelled or expired label or later attempts. Exact prearm hash and name must agree. Fresh positive resource observations also retain coverage even when an older cleanup timestamp exists. Every retained noncandidate owner needs its exact terminal fence. The new candidate's reference is separately required. This membership grants cleanup only and never renews old launch authority.

The corresponding readiness kind is `finite-cleanup-readiness`; its exact three-result hash set, runtime pin, actual workflow identity and freshness must match the registry. Every set needs zero operational failures. Terminal results also need observed absence and durable receipts. A failed run is usable only for retained terminal usage warnings, with consistent failure status and no new-candidate warning. Missing sets, duplicate results, claimed success despite warnings, operational errors and cancelled/timed-out runs fail closed.

The same five-minute cleanup job visits all three sets and isolates each set's error, including its prearm hash, without suppressing the others. It reports `finite-cleanup-result` and `finite-cleanup` status with the actual ownership inventory. The old two-owner result remains compatible. Installation, fresh actual all-set runner proof, job/response funding and any later admission belong to the operator. No additional worker image, scheduler or hosted agent is introduced by this controller/cleanup-only contract.

A retained `cleanup-uncertain` campaign can coexist with a new manual admission only through the fresh actual-spend, exact three-owner authority above. It must still contain an uncertain historical attempt, have a validated exact reference/name and terminal fence, and have fresh terminal/zero-error/durable absence readiness. Current positive active-resource evidence or a confirmed resource without verified end/cleanup blocks this exception. The validated authority returns only these specific retained owner IDs to the global conflict check after all readiness, funding and clock checks pass. Running, provisioning, stopping, queued, repairing and manual-pending campaigns still conflict. The old two-owner path gets no new exception. No retained state, watch, financial clock or historical uncertainty is resolved or rewritten.

## Reviewed capacity refusal and one recovery short

The admin-only `provider-refusal-binding ID` and `provider-refusal-resolve ID --receipt PRIVATE_REFERENCE_JSON` commands apply only to `public-timing-20261116-1c3a839f`. This is an operator-attested resolution of one independently reviewed request. It is not a general HTTP-400 rule or provider-signed proof. The original and B6 requests remain unresolved and independently watched.

The immutable receipt has `schema:1`, `kind:operator-attested-capacity-refusal`, random 32-hex `id`, integer `createdAt`/`expiresAt` spanning at most fifteen minutes, the fresh binding's `ledgerSha256` and `target`, unchanged `programAcceptedAt`, verified `accountId`, `actualSpendBasisSha256`, `native`, `attestation` and `contract`. Obtain the binding after other ledger changes, then adopt before expiry. The account's current complete ordinary/queued actual-spend basis must show no owned resource, and the exact prearm must remain permanently fenced. Accepted Pod, placement, attached/startup session or work evidence rejects adoption. No provider action or worker token is produced.

`native` contains the retained UTF-8 strings `attemptJournalUtf8`, `outcomeJournalUtf8` and `responseBodyUtf8`. Their exact bytes must match the pinned historical journal, response journal and recovered capacity-refusal body hashes. `attestation` binds the reviewed evidence packet, helper, bootstrap, credential binding, canonical manifest and worker source through `evidenceSha256`, `helperSnapshotSha256`, `bootstrapSnapshotSha256`, `credentialBindingSha256`, `manifestSha256` and `sourceRevision`. It also requires `kind:operator-reviewed-single-native-request`, `requestBodySha256:null`, `redirectPolicy:error` and `timeoutMs:20000`. No request-body hash was captured, so none is reconstructed or claimed. `contract` pins the reviewed Runpod v2 create documentation URL, documentation revision and schema hash. These fixed commitments cannot authorize another request.

Resolution appends an audit record and closes only the current ownership bookkeeping. The original uncertain attempt, terminal fence, failure events, clocks and financial evidence remain unchanged. Only the same already-applied receipt can replay after expiry. A fresh positive exact-owned observation records a lasting contradiction before provider deletion, restores the cleanup hold, and blocks admission. Later absence, accounting reconciliation or receipt replay cannot clear that contradiction. Resolution adoption expiry does not expire an otherwise valid lasting resolution.

After resolution, an ordinary public short requires the existing public transition receipt's `kind:manual-capacity-recovery-public-timing-transition` variant. Keep all existing transition fields and add:

```json
{
  "capacityRecovery": {
    "refusalReceiptSha256": "RESOLUTION_RECEIPT_CANONICAL_SHA256",
    "actualSpendBasisSha256": "FRESH_ACTUAL_BASIS_RECEIPT_SHA256",
    "capacity": {
      "observedAt": 0,
      "validUntil": 0,
      "gpu": "SAME_APPROVED_GPU",
      "dataCenterId": "SAME_APPROVED_DATACENTER",
      "priorAvailability": "LOW",
      "availability": "MEDIUM",
      "evidenceSha256": "ACTUAL_CATALOG_EVIDENCE_SHA256"
    }
  }
}
```

This is the additional object, not a complete receipt. The actual balance/inventory observation must occur strictly after resolution adoption. Capacity evidence must be fresh for at most fifteen minutes, cover intent expiry and show MEDIUM or HIGH availability in the same approved GPU/datacenter. Catalog availability is evidence of improvement, not reserved capacity or a successful launch. The frozen model, profiles, schedule, seeds, phase duration, accounting reserve, cohort requirements and campaign cap remain bounded by the refused short. New private output paths may differ.

All existing qualification, image, funding, startup, cleanup readiness, registry and absolute-clock gates still apply. The registry remains capped at three: original unresolved owner, B6 unresolved owner and the new candidate. Effective refusal excludes only 1c3 from current coverage and compute conflict. A positive contradiction restores its hold rather than evicting a watch.

Preparation persists one global `capacityRecoveryShort` marker with the campaign, intent, transition, resolution and original program anchor before returning any bootstrap token. Exact pending-intent replay is idempotent. Cancellation, failure, uncertain dispatch, restart or another campaign cannot refund the allowance. Omitting the recovery variant cannot bypass it. The independently qualified diagnostic-once and productive-work routes retain their existing whole-game timing, cost, growth, cleanup and science requirements. This adds no provider retry, image rebuild, service, account or spending authority.
