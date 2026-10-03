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
