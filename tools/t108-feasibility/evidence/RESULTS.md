# T-108.01 deployed evidence — gate not passed

Run `29bf2371-dbed-431d-b3c5-2b3d56630584`, 2026-10-03. Synthetic inputs only. The account dashboard's Workers plans page showed Free as Current plan before deployment. OAuth succeeded; the subscriptions API still returned 403. No plan change was made.

Private deployments (no public routes or preview URLs):

- `righelt-t108-hash-engine`, version `a722ddcb-6eb1-4f83-94e8-045ec6bfaf7e`.
- `righelt-t108-hash-feasibility`, version `0037bb80-f39b-4020-820c-0a4e1b696669`.

The local bridge called these deployed services through a remote service binding. All three known-answer vectors, Unicode/long inputs and incorrect-password checks passed. All 100 sequential operations succeeded; end-to-end p95 was 592.17 ms. The 20-request burst returned five successes and fifteen 429 responses with Retry-After 1.

The provider tail retained only 44 Durable Object events, all outcome `ok`. For that incomplete sample, CPU p95 was 359 ms and maximum 373 ms, including two hashes per invocation. The first retained event reported 309 ms CPU and 350 ms wall time. These figures do not establish complete-run CPU or cold-start coverage.

The provider's aggregate invocation and periodic-memory datasets returned empty results for the isolated namespaces; the dashboard likewise showed no recorded usage for them at inspection time. Empty data is not zero consumption. No memory measurement, complete resource-error accounting, or complete Free-tier consumption proof is claimed. Provider metrics must be collected and reviewed before the gate can pass. The raw query, namespace mappings and collection timestamp are retained in `provider-metrics.json`.

`deployed-run.json` retains the complete synthetic response/latency report. `provider-tail.jsonl` retains provider execution events without credentials or real account inputs. Neither resource is bound to application D1 or game rooms. Account implementation remains blocked; no weaker hash or paid upgrade is permitted.


## Follow-up investigation after PR creation

PR [#86](https://github.com/kenankigunda/righelt-app/pull/86) is open independently of the outstanding measurements, as requested. The original empty export above is preserved as historical evidence.

The delayed export now contains hash CPU p95 **358,653 microseconds (358.653 ms)** and periodic V8 isolate memory p999 **2,368,138 bytes (2.26 MiB)**. Its hash periodic row reports **0.46134336 GB-s** and zero CPU-exceeded, memory-exceeded and fatal-internal errors. These are the returned sampled metrics, not complete-run usage or proof of native scrypt peak allocation. No admission periodic row was returned.

The invocation dataset reports `clientDisconnected` outcomes for admission despite successful client responses. Grouped query sample intervals exceed one (up to 1.2667 in this export), confirming adaptive sampling; totals vary across query shapes and cannot be equated to the exact 123 client requests. This explains why a strict sample-count check cannot use estimated `sum.requests` as its sample count. The cause of the disconnect classifications remains unresolved; a remote-binding or streaming-lifecycle artifact is a hypothesis, not a diagnosis.

The stored-log REST API was queried read-only for only the two synthetic script names and the run interval. It returned HTTP 403/code 10000 with the local OAuth credential. This permission is distinct from working GraphQL access and does not mean the CLI login failed. No permission was expanded.

Cloudflare documents [ingestion delay and sampling](https://developers.cloudflare.com/changelog/post/2026-08-20-durable-objects-deployments-tab/), [V8 isolate memory sampling](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/), and [real-time tail sampling](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/). The provider schema explicitly describes CPU quantiles in microseconds and duration in GB-s. Tail sampling is a possible explanation for the 44 retained events, but no sampling warning was captured, so it is not established as their specific cause.

Follow-up validation, separately from review/release of this harness:

1. Add nonsecret run/request correlation IDs and explicit hash-isolate cold-start markers; wait for tail readiness before sending any requests. Retain stored invocation logs when access is available.
2. Compare the existing remote-binding route with a bounded authenticated deployed gateway, keeping the candidate hash unchanged. Correlate admission `clientDisconnected` events to actual responses before changing response buffering or lifecycle behavior.
3. Collect periodic metrics after allowing ingestion delay; distinguish V8 samples from native allocation peaks, estimates from raw samples, and resource-limit errors from disconnect classifications. Measure both namespaces and account-level remaining allowance.
4. Reassess the evidence contract using supported provider measurements. Do not fabricate a complete sample count or mark missing cold-start/native-memory evidence passed. No application account implementation or production release was performed as part of this investigation.
