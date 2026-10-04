# Local trained-play tools

T-107 builds on the authoritative TypeScript engine and the versioned configuration in `packages/computer-player/config/experiment-v1.json`. The approved contract and gates live in the shared backlog's `backlog/docs/tickets/t-107/execution-plan.md`.

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

Both approved stages begin at two self-play workers and a 16 GiB experiment ceiling. Fresh observations of idle development tasks, two minutes of quiet CPU load, and normal memory pressure permit gradual increases to eight workers and 32 GiB. Renewed development activity reduces the limits immediately. Unknown or stale task observations prevent escalation. Memory pressure requests a checkpoint and pause; persistent pressure stops the process group safely. A separate supervisor enforces the absolute deadline even when engine or inference work blocks.

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

Admission reserves generation, replay and checkpoint time inside the existing ten-minute round and allocation deadlines. Starting engineering defaults are 60 seconds for generation, 20 seconds for replay and 10 seconds for checkpoint allowance. Per curriculum kind and operation, generation/replay estimates use the larger of that floor and 1.25 times the larger of completed-duration p90 and the greatest unfinished-duration lower bound. The completed window holds 128 observations; censored lower bounds are retained. These are conservative scheduling defaults, not measured completion guarantees.

A deferred start keeps its exact job identity, seed and curriculum kind for the next round; it cannot be replaced with an easier start. Reports count deferrals by kind. If the observed requirement cannot fit a fresh ten-minute round, the runner checkpoints and stops with `observed-game-bound-exceeds-round` for engineering review. One long outlier can trigger this conservative gate; it does not prove every game of that kind is infeasible. It never clips the estimate, extends the round or retrains the old buffer indefinitely. The append-only duration journal and checkpoint-bound cursor preserve observations across recovery and rollback. Allocation-wide launch claims prevent a restored pending job from reusing an already launched ID. Interrupted launch claims with no trustworthy duration are explicitly reported as unobserved, never as completed. Games that fail replay remain excluded from training.

Inspect observed attempts, accepted policy/value positions and genuine terminal games per charged allocation hour with:

```sh
PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.throughput .ai-runs/overnight-r2
```

The report includes generation, replay, inference and gradient-update wall times plus the first worker-message delay. These timings can overlap across workers; first-message delay includes startup and initial engine work. It uses the durable allocation ledger, including conservative open-interval accounting and supervised resource pauses. It keeps observed decisions from unfinished games separate from accepted replay positions, preserves terminal-value supervision for policy-masked fallbacks, and reports missing historical counts explicitly.

An authorized reset from a prior overnight allocation requires a gate report binding the exact predecessor checkpoint checksum and recovery audit. The supervisor validates model, optimizer, random state, cursor and archive hashes; a disposable canary never supplies the inherited training checkpoint. Same-stage relocation preserves the curriculum and round/phase/batch cursor, rebases saved generation elapsed time, and clears the old run's handoff receipt. It requires matching seeds in checksum-validated manifests. Initial-to-overnight transitions intentionally start new stage counters. Run the canary explicitly before an overnight stage, then pass the verified predecessor with `--resume`. All preflight, canary and experiment computation consumes the same approved allocation.

The value head explicitly clamps its tanh output to its mathematical range before export. This corrects observed FP32 WASM endpoint overshoot without changing trained parameter shapes. Runtime/search validators remain strict; a changed export checksum requires new compatibility proof.
