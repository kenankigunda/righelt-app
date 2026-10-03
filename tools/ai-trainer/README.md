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

Throttling and paused time count against the six-hour or twelve-hour deadline. Resuming the same run cannot reset that deadline. Setup/unit tests do not consume the experiment budget. The launch supervisor rejects missing/stale correctness or full export-parity proof. Synthetic preflight output cannot authorize a run.

## Supervised phases

`pnpm ai:run --run-dir .ai-runs/initial --activity-file /path/activity.json --gate-report /path/gates.json --stage initial --seed 107` launches only after the frozen-source correctness and export gates pass. It claims the single approved initial allocation. Use a separate overnight directory only after genuine health and a published progress report; source and dependency identities remain frozen.

Reserve the final one-sixth of the stage for validation and reporting. The coordinator writes `handoff-request.json` in the run directory with `schema: 1`, a unique `id`, `reason: "validation"`, and the current `manifestSha256`. The runner checkpoints between bounded operations, records the handoff and exits. This does not restart or extend the deadline.

Resume the same supervisor arguments with `--resume /path/checkpoint.pt --health` to audit exact archived replays, distinct trained weights, optimizer recovery and unresolved prior attempt failures. Health runs under the original external watchdog. Repeated checkpoint files containing the same weights count once. A later successful phase cannot erase a failed earlier attempt.

`pnpm ai:arena freeze input-plan.json frozen-plan.json` verifies and freezes the 100 seat-swapped pairs, split identities, checkpoint checksums and profiles. Run them by adding `--arena-plan frozen-plan.json --candidate-checkpoint /path/candidate.pt --opponent-checkpoint /path/opponent.pt` to a same-run supervisor resume. Missing time, resource interruption or incomplete pairs remain inconclusive. Validation can resume completed immutable games; final families are claimed once across the experiment archive, independent of filename or model/profile changes. Separate final comparisons need distinct unopened families.

`pnpm ai:replay archive.json.gz` independently checks a complete game with a bounded authoritative-engine child. `pnpm ai:arena report pairs.json report.json --seed 107 --purpose incumbent` produces deterministic whole-pair bootstrap statistics. These diagnostic commands do not start training, reserve extra compute, open final data or promote models. Run experiment evaluation/reporting within its original approved deadline.
