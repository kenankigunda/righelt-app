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

## Held-out export proof and timing reports

```sh
pnpm ai:parity-corpus 1000 /tmp/t107-parity-corpus.json
pnpm ai:export-parity --corpus /tmp/t107-parity-corpus.json --output /tmp/t107-parity --require-mps
pnpm ai:benchmark-report phone-measurements.json timing-report.json
```

The parity corpus uses separate validation trajectory families. It never opens the final test partition. Numeric reports identify the reference device and preserve unmet legal-mask, tactical and browser gates. Add `--reference-output FILE` to emit corresponding policy/value references for browser comparison. A checkpoint counts as trained only when its saved update count is positive.

Timing reports count failures and unfinished computations as unknown successful completion times, not fast successes. Interruptions are reported separately. Reports keep all outliers and refuse to declare release acceptance from desktop data or provisional profiles.
