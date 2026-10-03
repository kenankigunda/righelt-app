# T-108.01 deployed evidence — gate not passed

Run `29bf2371-dbed-431d-b3c5-2b3d56630584`, 2026-10-03. Synthetic inputs only. The account dashboard's Workers plans page showed Free as Current plan before deployment. OAuth succeeded; the subscriptions API still returned 403. No plan change was made.

Private deployments (no public routes or preview URLs):

- `righelt-t108-hash-engine`, version `a722ddcb-6eb1-4f83-94e8-045ec6bfaf7e`.
- `righelt-t108-hash-feasibility`, version `0037bb80-f39b-4020-820c-0a4e1b696669`.

The local bridge called these deployed services through a remote service binding. All three known-answer vectors, Unicode/long inputs and incorrect-password checks passed. All 100 sequential operations succeeded; end-to-end p95 was 592.17 ms. The 20-request burst returned five successes and fifteen 429 responses with Retry-After 1.

The provider tail retained only 44 Durable Object events, all outcome `ok`. For that incomplete sample, CPU p95 was 359 ms and maximum 373 ms, including two hashes per invocation. The first retained event reported 309 ms CPU and 350 ms wall time. These figures do not establish complete-run CPU or cold-start coverage.

The provider's aggregate invocation and periodic-memory datasets returned empty results for the isolated namespaces; the dashboard likewise showed no recorded usage for them at inspection time. Empty data is not zero consumption. No memory measurement, complete resource-error accounting, or complete Free-tier consumption proof is claimed. Provider metrics must be collected and reviewed before the gate can pass. The raw query, namespace mappings and collection timestamp are retained in `provider-metrics.json`.

`deployed-run.json` retains the complete synthetic response/latency report. `provider-tail.jsonl` retains provider execution events without credentials or real account inputs. Neither resource is bound to application D1 or game rooms. Account implementation remains blocked; no weaker hash or paid upgrade is permitted.
