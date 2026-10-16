import { BenchmarkWorker, loadVerifiedAsset } from './client.mjs';
import { deterministicStateHash } from '../../packages/game-engine/src/index.ts';
import settings from '../../packages/computer-player/config/benchmark-v1.json';
import encoding from '../../packages/computer-player/config/experiment-v1.json';
const status = document.querySelector('#status'), output = document.querySelector('#report');
const client = new BenchmarkWorker({ url: null });
let manifest, corpus, ready = false, operation = 0, downloadController, workerUrl;
const report = { schema: 1, startedAt: new Date().toISOString(), userAgent: navigator.userAgent,
  measurements: [], interruptions: [], workloads: [], productionApproved: false, profilesCalibrated: false,
  settings, preparationAssets: [] };
const show = () => { output.textContent = JSON.stringify({ ...report, measurements: `${report.measurements.length} records retained in download` }, null, 2); };
function cancel(reason = 'Stopped') {
  operation++; ready = false; downloadController?.abort(reason); client.cancel(reason);
  if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
  document.querySelector('#run').disabled = true; document.querySelector('#parity').disabled = true;
  status.textContent = `${reason}. Prepare again to retry, or leave.`;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { report.interruptions.push({ at: new Date().toISOString(), reason: 'background' }); cancel('Backgrounded'); show(); }
});
window.addEventListener('pagehide', () => cancel('Left page'));
function identity(state, revision, profile) {
  return { gameId: 'benchmark', gameplayRevision: revision, fingerprint: state ? deterministicStateHash(state) : 'batch',
    generation: client.generation, modelVersion: manifest.modelVersion, profileVersion: profile, seed: 107 + revision };
}
function provenance() {
  report.device = document.querySelector('#device').value.trim(); report.network = document.querySelector('#network').value.trim();
  report.connection = navigator.connection ? { effectiveType: navigator.connection.effectiveType, rtt: navigator.connection.rtt,
    downlink: navigator.connection.downlink, saveData: navigator.connection.saveData } : null;
  if (!report.device || !report.network) throw new Error('Record device and actual network conditions first');
  return { device: report.device, network: report.network, connection: report.connection };
}
async function prepare({ mode = document.querySelector('#cache').value } = {}) {
  cancel('Preparing'); const token = operation; downloadController = new AbortController();
  const signal = downloadController.signal; let begin, manifestMs = 0;
  const metadata = { kind: 'preparation', cacheMode: mode, cold: mode === 'cold', profile: null };
  try {
    const manifestStart = performance.now();
    const manifestTimer = setTimeout(() => downloadController.abort('manifest-no-progress'), settings.noProgressMs);
    let response;
    try {
      response = await fetch('manifest.json', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Manifest unavailable');
      manifest = await response.json();
    } finally { clearTimeout(manifestTimer); }
    manifestMs = performance.now() - manifestStart;
    if (manifest.schema !== 1 || manifest.encodingVersion !== encoding.encodingVersion || typeof manifest.runtimeVersion !== 'string' ||
        manifest.modelVersion !== manifest.assets?.model?.sha256) throw new Error('Incompatible asset manifest');
    status.textContent = 'Loading the diagnostic positions (excluded from model preparation timing).';
    const fixture = await loadVerifiedAsset(manifest.assets.corpus.path, manifest.assets.corpus,
      { mode: 'warm', signal, noProgressMs: settings.noProgressMs });
    corpus = JSON.parse(new TextDecoder().decode(fixture.bytes));
    if (!Array.isArray(corpus.states) || !corpus.states.length) throw new Error('No diagnostic positions');
    begin = performance.now();
    const assets = {};
    for (const name of ['worker', 'runtimeMjs', 'runtimeWasm', 'model']) {
      const asset = manifest.assets[name];
      assets[name] = await loadVerifiedAsset(asset.path, asset, { mode, signal, noProgressMs: settings.noProgressMs,
        onProgress: ({ received, total }) => {
          if (token === operation) status.textContent = `${name}: ${received.toLocaleString()} / ${total.toLocaleString()} bytes. Progressing; you can stop or leave.`;
        } });
      if (token !== operation) throw new Error('Preparation cancelled');
      report.preparationAssets.push({ modelVersion: manifest.modelVersion, name, bytes: assets[name].bytes.length,
        source: assets[name].source, cached: assets[name].cached, cacheMode: mode });
    }
    workerUrl = URL.createObjectURL(new Blob([assets.worker.bytes], { type: 'text/javascript' }));
    client.url = workerUrl;
    await client.request({ type: 'initialize', bytes: assets.model.bytes, modelVersion: manifest.modelVersion,
      runtimeVersion: manifest.runtimeVersion, runtimeMjsBytes: assets.runtimeMjs.bytes, runtimeWasmBytes: assets.runtimeWasm.bytes }, settings.noProgressMs,
    { progressResetsTimeout: true, onProgress: () => { status.textContent = 'Initializing the verified model and runtime.'; } });
    if (token !== operation) throw new Error('Preparation cancelled');
    ready = true; document.querySelector('#run').disabled = false; document.querySelector('#parity').disabled = false;
    const durationMs = performance.now() - begin + manifestMs;
    report.measurements.push({ ...metadata, status: 'completed', durationMs, modelVersion: manifest.modelVersion });
    report.modelVersion = manifest.modelVersion;
    status.textContent = `Prepared in ${(durationMs / 1000).toFixed(2)} seconds. ${Object.values(assets).some(a => !a.cached) ? 'Some assets could not be cached; this session runs from memory.' : 'Validated assets are cached.'}`;
  } catch (error) {
    report.measurements.push({ ...metadata, status: token !== operation || document.hidden ? 'interrupted' : 'failed',
      durationMs: begin === undefined ? manifestMs : performance.now() - begin + manifestMs, error: error.message });
    if (token === operation) cancel(`Preparation failed: ${error.message}`);
    throw error;
  } finally { show(); }
}

async function step(state, profile, revision, { sequenceId = null, softMs, cutoffMs }) {
  const begin = performance.now(), metadata = identity(state, revision, `${settings.profileVersion}:${profile}`), token = operation;
  const row = { id: `${profile}-${revision}`, kind: 'step', profile, profileVersion: metadata.profileVersion,
    seed: metadata.seed, modelVersion: manifest.modelVersion, fingerprint: metadata.fingerprint,
    sequenceStep: sequenceId !== null || !!state.continuation, sequenceId, ...provenance() };
  try {
    const response = await client.request({ type: 'compute', state, metadata, profile: settings.profiles[profile], softMs }, cutoffMs);
    row.status = response.result.status === 'ready' ? 'completed' : 'unfinished'; row.result = response.result;
    return { ...response.result, nextState: response.nextState };
  } catch (error) {
    row.status = document.hidden || token !== operation ? 'interrupted' : 'failed'; row.error = error.message;
    ready = false; throw error;
  } finally { row.durationMs = performance.now() - begin; report.measurements.push(row); }
}
async function measure({ profile = document.querySelector('#profile').value,
  steps = settings.stepsPerProfile, sequences = settings.sequencesPerProfile } = {}) {
  if (!ready) throw new Error('Prepare first');
  const environment = provenance(), token = operation;
  const profiles = profile === 'all' ? Object.keys(settings.profiles) : [profile];
  if (profiles.some(name => !settings.profiles[name]) || !Number.isSafeInteger(steps) || steps < 0 ||
      !Number.isSafeInteger(sequences) || sequences < 0) throw new Error('Invalid workload');
  document.querySelector('#run').disabled = true; document.querySelector('#parity').disabled = true;
  try {
    for (const name of profiles) {
      report.workloads.push({ profile: name, stepsRequested: steps, sequencesRequested: sequences,
        meetsMinimumRequested: steps >= settings.stepsPerProfile && sequences >= settings.sequencesPerProfile, ...environment });
      for (let i = 0; i < steps && operation === token; i++) {
        const state = corpus.states[i % corpus.states.length].state;
        await step(state, name, report.measurements.length, { softMs: state.continuation ? settings.softSequenceStepMs : settings.softStepMs,
          cutoffMs: settings.provisionalStepWatchdogMs });
        status.textContent = `${name}: ${i + 1}/${steps} warm steps. Failed and unfinished work stays in the report.`;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const starts = corpus.states.filter(item => item.state.continuation && item.state.outcome.status === 'ongoing');
      if (sequences && !starts.length) throw new Error('Corpus has no continuation starts for sequence measurements');
      for (let i = 0; i < sequences && operation === token; i++) {
        const begin = performance.now(), sequenceId = `${name}-sequence-${report.measurements.length}`;
        let state = starts[i % starts.length].state; const owner = state.sideToMove;
        const row = { id: sequenceId, kind: 'sequence', profile: name, profileVersion: `${settings.profileVersion}:${name}`,
          modelVersion: manifest.modelVersion, status: 'unfinished', steps: 0, ...environment };
        try {
          while (state.outcome.status === 'ongoing' && state.sideToMove === owner && operation === token) {
            const elapsed = performance.now() - begin;
            if (elapsed >= settings.softSequenceMs) { row.reason = 'sequence-soft-stop'; break; }
            const result = await step(state, name, report.measurements.length, { sequenceId,
              softMs: Math.min(settings.softSequenceStepMs, settings.softSequenceMs - elapsed),
              cutoffMs: Math.min(settings.provisionalStepWatchdogMs, settings.provisionalSequenceWatchdogMs - elapsed) });
            row.steps++;
            if (result.status !== 'ready') { row.reason = result.reason; break; }
            state = result.nextState;
          }
          if (state.outcome.status !== 'ongoing' || state.sideToMove !== owner) { row.status = 'completed'; row.reason = 'terminal-or-human-decision'; }
          if (operation !== token) row.status = 'interrupted';
        } catch (error) { row.status = document.hidden || operation !== token ? 'interrupted' : 'failed'; row.error = error.message; throw error; }
        finally { row.durationMs = performance.now() - begin; report.measurements.push(row); }
        status.textContent = `${name}: ${i + 1}/${sequences} uninterrupted sequences measured.`;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } finally {
    document.querySelector('#run').disabled = !ready; document.querySelector('#parity').disabled = !ready; show();
  }
  return report;
}
async function rawParity({ count = 1000 } = {}) {
  if (!ready || count > corpus.states.length || !Number.isSafeInteger(count) || count < 1) throw new Error('Not enough prepared parity states');
  const token = operation, results = [], begin = performance.now();
  document.querySelector('#run').disabled = true; document.querySelector('#parity').disabled = true;
  try {
    for (let offset = 0; offset < count; offset += 16) {
      if (operation !== token) throw new Error('Parity interrupted');
      const states = corpus.states.slice(offset, Math.min(count, offset + 16)).map(item => ({ ...item, fingerprint: deterministicStateHash(item.state) }));
      const response = await client.request({ type: 'evaluateBatch', states, metadata: identity(null, offset, 'raw-parity-v1') }, settings.noProgressMs);
      results.push(...response.results); status.textContent = `${results.length}/${count} raw parity states evaluated.`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = { schema: 1, modelVersion: manifest.modelVersion, userAgent: navigator.userAgent, backend: 'wasm', threads: 1,
      count, durationMs: performance.now() - begin, results, productionApproved: false };
    window.benchmark.parityResult = result; return result;
  } finally { document.querySelector('#run').disabled = !ready; document.querySelector('#parity').disabled = !ready; show(); }
}
async function searchParity({ rows, profile }) {
  if (!ready || !Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error('Invalid search parity request');
  const token = operation, results = [], byId = new Map(corpus.states.map(row => [row.id, row]));
  for (const row of rows) {
    if (token !== operation) throw new Error('Search parity interrupted');
    const item = byId.get(row.id);
    if (!item || !Number.isSafeInteger(row.seed)) throw new Error('Unknown search parity state');
    const metadata = { ...identity(item.state, results.length, 'search-parity-v1'), seed: row.seed };
    const response = await client.request({ type: 'compute', state: item.state, metadata, profile, softMs: 9000 }, 10000);
    results.push({ id: row.id, seed: row.seed, result: response.result });
    status.textContent = `${results.length}/${rows.length} search parity states evaluated.`;
  }
  return { modelVersion: manifest.modelVersion, results };
}
function download(value, prefix) {
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  link.download = `${prefix}-${Date.now()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const displayError = error => { status.textContent = `${error.message}. Retry preparation or leave; all results are retained.`; };
document.querySelector('#prepare').onclick = () => prepare().catch(displayError);
document.querySelector('#run').onclick = () => measure().catch(displayError);
document.querySelector('#parity').onclick = () => rawParity().then(value => download(value, 'righelt-wasm-parity')).catch(displayError);
document.querySelector('#stop').onclick = () => cancel();
document.querySelector('#save').onclick = () => download(report, 'righelt-benchmark');
window.benchmark = { prepare, measure, rawParity, searchParity, cancel, report, client, settings };
