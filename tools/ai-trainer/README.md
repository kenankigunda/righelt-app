# Local trained-play tools

T-107 builds on the authoritative TypeScript engine and the versioned configuration in `packages/computer-player/config/experiment-v1.json`. The approved contract and gates live in the shared backlog's `backlog/docs/tickets/t-107/execution-plan.md`.

Controlled root exploration is separately versioned in `packages/computer-player/config/training-recipes-v1.json`. The optional `root-dirichlet-v1` recipe changes only root PUCT priorities after the first raw-prior visit and tactical exclusion. It preserves eligible raw prior mass, uses its own seeded bounded sampler, and records raw/effective priors and the noise digest. Immediate/forced outcomes and fallback paths bypass it. Normal app, arena, diagnostic and export requests omit the option. A worker accepts it only on an explicit training job or development-screen arm, never from an ordinary profile field.

Recipe identity is additive to manifests, decisions and checkpoints. Missing legacy identity means `baseline-v1`, while malformed or altered identities reject. The model configuration checksum, optimizer, archive and RNG checks remain authoritative. The optional primitives do not enable exploration in the runner: the supervised screen and its verified adoption receipt must be wired before sustained training can select the new recipe. No screen or training launch is part of this package.

## Conditional restart sequence

A direct human request may add one training hour to an already-running single eight-hour experiment. This is a stopped amendment to the same allocation, not another phase. `righelt_training.budget_extension` applies one immutable `budget-extended` ledger event under the coordinator and supervisor locks. Its evidence binds the exact original allocation, settled ledger prefix, contract and human authority. It changes the effective total from 28,800 to 32,400 seconds and keeps the final 3,600-second reserve. The original contract, creation event, manifests, exploration allowance and all charges stay intact. Duplicate application of identical evidence is idempotent; different or repeated extensions, active compute, finished experiments and audits already started are rejected. Resume uses native supervision with the effective remaining budget and a reviewed current-source gate. Historical phase names remain unchanged for recovery compatibility. No completed screen, diagnostic or bootstrap is repeated.

The current launch contract is in the backlog's `next-training-sequence.md` and `run-control.md`. The diagnostic, six-hour continuation and conditional twelve-hour continuation have separate authorization and recovery lineage. The older initial/reset examples below describe historical operations; they must not create another allocation for this sequence.

The private sequence configuration records both checkpoint hashes, the existing diagnostic allocation, the future run directories, required task IDs and any explicit `launchHold`. Before the first launch, require a completion receipt for every configured task and a fresh task snapshot showing no relevant development activity. A hold blocks claims even when an earlier prerequisite has finished. Later development activity invokes adaptive resource protection; it does not cancel the approved conditional progression.

The sequence coordinator does not itself launch computation:

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.sequence --directory SEQUENCE_DIRECTORY status
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.sequence --directory SEQUENCE_DIRECTORY claim --completion RECEIPTS_JSON --snapshot SNAPSHOT_JSON
```

Run the claimed diagnostic through `righelt_training.stage --diagnostic` with the original diagnostic directory, checkpoint 942 as `--resume`, checkpoint 842 as `--opponent-checkpoint`, stage `overnight`, and the current gate, activity and corpus paths. The restart workload freezes 20 games in 10 seat-swapped pairs, half normal starts and half held-out openings, with caching off. At least 16 genuine terminal games must pass exact replay, and all 20 attempts must be accounted for. Truncations and unfinished attempts stay in the denominator. Strict strength comparisons and sealed final evaluation retain their separate protocols.

For an eligible continuation, the coordinator writes `contracts/six-hour.json` or `contracts/twelve-hour.json`. Pass that exact file to the stage runner with `--continuation`, using stage `initial` for six hours and `overnight` for twelve. The contract binds 21,600/43,200 seconds, including 3,600/7,200 seconds reserved for validation and reporting. It preserves the approved model, optimizer, random state, cursor and replay; it cannot reset the consumed diagnostic allowance or create a fourth stage.

Fresh health requires 100 new, unique, replay-verified terminal training games, actual new examples used in both losses with finite nonzero updates, and two new distinct recoverable trained checkpoints. The baseline, game receipts and sampled-example witnesses bind to the retained checkpoint lineage. Inherited data, copied trajectories, canary/evaluation games, orphan checkpoints and updates lost during rollback cannot satisfy that gate. A passing health gate permits the twelve-hour stage even when strength is inconclusive; correctness failures still block continuation.

After verified cleanup and settled accounting, record `complete --phase diagnostic --evidence RUN/diagnostic-result.json`, or the matching six/twelve-hour phase with `RUN/stage-result.json`. Completion creates immutable stage evidence and a durable email intent. The mail coordinator has a separate lock, so delivery can retry while an eligible stage runs. An uncertain send requires sent-mail reconciliation before another attempt. A failed email does not revoke passed compute gates, and a successful email cannot make an unmet gate pass.

### Refreshing stale launch proof

Changed engine, representation, search or runtime inputs invalidate old parity evidence. The proof-only `righelt_training.bootstrap` entrypoint refreshes that evidence before the ordinary supervisor can launch. It requires the same cleared hold, all completion receipts, current observations, clean source, hashed static test proof, full checkpoint recovery audit and original inherited-health record. It cannot train, run an arena, create/reset an allocation or substitute a checkpoint.

The static proof also carries the reviewed source amendment: current `sourceRevision`, `cause`, `artifactDisposition`, and nonempty `regressionEvidence`/`reviewEvidence` lists containing evidence paths and SHA256 hashes. The generated gate preserves this record so the ordinary supervisor can amend the historical manifest without overwriting it.

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.bootstrap --sequence-directory SEQUENCE_DIRECTORY --static-proof STATIC_JSON --recovery-audit AUDIT_JSON --corpus FROZEN_CORPUS_JSON --legacy-gate ORIGINAL_GATE_JSON --completion RECEIPTS_JSON --snapshot SNAPSHOT_JSON --activity-file ACTIVITY_JSON
```

The bootstrap charges one interval to the original diagnostic allowance, including resource waits. It checks the existing 1,000-state corpus against the current engine, exports the approved checkpoint, compares MPS/native and browser WASM numeric outputs, then checks all 1,000 bounded search results and tactical provenance. A 20-state CI sample cannot satisfy this proof. Interrupted, stale or incomplete results do not publish a gate; uncertain cleanup leaves accounting open for conservative recovery. Completed proof preserves exact source, dependencies, runtime, corpus, model and artifact hashes, with inherited health explicitly labeled. If too little budget remains to finish the diagnostic, report it inconclusive rather than adding time.

## Setup and checks

From the repository root:

```sh
python3 -m venv tools/ai-trainer/.venv
tools/ai-trainer/.venv/bin/python -m pip install -r tools/ai-trainer/requirements.lock
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m unittest discover -s tools/ai-trainer/tests -v
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.preflight --require-mps
```

The lock records the verified Python 3.14 macOS environment. GPU access requires a process with Metal access; a sandbox can incorrectly make MPS appear unavailable. The preflight runs forward/backward operators and exports an untrained temporary network. It does not launch an experiment or create a release candidate.

The FP32 network has 101,216 parameters. Spatial logits use square-major order, followed by Pass; values use P1's perspective. Checkpoints include optimizer and random states, configuration and run-manifest identities, and a checksum. Truncated games must mask terminal-value loss.

Synthetic numeric checks are smoke tests only. Promotion still requires 1,000 held-out engine states, legal-mask/tactical parity, browser WASM proof, sealed quality evaluation, actual phone measurements and human playing-experience approval. No production gameplay imports these tools.

## Adaptive resource policy

Both approved stages begin at two self-play workers and a 16 GiB experiment ceiling. The separately versioned `adaptive-headroom-v2` operational policy caps the experiment at four workers and 24 GiB, conservatively counting process RSS plus reported MPS driver allocations even when they overlap. Fresh observations of idle development tasks, two minutes of quiet CPU load, normal memory pressure and at least 12 GiB available permit gradual worker increases. The ceiling stays at 16 GiB until the first worker increase and returns to 16 GiB whenever allocation drops to two workers. Memory must fit the existing ceiling before any increase; a larger ceiling cannot excuse existing pressure. Renewed development activity reduces the limits immediately. Unknown or stale task observations prevent escalation.

The supervisor samples resources every five seconds. Below 8 GiB available, elevated/unknown memory pressure, unknown swap usage, newly increasing allocated swap or an exceeded experiment ceiling requests a checkpoint and pause; pressure persisting through the next sample stops the process group. Historical allocated swap alone does not block work. General page-out counters are not treated as swap-outs on macOS. After a pressure pause, restart requires at least 12 GiB available and 120 seconds of uninterrupted healthy observations. Missing observations reset that recovery window. Between 8 and 12 GiB, work that has not paused stays at the conservative limits and cannot ramp. These controls leave headroom; they are not a guarantee against an OS or hardware restart.

Each new runner has a separate 30-second allowance to publish its first memory heartbeat, with zero worker permits until it does. That startup gap does not create a pressure-recovery cooldown. Actual host pressure, operation deadlines and the overall budget still apply during startup. A runner that never publishes stops for investigation; a lost heartbeat after successful startup does not receive a new grace period. A separate supervisor enforces the absolute deadline even when engine or inference work blocks.

New manifests bind the operational policy ID, limits and checksum separately. Existing `experiment-v1.json`, model configuration checksums and checkpoint identities remain unchanged; its original resource block is historical provenance. Resuming older runs requires an append-only, reviewed source amendment, with fresh affected resource/process test evidence. Existing model/replay compatibility or numeric proof never substitutes for that resource proof.

The activity bridge is a local JSON file with `schema: 1`, `observedAt` (Unix seconds), and `developmentActive` (boolean). A coordinator must refresh this from actual task status; a stale `false` never authorizes more resources. System CPU and memory telemetry must independently permit escalation. Every observation and allocation is appended to the experiment record.

Throttling and resource-paused time count against the six-hour or twelve-hour supervised allocation. Stopped repair time is excluded; resuming cannot reset consumed time. Setup/unit tests do not consume the experiment budget. The launch supervisor rejects missing/stale correctness or full export-parity proof. Synthetic preflight output cannot authorize a run.

## Held-out export proof and timing reports

```sh
pnpm ai:parity-corpus 1000 /tmp/t107-parity-corpus.json
pnpm ai:export-parity --corpus /tmp/t107-parity-corpus.json --output /tmp/t107-parity --require-mps
pnpm ai:benchmark-report phone-measurements.json timing-report.json
```

The parity corpus uses separate validation trajectory families. It never opens the final test partition. Numeric reports identify the reference device and preserve unmet legal-mask, tactical and browser gates. Add `--reference-output FILE` to emit corresponding policy/value references for browser comparison. A checkpoint counts as trained only when its saved update count is positive.

Timing reports count failures and unfinished computations as unknown successful completion times, not fast successes. Interruptions are reported separately. Reports keep all outliers and refuse to declare release acceptance from desktop data or provisional profiles.

## Supervised phases

`pnpm ai:run --run-dir .ai-runs/initial --activity-file /path/activity.json --gate-report /path/gates.json --stage initial --seed 107` launches only after the frozen-source correctness and export gates pass. It claims the single approved initial allocation. Use a separate overnight directory only after genuine health and a published progress report; source amendments and dependency changes require recorded regression and review evidence.

The supervisor automatically reserves the final one-sixth of the original stage for validation and reporting (one hour initial, two hours overnight). At that boundary it writes a validation handoff once, even if the coordinator is absent. Pending manual handoffs are preserved; consumed manual markers cannot suppress the automatic request. Training resumes after that boundary are rejected; health, preparation and arena phases share the remaining supervised allocation. A coordinator can also request an earlier handoff by writing `handoff-request.json` in the run directory with `schema: 1`, a unique `id`, `reason: "validation"`, and the current `manifestSha256`. The runner checkpoints between bounded operations, records the handoff and exits. If it remains blocked for 60 seconds after the boundary, the supervisor terminates the process group and reports `validation-handoff-timeout`; the last incremental checkpoint remains available. This does not reset consumed time.

Run trained checkpoint parity before health by resuming the original supervisor with `--resume /path/latest-trained.pt --export-parity --parity-corpus /path/.ai-runs/corpus.json`. This exclusive phase exports the latest trained checkpoint and compares MPS with native ONNX Runtime on at least 1,000 held-out states. It publishes its own resource heartbeat, obeys the original deadline, and saves incomplete progress to `trained-export-parity.json` if stopped. A matching successful report is required for health and overnight eligibility; trained browser WASM parity remains a separate promotion gate. Missing, stale, non-finite or incomplete evidence cannot pass health. Handoff timeouts remain visible even when older checkpoints recover successfully.

Resume the same supervisor arguments with `--resume /path/checkpoint.pt --health` to audit exact archived replays, distinct trained weights, optimizer recovery and unresolved prior attempt failures. Health runs under an external watchdog bounded by the remaining allocation. Repeated checkpoint files containing the same weights count once. An evidence-backed resolution can close a repaired failure without erasing its original attempt.

`pnpm ai:arena freeze input-plan.json frozen-plan.json` verifies and freezes the 100 seat-swapped pairs, split identities, checkpoint checksums and profiles. Run them by adding `--arena-plan frozen-plan.json --candidate-checkpoint /path/candidate.pt --opponent-checkpoint /path/opponent.pt` to a same-allocation supervisor resume. Missing time, resource interruption or incomplete pairs remain inconclusive. Validation can resume completed immutable games; final families are claimed once across the experiment archive, independent of filename or model/profile changes. Separate final comparisons need distinct unopened families.

For a completion diagnostic, set `mode: "diagnostic"` in the validation plan before freezing it. This mode continues the fixed schedule after expected search/legality limits, preserving the original pair, seat, seed and failure artifact. It never replaces or silently retries an attempted match, including after resume. Correctness failures stop and remain blocking on resume. Resource and overall allocation stops still apply. Diagnostic reports include attempted/completed counts and unfinished reasons, omit strength statistics and cannot satisfy the stage's learning-evaluation proof. Final plans reject diagnostic mode; omitted mode preserves the existing strict behavior.

`pnpm ai:replay archive.json.gz` independently checks a complete game with a bounded authoritative-engine child. `pnpm ai:arena report pairs.json report.json --seed 107 --purpose incumbent` produces deterministic whole-pair bootstrap statistics. These diagnostic commands do not start training, reserve extra compute, open final data or promote models. Run experiment evaluation/reporting within the remaining approved allocation.

## Autonomous recovery and supervised time

The approved recovery amendment replaces a single fixed wall deadline. `righelt_training.stage` orchestrates a disposable canary, training, trained export, health and validation. Completed phases are reused only with matching evidence. Every supervised interval is charged in the append-only allocation journal; stopped engineering repair time is excluded only after owned compute has been cleaned up. Resource pauses during supervision still count. A manual pause requires a user decision about any clock reset.

An explicitly approved reset is recorded before launching, preserving the prior allocation:

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.allocation reset --archive .ai-runs --previous .ai-runs/initial --target .ai-runs/initial-r2 --authorization 'Kenan explicitly approved a fresh six-hour initial allocation on 2026-10-03'
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.stage --run-dir .ai-runs/initial-r2 --activity-file .ai-runs/control/activity.json --gate-report .ai-runs/control/initial-gates.json --parity-corpus .ai-runs/control/parity-corpus.json --stage initial --seed 107
```

Do not reset an allocation automatically. Ordinary repairs instead append source amendments with cause, regression/review evidence and artifact disposition; the original manifest remains immutable. Compatible checkpoint bundles include model/optimizer/random state, training cursor and archive hashes. Invalid data and descendant checkpoints must be moved into a recorded quarantine before recovery; never keep them as the active `latest` checkpoint. Checkpoint and game identifiers cannot be reused after rollback.

Failure resolutions retain the original attempt and link a tested fix, independently reviewed evidence and a later successful recovery of the same phase. An unresolved failure still blocks health. Overnight requires the audited initial checkpoint and matching replay/optimizer lineage. The canary consumes at most ten minutes of the approved allocation, contributes nothing to strength/health evidence, and never enters sustained-training replay.

### Synchronous engine verification allowance

The search tree remains capped at 2,048 nodes. Recursive continuation enumeration uses a separate per-operation ceiling of 16,384 expansions (`MAX_ENGINE_OPERATION_EXPANSIONS`); each expansion also checks the existing deadline. Exact replay uses this same finite engine allowance when reconstructing complete legal masks and transitions. Interrupted operations never publish partial legal lists or claim completed checking. A verified legal root action may still be selected by the explicit fallback contract below; unfinished games never receive terminal-value targets.

The retained 14 archives referenced by initial-r2 checkpoint 63 required at most 9,879 expansions in one authoritative operation; the previous 2,048-operation allowance censored three valid archives. The 16,384 ceiling provides bounded headroom for that measured workload without increasing search tree nodes. Replay reports include the operation ceiling, measured expansion peak and sampled heap usage; search reports distinguish internal engine work from tree nodes.


### Legal model fallbacks and reporting

Search continues past a candidate-local engine limit without repeating that failed operation. Global deadlines, cancellation and tree-node limits remain bounded. If checked alternatives exist but no eligible search visit finishes, `search-incomplete` selects their highest raw model-policy logit. If none is fully checked, `safety-incomplete` selects the highest-ranked verified legal action whose immediate loss is not proven. Exact ties use the recorded seed. Immediate wins and existing all-proven-losing behavior remain intact. Invalid model outputs and unknown legality still stop the decision.

Fallback records contain `policyMask: false`, an empty policy target, versioned reason, selected-action safety, root-value provenance and search diagnostics. They retain genuine terminal-value supervision; truncated games remain value-masked. Losses normalize over supervised examples, and batches with no supervised targets do not update the optimizer. Older replay records keep their original semantics.

Decision progress is saved before the game completes, so unfinished games remain visible in completion reports. Inspect observed rates by start kind and profile with:

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.fallback_report .ai-runs/overnight-r2
```

The report identifies coverage gaps rather than inferring unrecorded decisions. T-115 owns the eventual lightweight and debug analysis presentation; a fallback is not automatically a poor decision grade.

### Generation admission and useful data yield

Admission reserves generation, replay and checkpoint time inside the remaining training window. Ten minutes is the nominal round cadence. A measured conservative requirement can extend that round, anchored to its saved start and elapsed time, while preserving the final validation reserve. Starting engineering defaults are 60 seconds for generation, 20 seconds for replay and 10 seconds for checkpoint allowance. Per curriculum kind and operation, generation/replay estimates use the larger of that floor and 1.25 times the larger of completed-duration p90 and the greatest unfinished-duration lower bound. The completed window holds 128 observations; censored lower bounds are retained. These are conservative scheduling defaults, not measured completion guarantees.

A deferred start keeps its exact job identity, seed and curriculum kind for the next round; it cannot be replaced with an easier start. Reports count deferrals by kind. If the observed requirement cannot fit before final validation, the runner checkpoints and waits for the normal handoff with time charged. It never clips the estimate or retrains the old buffer indefinitely. The worker accepts an explicit training-generation budget above the nominal cadence, with finite/positive validation and a defensive ceiling from the largest configured supervisor duration. That ceiling grants no allocation time: the parent still enforces the admitted deadline, resource stops and validation reserve. Other command limits and default budgets remain unchanged. The append-only duration journal and checkpoint-bound cursor preserve observations across recovery and rollback. Allocation-wide launch claims prevent a restored pending job from reusing an already launched ID. Interrupted launch claims with no trustworthy duration are explicitly reported as unobserved, never as completed. Games that fail replay remain excluded from training.

Inspect observed attempts, accepted policy/value positions and genuine terminal games per charged allocation hour with:

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.throughput .ai-runs/overnight-r2
```

The report includes generation, replay, inference and gradient-update wall times plus the first worker-message delay. These timings can overlap across workers; first-message delay includes startup and initial engine work. It uses the durable allocation ledger, including conservative open-interval accounting and supervised resource pauses. It keeps observed decisions from unfinished games separate from accepted replay positions, preserves terminal-value supervision for policy-masked fallbacks, and reports missing historical counts explicitly.

An authorized reset from a prior overnight allocation requires a gate report binding the exact predecessor checkpoint checksum and recovery audit. The supervisor validates model, optimizer, random state, cursor and archive hashes; a disposable canary never supplies the inherited training checkpoint. Same-stage relocation preserves the curriculum and round/phase/batch cursor, rebases saved generation elapsed time, and clears the old run's handoff receipt. It requires matching seeds in checksum-validated manifests. Initial-to-overnight transitions intentionally start new stage counters. Run the canary explicitly before an overnight stage, then pass the verified predecessor with `--resume`. All preflight, canary and experiment computation consumes the same approved allocation.

The value head explicitly clamps its tanh output to its mathematical range before export. This corrects observed FP32 WASM endpoint overshoot without changing trained parameter shapes. Runtime/search validators remain strict; a changed export checksum requires new compatibility proof.

### Learning-data observations and start inventory

These prep commands inspect existing training archives. They do not start an experiment, change the curriculum or supply strength evidence. Outputs are immutable: use a new filename for each snapshot.

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.learning_data --checkpoint .ai-runs/overnight-r2/checkpoints/checkpoint-000942.pt --run-directory .ai-runs/overnight-r2 --output .ai-runs/control/learning-data-v1.json
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.start_inventory --checkpoint .ai-runs/overnight-r2/checkpoints/checkpoint-000942.pt --limit 16 --verify-seconds 60 --output .ai-runs/control/start-inventory-v1.json
```

The data report separates retained historical archives, observed attempts, retained data from the selected allocation and actual batch exposure. It reports controller/continuation coverage, families, exact states, policy entropy, visit coverage, unvisited prior mass and policy-target divergence. Missing legacy measurements remain unknown. Sampled positions from later-rolled-back updates remain observations, not fresh-health proof. The checkpoint recovery bundle, baseline and exact journal snapshots bind the report to its evidence.

Start inventory selects training-family states deterministically across controllers and continuation phases, retaining family, source archive and ancestry. The optional replay allowance is at most 60 seconds total and ten seconds per source game. Only a complete independent authoritative replay can publish exact states. Unfinished sources remain visible and are not replaced. The command uses no model, records its source dependencies, and terminates its engine child on interruption. Omit `--verify-seconds` for an index without replay. Nothing consumes this inventory as a new self-play distribution; adopting archived starts is a separate experiment tracked by T-122.

### Frozen development progress check

Prepare the small fixed set from the existing 1,000-state export-validation corpus, without executing a model:

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.development_probe prepare --corpus .ai-runs/control/parity-corpus.json --output .ai-runs/control/development-cases-v1.json
```

Selection takes the first two positions per controller/category (ordinary, push available, rush, retreat and follow), deduplicating overlaps. Missing coverage remains explicit. These are development positions, separate from sealed tactical and final match acceptance.

For the next authorized diagnostic, six-hour and twelve-hour stages, pass `--development-cases /absolute/path/.ai-runs/control/development-cases-v1.json` to `righelt_training.stage`. The flag reaches only the existing supervised export phase. After numeric parity is saved, the collector reuses the loaded checkpoint for at most 60 seconds, bounded further by remaining phase time and resource availability. It uses eight simulations, temperature zero, zero value gap and the same per-position seeds as the bootstrap proof. It records raw model preferences, P1/controller values, searched choices and any authoritative terminal proofs. This is observational; it adds no health or strength threshold. An incomplete observation remains incomplete and does not erase successful numeric parity. Invalid outputs or inconsistent evidence remain correctness failures.

Each attempt preserves its plan, source/runtime/checkpoint identity and individual case receipts under the run's `development/` directory. `development-latest.json` links the immutable proof and report. The supervisor's existing operation watchdog also bounds blocked inference; interruption cannot add compute time. No standalone collector command bypasses supervision.

Use `development_probe report --cases CASES --proof COMPLETE_PROOF --output REPORT` to read a complete bootstrap proof or stage development proof. Use `development_probe compare --cases CASES --before BEFORE_REPORT --after AFTER_REPORT --output COMPARISON` for matched checkpoint observations. Both commands are read-only with respect to experiment artifacts and execute no model. Numeric export output alone is insufficient. Comparisons require matching frozen cases, engine/search/model dependencies and native runtime; unrelated browser plumbing need not match. A change in preferred moves or raw values does not establish improved playing strength.
