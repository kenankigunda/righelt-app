# Standalone trained-play proof harness

This diagnostic page is separate from production gameplay. Profiles and watchdogs are explicitly experimental. It neither promotes a model nor establishes iPhone acceptance.

Build from the repository root with an exported ONNX model and the engine-state parity corpus:

```sh
node scripts/build-ai-benchmark.mjs --out /tmp/righelt-benchmark --model /path/model.onnx --corpus /path/corpus.json
```

Serve that directory over localhost for desktop checks or a user-approved HTTPS origin for an actual phone. Camera/location permissions and login are unnecessary. Hosting or deployment is not performed by the build. The page needs a secure context for checksums and caching.

Record the actual device/OS and network conditions, including carrier, cellular generation and signal conditions when relevant. Cold preparation bypasses the asset cache; warm preparation uses cached bytes only after rechecking their checksums. The worker bundle, runtime module, WASM and model are verified before use. The corpus is diagnostic workload data and its download is excluded from model preparation timing. Failed cache writes are reported; validated bytes can run in memory.

The default workload records 1,000 warm computations and 100 uninterrupted sequences for each selected experimental profile. A change to the actual decision-maker ends a computer sequence. All constituent steps, failed/unfinished work, elapsed durations and foreground interruptions remain in the downloadable report. Backgrounding terminates the worker; foreground return requires explicit preparation before another measurement. Stop also terminates blocked synchronous engine code or WASM inference.

The raw-parity action evaluates 1,000 states through single-threaded browser WASM and downloads logits, P1 values and legal masks. This proves numerical compatibility only after comparison with the corresponding Python reference. It does not prove tactical outcomes, calibrated strength, target-phone timing or playing experience.

## Repeatable checks

```sh
node --test tools/ai-benchmark/tests/client.test.mjs
AI_BENCHMARK_DIR=/tmp/righelt-benchmark node --test tools/ai-benchmark/tests/browser.test.mjs
```

The browser suite uses Playwright Chromium by default. `AI_BENCHMARK_CHANNEL=chrome` explicitly selects an installed Chrome build. Run with `AI_BENCHMARK_REFERENCE=/path/mps-reference.json` to compare all 1,000 states, and `AI_BENCHMARK_REPORT=/path/wasm-report.json` to save the numeric proof and exact browser version. Without a reference, the integration test uses three parity states and a deliberately small timing workload; it is not a complete timing acceptance run.

Runtime files are copied from the pinned `onnxruntime-web` dependency, not fetched from a CDN. The initial full runtime is roughly 14 MB before transfer compression, so actual cold cellular preparation remains an unresolved measurement gate. Production two-version model retention, revocation and upgrade decisions belong to the subsequent model-delivery package; this harness's checksum cache is diagnostic only.

Search parity uses the same held-out states with real model calls at every visited node. Generate a reference with `pnpm ai:search-parity --corpus /path/corpus.json --output /path/search-reference.json` (MPS by default). The command exports the exact reference model beside the report; build the browser harness with that export. Set `AI_BENCHMARK_SEARCH_REFERENCE` and `AI_BENCHMARK_SEARCH_REPORT` when running the browser suite. It requires matching model checksums, completed results, identical immediate/tactical classifications, and matching selections except value ties within the FP32 numerical bound. CI runs a 20-state regression subset; the training launch requires the separate complete 1,000-state proof. Neither establishes the sealed tactical quality suite or target-phone acceptance.

A ready move returned at a soft deadline is valid runtime recovery, but is censored evidence for cross-runtime search parity. The comparator rejects it and requires equal completed simulation counts. The reference driver uses a separate 30-second diagnostic bound. `--repair-reference OLD --reference-revision COMMIT` can remeasure only incomplete reference rows after checking identical model, corpus, configuration, profile and unchanged search/engine source. It preserves the original report by writing a new artifact with the prior checksum and recomputed IDs. Observed browser results are retained beside the proof even if comparison fails; `node scripts/compare-ai-search-parity.mjs reference.json observed.json report.json` applies the same comparison to those saved artifacts. These are validation diagnostics, not sealed final quality tests or phone timing measurements.

### Decision-local cache pilot and selection diagnostics

`pnpm ai:selection-diagnostic --corpus FILE --baseline-root DIR --output FILE --repetitions 3`
compares the archived earlier engine/search source, current default behavior and the
opt-in cache on the same development workload. Archive the chosen source revision
with its `packages/game-engine`, `packages/computer-player` and `packages/shared-types`
paths. The corpus must not contain final partitions. The command refuses to overwrite
its output and uses isolated, time-bounded child processes. Fixed synthetic logits
isolate engine/search costs; these results say nothing about playing strength.

The report separates exact enumeration, selection, recording, independent replay,
process startup, synthetic inference, peak resident memory and an additional
instrumented pass. Instrumented timings are separate from the timing comparison.
Continuation-state counts use full rule-state keys; local memo-hit counts retain
the existing narrower, call-local keys and are not a second unique-state count.

`SearchRequest.decisionCache` defaults to false. The pilot caches only completed
outer continuation-completion checks, keyed by the entire state except derived UI
artifacts. It retains at most 512 entries and 4 MiB of estimated key/entry storage;
that estimate is not a VM heap measurement. It expires with the decision. Recursive
visiting markers and interrupted results never enter it, and no cache context stays
installed across an inference await. Adoption requires repeatable end-to-end benefit
without correctness or memory regressions; a faster microbenchmark is insufficient.
