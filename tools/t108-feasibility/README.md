# T-108.01 hashing feasibility

This probe cannot enable accounts. It exercises synthetic credentials and writes evidence for the T-108 prerequisite. Local results never pass the deployed gate.

CI runs the harness and fail-closed evaluator tests on relevant branch changes. The external Cloudflare access check is separate: manually dispatch `T-108 hashing feasibility` with `verify_cloudflare_access=true` when its CI credential has the required read access. That check still fails on missing access; a skipped check is not feasibility evidence. The user approved reviewing/releasing this harness independently of metric collection. No account-implementation gate is waived by green harness CI.

The admission Worker forwards work to a separate hash Worker. Each has one SQLite-backed Durable Object. Admission permits one active request and four waiting requests. Excess requests return `429` with `Retry-After: 1`. Keeping hashing in a separate Worker lets admission process requests while synchronous hashing runs.

Both Workers disable public routes and preview URLs. The only allowed request is `POST /probe` with `{ "fixture": "ascii" }`, `unicode`, or `long`. A separately managed authenticated gateway can expose this private service for a bounded test. No input accepts real credentials, resource names, hashing parameters or salts. Do not bind this probe to production services or databases.

Each accepted invocation computes a correct and an incorrect synthetic password hash. Provider CPU measurements therefore include two hashes; applying the one-second gate to that full invocation is conservative. The salt is intentionally fixed for reproducible known answers. It is never a production salt source.

## Run locally

From the worktree root:

```sh
node --test tools/t108-feasibility/core.test.mjs
node --test tools/t108-feasibility/runtime.test.mjs
node tools/t108-feasibility/local-run.mjs /tmp/t108-local-evidence.json
```

Miniflare comes from the installed Wrangler dependency. `T108_DEPENDENCY_ROOT` may point at another checkout with installed dependencies. The runtime tests require permission to listen on local loopback.

Unit tests hold a hash promise open to prove exactly one active job, four waiting jobs and fifteen rejected jobs. The real runtime burst deliberately has no artificial delay. Network arrivals can span completed hashes, so its total accepted count can exceed five. It must still reject overload and recover afterward.

## Deployed evidence

The recorded run uses a loopback-only bridge with a remote service binding, so neither deployed Worker needs a public route or a gateway token:

```sh
npx wrangler@latest dev --config tools/t108-feasibility/bridge-wrangler.toml
node tools/t108-feasibility/bridge-run.mjs /tmp/t108-run.json
node tools/t108-feasibility/collect.mjs /tmp/t108-run.json /tmp/t108-provider-raw.json
```

The collector uses Wrangler's OAuth command internally and keeps its token in memory. Never print its token or persist it in an artifact. Stop the bridge after the bounded run. See `evidence/RESULTS.md` for the incomplete deployed proof and remaining blockers.

Deploy the isolated `hash-wrangler.toml` service first, then `wrangler.toml`. Only the Lead deployment workflow should do this after confirming the account is on the Free plan. Never use the application deployment command.

```sh
node tools/t108-feasibility/runner.mjs https://righelt-t108-gateway.kenankigunda.workers.dev /tmp/t108-run.json
node tools/t108-feasibility/evaluate.mjs /tmp/t108-run.json /tmp/t108-provider.json /tmp/t108-evidence.json
```

The remote runner reads `T108_PROBE_TOKEN` from its environment and sends it only to the specified isolated gateway, with redirects disabled. It records three vectors, 100 sequential operations, a 20-request burst, and the UTC run interval. It exits unsuccessfully until provider evidence passes. The evaluator can attach provider evidence afterward without repeating the load test.

Provider evidence must include these fields:

- `runId`, `startedAt`, `finishedAt`: match the report exactly.
- `resourceNames`: contain `righelt-t108-hash-engine` and `righelt-t108-hash-feasibility`.
- `source`: location of the retained provider export and review evidence.
- `plan`: `free`, verified from the provider account.
- `hashCpuP95Ms`, `cpuSource`, `cpuSamples`: provider CPU evidence for at least the 103 sequential/vector invocations. Do not substitute wall time or a sample count from unrelated requests.
- `memoryBytes`, `memoryStatistic`, `memorySource`: measured memory, labelled `peak` or `p999` accurately. A percentile is not an exact maximum.
- `resourceLimitFailures`: zero, from provider outcomes across the full run.
- `coldStartMeasured`: true only after provider evidence establishes a cold invocation and its measurements.
- `requestsConsumed`, `durationGbSeconds`, `withinFreeAllowance`: measured consumption and verified remaining Free-plan allowance, including the gateway and both services.

Retain underlying exports alongside the summary. A JSON assertion alone is not proof; these fields are an interface for a reviewed provider collector. Missing metrics fail the gate. Performance timing returned by the Worker is labelled wall time and is never used as CPU evidence. No paid upgrade or weaker hash is allowed when this gate fails.

No browser E2E test applies to this private synthetic probe. Account UI, credentials, D1 migrations and production cutover remain out of scope.
