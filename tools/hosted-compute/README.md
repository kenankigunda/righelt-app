# Hosted computer-player jobs (T-132)

Run the existing trainer on one remote host while the Mac does other work or
sleeps. A separate Cloudflare controller owns admission, budget reservations,
durable attempt claims, recovery and deletion. There is no hosted language-model
agent. New experiments and code repairs wait for an active development agent.

**The checked-in service is disabled.** Implementation and local fault tests do
not authorize deployment, paid jobs, production export, model promotion or an
existing paused schedule. The paid pilot and actual CUDA/browser/provider proof
remain activation gates.

## Operator commands

Use `pnpm ai:hosted COMMAND ...`. Every command returns JSON. Controller requests
use `COMPUTE_URL` and the private `COMPUTE_ADMIN_TOKEN`; do not put either token in
a manifest, Git, command arguments or chat. Local `plan` and `compare` need no
credentials.

| Command | Effect |
| --- | --- |
| `plan campaign.json` | Validate and hash a frozen campaign without uploading or spending |
| `submit campaign.json --inputs /absolute/prepared-checkout` | Verify inputs, upload, reserve the authorized budget and queue a remote alarm |
| `status ID` / `logs ID` | Inspect phase, estimated spend, failures and durable transition events |
| `cancel ID` | Fence the worker and request provider deletion |
| `collect ID --out /absolute/new-directory` | Download all blobs and evidence after verified compute cleanup, then publish a local checksum receipt |
| `clear ID --collection /absolute/collection` | Reverify the local inventory and every object before clearing remote artifacts |
| `compare cpu-report.json --against gpu-report.json` | Compare a matched two-host workload, rejecting incompatible inputs or unqualified hosts |

The collection contains `inventory.json`, `collection.json` and content-addressed
files in `objects/`. Inventory paths reconstruct recovery files under the same
`/workspace/righelt/.ai-runs/` layout. Never relocate a historical checkpoint by
editing its ancestry or rewriting archive hashes. Prepare and audit a portable
warm start under a new allocation instead. Preserve the original evidence.

## Build and qualify the execution image

Commit source first. From the candidate checkout:

```
node tools/hosted-compute/prepare-context.mjs /absolute/new-source-context
```

This creates an independent local source clone, including Git provenance required
by existing trainer gates. Build `tools/hosted-compute/Dockerfile` from that
context. Supply the returned revision as `SOURCE_REVISION`, reviewed digest-pinned
`NODE_IMAGE` and `PYTHON_IMAGE`, and the PyTorch wheel index appropriate to the
backend. The default index is CPU. CUDA qualification must select a compatible
CUDA index and verify the host driver. The campaign accepts only a digest-pinned
resulting image. The build records both dependency-lock hashes in
`.compute-source.json`; their canonical combined SHA256 is `dependencySha256`.
The worker rejects a different source or dependency identity.

Run `righelt_training.preflight --device cpu` and `--device cuda` on the respective
images. Backend selection is explicit through `RIGHELT_TRAINING_DEVICE`.
Unavailable backends fail instead of falling back. Historical local commands
still require MPS by default. Device selection does not change model/search
configuration. Checkpoints save CUDA random state for every device, retain
optimizer/replay/cursor lineage, and reject incompatible CUDA device counts.
Cross-backend continuation does not promise bit-identical future trajectories.

## Prepare data without giving workers production access

Use an already authorized, revision-fenced local export. This tool never queries
production:

```
pnpm ai:hosted:curate PREPARED_EXPORT HELD_OUT_GAME_IDS_JSON CORPUS_OUT PRIVATE_INCLUSION_OUT
```

Agents select games with complete replay lineage and no replay exclusions. Keep
declared held-out families fixed before selection. The existing replay checker
verifies states and transitions and excludes held-out positions/encodings. The
projection removes account metadata, historical action labels and computer
proofs, pseudonymizes game/decision IDs, and caps each game/category at 20 starts.
Held-out exclusion guards remain in the minimized corpus. Keep the source-ID
inclusion/exclusion mapping local. Upload only the minimized corpus, approved
checkpoint/replay bundle, frozen plans and correctness evidence.

## Freeze a campaign

`policy.mjs` validates the complete contract. Required top-level fields are:

- `schema: 1`, a unique `id`, `purpose: "reliability-pilot"`, a spending
  `authorizationReference`, `seed`, `maxCents` and an absolute `deadline` in Unix
  milliseconds, at most 72 hours after admission.
- `sourceRevision` (40 hex characters), and SHA256 identities for dependencies,
  checkpoint, corpus and the unchanged learning recipe.
- `inputs`: `{name, path, sha256, bytes}` records. Paths are explicit files under
  `.ai-runs/`. The named checkpoint, corpus and recipe binding must appear in this inventory.
- `phases`: ordered frozen work, each with `id`, `kind`, `device`, `seconds`,
  initial `argv`, `resumeArgv`, `runDir`, required output names, `outputPaths`,
  top-level JSON acceptance predicates in `expect`, and one `host` configuration.

Commands are argument arrays, never interpolated shell commands. Use the existing
trainer supervisor/stage and arena entrypoints with new allocations, current
launch proof and frozen development plans. Preserve their independent budgets,
canary, replay, numeric/browser parity and source-amendment gates. Uploaded old
launch proof is not current-source or current-backend proof. Do not reopen the
October campaign. A zero process exit alone cannot complete a phase: every
required JSON artifact must match its frozen predicates.

Host records contain a digest-pinned image, `diskGb` (at least 80), an all-in
upper-bound `hourlyCents` and `quoteExpires`. Obtain and retain current complete
quotes, including machine storage and networking. Unknown or expired pricing
blocks admission. Hetzner uses a dedicated x86 `ccx` server type and explicit
location. Runpod uses API v2, Secure Cloud, one noninterruptible GPU, explicit GPU
type, at least eight vCPUs and 48 GiB RAM. Actual availability and billed pricing
must be confirmed during the paid pilot. The adapter does not claim that a
catalog headline price is an all-in quote.

## Pilot and autonomy boundaries

Allocate no more than $100 across pilot campaigns, including infrastructure and
repairs. Suggested allocation: $20 comparison, $40 rehearsal/training, $10 repair,
$10 controller/storage and $20 completion reserve. Reservations are conservative
and are not automatically refunded after a cheap or failed run. The monthly
ceiling is $500, not permission to use the remaining $400.

Compare the identical short workload on a dedicated CPU VM and a CPU-rich Runpod
GPU host. Record verified terminal games, useful targets, completed evaluation
pairs, startup/search/inference/replay/update/checkpoint/upload times, operator
steps and total cost. Preserve unfinished work. Disqualify correctness, recovery
or cleanup failures. Choose useful targets per total dollar; within 10%, prefer
fewer operator steps, then faster turnaround. `report.mjs` implements that rule.
An active agent reviews this comparison before submitting the winner's campaign.

On the winner, rehearse paired development evaluation for all three profiles and
both seats. Repair completion/accounting before a short unchanged-recipe training
continuation. Prove host replacement, checkpoint recovery, export correctness and
cleanup. Report operational outcomes separately from strength. The small learning
menu remains a separate T-122 planning decision and cannot run through this pilot
as an unreviewed recipe change.

## Failure and retention contract

- One controller ledger reserves the complete campaign amount before launch and
  admits only one active campaign. A new host waits for verified deletion of the
  old one. Provider names and IDs establish exact ownership.
- An uncertain create is never blindly retried. Reconcile the exact launch name.
  If no authoritative resource is found, leave cleanup uncertain for agent review.
  Provider inventory/deletion failures preserve ownership, estimated billing and
  cleanup alarms. No unrelated resource is selected for cleanup.
- Workers renew a two-minute lease every 20 seconds. Expiry stops their owned
  process groups, including trainer children with separate sessions. A stale
  generation cannot claim work or publish artifacts. The phase deadline survives
  worker replacement.
- Coherent checkpoint copies temporarily suspend task-owned processes. Only a
  verified complete remote bundle advances recovery. During training its source checkpoint must be younger than ten minutes of active
  work. A verified restored bundle starts a new active-work window after downtime.
  Training writes checkpoints every four minutes and publishes copies every two
  minutes. Evaluation/export use durable work receipts rather than a moving
  training-checkpoint timestamp. Missing durability blocks further admission.
- Remote claims precede training and evaluation execution. Monotonic remote
  counters prevent checkpoint/job-ID reuse after rollback. Completed evaluation
  receipts are durably stored and replay-verified on recovery. A consumed attempt
  without a result remains unfinished and is never silently replayed.
- Infrastructure repair consumes at most $10 or two elapsed hours per campaign,
  whichever comes first. Healthy work does not consume repair time. Correctness
  failures stop the campaign for tested agent repair. No extra allocation appears
  through retries. The outer cap and all trainer gates remain authoritative.
- Budget estimates retain a 20% reserve, capped at $20 per campaign. Quotes,
  storage reserve and local watchdogs reduce overspend risk, but cannot impose a
  provider-side hard spending guarantee during a provider/control-plane outage.
- Compute is deleted before collection, while artifacts remain in private R2.
  Failed downloads retain remote copies. Interrupted uploads with no stored blob
  produce explicit incomplete-upload receipts, without blocking collection of
  surviving evidence. Clear requires the exact inventory hash
  and a locally reverified receipt. Keep the collected evidence locally. The
  controller retains minimal campaign/collection audit information.

## Activation and validation

Use a separate Cloudflare service, bucket and provider projects. Configure
`ADMIN_TOKEN`, `WORKER_SIGNING_KEY` (at least 32 characters), `HETZNER_API_TOKEN`
and `RUNPOD_API_KEY` as secrets. Workers receive only a generation-scoped token.
Do not reuse production credentials or give workers repository write access.

After explicit deployment and spending approval, set a real HTTPS
`CONTROLLER_URL`, `AUTHORIZED_PILOT_CENTS=10000` and `COMPUTE_ENABLED=true` in the
reviewed deployment configuration. Enable a one-minute reconciliation cron for
this new service only. Durable alarms are armed by submission. Leave all existing
paused schedules unchanged. Disable admission to stop new work; retain controller
cleanup until deletion is verified. Exported models may produce draft integration
PRs through the normal active-agent workflow, never automatic promotion.

`pnpm test:hosted-compute` covers controller/provider faults and the local
Worker/DO/R2/child-process lifecycle. `pnpm test:trainer` covers adjacent training,
checkpoint, replay and export contracts. The real paid CPU/CUDA comparison,
provider-loss rehearsal, Mac-disconnection proof and candidate browser/phone
checks are separate evidence. Local simulated-provider proof does not satisfy them.

## Three bounded flows after the learning-menu review

1. **Readiness fixture (T-132).** `righelt_training.hosted_canary` exercises the real engine and independent replay, real Python masked/value and policy updates, optimizer/RNG/checkpoint recovery, ONNX export and numeric proof. It uses generated training-only roots and an initial checkpoint. It is disposable fixture evidence. It does not count toward live training, health, strength or final evaluation. `test/workflow.integration.test.mjs` runs it through the real local Worker/DO/R2, worker subprocess, collection and clearing with simulated providers. The trainer venv is required, and the trained-play CI model job installs it. Node-only tooling lanes report this fixture as skipped if the venv is absent.
2. **Frozen comparison (T-122).** Scientific admission is still disabled by the controller. Audit the actual retained source and incumbent, qualify evaluation and teaching, freeze one intervention and unchanged continuation before any run. Use the shared backlog contract `backlog/docs/tickets/t-122/hosted-learning-contract-20261109.md`. No learning algorithm was transplanted from a dirty retained branch.
3. **Locked candidate review.** Assemble the compact candidate packet specified in that contract. A promising diagnostic is distinct from another bounded learning stage, tactical qualification, and owner acceptance. No run must select a winner.

### Prepare the supported fixture

Run under the resource supervisor, from this checkout:

```sh
node scripts/resources/cli.mjs run --kind heavy -- env PYTHONPATH=tools/ai-trainer tools/ai-trainer/.venv/bin/python -m righelt_training.hosted_canary --prepare .ai-runs/UNIQUE/input
```

Save the JSON output privately. The local builder CLI is `node tools/hosted-compute/canary-manifest.mjs PREPARED_JSON REVIEWED_CONFIG_JSON NEW_MANIFEST_JSON`. Its config contains the fields listed next. Alternatively import `canaryManifest` from `canary-manifest.mjs` and pass that prepared inventory, a unique `id`, exact committed `sourceRevision`/dependency hash, a reviewed fresh `host` quote, absolute deadline, total cap and actual authorization reference. The builder supplies supported `argv`, `resumeArgv`, scheduled work identities and output requirements. Call the existing `plan` command to review it. This is a fixture manifest, not a complete live pilot or spending authorization. After interruption before a completed result, the fixture stops rather than overwriting its checkpoint or manufacturing a successful retry. Agent review chooses a new separately accounted fixture attempt.

`execution_recipe.py` adds a separate `execution-recipe` record. It preserves the meaning of historical root-exploration hashes. It binds the initial checkpoint payload (weights, architecture, optimizer, RNG, replay and cursor), source files, data, complete ordinary trainer configuration, masks/loss heads and coefficients, sampling, teaching and automatic curriculum switches. Runtime settings and optimizer/architecture are checked without consuming training RNG. Hosted continuation requires the exact incumbent or a checkpoint in its durable recovery inventory. The retained attention/teaching worktree at `4aa3b3c` has different loss wiring plus uncommitted curriculum/recipe edits. It remains outside this baseline adapter until explicitly audited.

All newly submitted manifests require an execution-recipe input and phase work IDs. Typed `compute-result` receipts replace flag-only success. Both worker and controller verify execution, scheduled work, actual artifact bytes, matching exported-model/proof identity, positive updates and recoverable training proof. Completed original receipts may survive a host replacement through exact durable snapshot membership. A current generation number alone cannot redeem missing consumed work.

### Portable bundle admission before a paid launch

Measure a representative full portable run tree, including checkpoint companions, optimizer/RNG, replay archives, logs, manifests and export. `bundlePreflight` in `bundle.mjs` accepts its inventory plus projected end-of-stage file count/bytes and cumulative distinct uploaded object count (including prior snapshots), measured copy time, sustained transfer rate and per-object request overhead. It rejects objects over 64 MiB, more than 2,000 projected files, publication slower than the two-minute cadence, or checkpoint age plus publication reaching the ten-minute loss window. These limits come from `policy.json`.

The fixture test prints actual file/byte/max-object measurements. Local R2 timing does not qualify provider transfers. Before paid submission, retain real CPU/CUDA bundle estimates, measured upload/download times, expected replay/checkpoint growth and total cost including startup/export/verification/cleanup. Run `bundlePreflight` on those measurements and retain its output beside the reviewed manifest. A small passing fixture is not a full-stage growth estimate. Whole-tree publication remains in place. If the projected bundle is infeasible, narrow the bounded stage or split oversized artifacts before considering differential storage.

### Fresh data and host comparison

Curation now uses a fixed-seed bottom-k reservoir per game/category instead of earliest decisions. Freeze curated bytes once for both arms/hosts. New CLI exports emit only hash/encoding exclusion guards for protected positions, with no raw protected states. Historical corpora remain readable. The curation record binds selection rule/seed, source export manifest digest, verified source digest, private inclusion-map digest and corpus digest. The private inclusion map preserves original source game IDs across random salts. Before a **fresh research freeze**, reconcile source/branch/ancestor overlap against prior maps and fill ancestry in that local record. Unknown ancestry cannot be certified as independent. No hosted ID or new salt is independence evidence.

Host reports must include the frozen `workload` object (`workIds` and named minima), matching `workloadSha256`, attempted/completed/verified IDs, failed/unfinished IDs, policy-usable positions, terminal-value positions, distinct outcome trajectories/families and actual sampled positions. Set minima from the declared short workload before measuring. Policy and value counts overlap, and positions are not independent outcomes. Exclude forced-only roots from strategic-choice yield. Report startup, all attempts, repair, transfer, export, verification and cleanup in total cost. A zero-yield or selectively completed run returns `insufficient-evidence`. Mechanical qualification alone permits an explicitly manual operational preference, not a measured-yield claim. The ten-percent tie rule applies only to eligible hardware reports. It is not a scientific throughput-loss cutoff.
