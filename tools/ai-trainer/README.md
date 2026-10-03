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

The search tree remains capped at 2,048 nodes. Recursive continuation enumeration uses a separate per-operation ceiling of 16,384 expansions (`MAX_ENGINE_OPERATION_EXPANSIONS`); each expansion also checks the existing deadline. Exact replay uses this same finite engine allowance when reconstructing complete legal masks and transitions. Interrupted work remains unfinished and never supplies a partial legal list or a training value target.

The retained 14 archives referenced by initial-r2 checkpoint 63 required at most 9,879 expansions in one authoritative operation; the previous 2,048-operation allowance censored three valid archives. The 16,384 ceiling provides bounded headroom for that measured workload without increasing search tree nodes. Replay reports include the operation ceiling, measured expansion peak and sampled heap usage; search reports distinguish internal engine work from tree nodes.
