import { COMPUTER_LIMITS, COMPUTER_TIMING, COMPUTER_PROFILES, getComputerModel } from '../generated/packages/shared-types/src/computer-play.js';
import { deterministicStateHash } from '../generated/packages/game-engine/src/hash.js';
import { fetchVerifiedAsset, sha256 } from './verified-assets.js';
import { fetchComputerResource, computerNetworkError } from './computer-recovery.js';

export const TRAINED_COMPUTER_PLAY = 'enabled';

const CACHE_PREFIX = 'righelt-computer-model-';
export async function loadComputerModel(model, { signal, onProgress, cacheStorage = globalThis.caches, fetchImpl = globalThis.fetch } = {}) {
  let cache;
  try { cache = await cacheStorage?.open(CACHE_PREFIX + model.id); } catch { /* Verified memory-only operation remains available. */ }
  const key = new URL(model.url, globalThis.location?.href ?? 'http://localhost').href;
  try {
    const cached = await cache?.match(key);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (bytes.length === model.bytes && await sha256(bytes) === model.sha256) return { bytes, cached: true };
      await cache.delete(key);
    }
  } catch { cache = null; }
  const bytes = await fetchVerifiedAsset(key, model, { signal, onProgress, fetchImpl, noProgressMs: COMPUTER_TIMING.stalledAfterMs });
  let saved = false;
  if (cache) {
    try {
      await cache.put(key, new Response(bytes)); saved = true;
      const names = (await cacheStorage.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_PREFIX + model.id);
      while (names.length >= COMPUTER_LIMITS.cachedModels) await cacheStorage.delete(names.shift());
    } catch { /* Cache availability is diagnostic, never an authority decision. */ }
  }
  return { bytes, cached: saved };
}

/** One real worker per runtime. Cancellation destroys it, including blocked WASM work. */
export class ComputerRuntime {
  constructor({ workerFactory = url => new Worker(url, { type: 'module' }), timers = globalThis, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    Object.assign(this, { workerFactory, timers, fetchImpl });
    this.generation = 0; this.requestId = 0; this.worker = null; this.pending = null; this.modelId = null; this.controller = null;
  }
  cancel(reason = 'cancelled') {
    this.generation++;
    this.controller?.abort(reason); this.controller = null;
    this.worker?.terminate(); this.worker = null; this.modelId = null;
    if (this.workerUrl) { URL.revokeObjectURL(this.workerUrl); this.workerUrl = null; }
    const pending = this.pending; this.pending = null;
    if (pending) { this.timers.clearTimeout(pending.timer); pending.reject(new Error(reason)); }
  }
  request(message, onProgress = () => {}) {
    if (!this.worker || this.pending) throw new Error('computer_runtime_busy');
    const generation = this.generation, id = ++this.requestId;
    const metadata = message.metadata ? { ...message.metadata, generation } : undefined;
    const expected = { initialize: 'initialized', compute: 'computed', evaluateBatch: 'evaluated-batch' }[message.type];
    return new Promise((resolve, reject) => {
      const pending = { id, generation, metadata, expected, resolve, reject, onProgress, work: 0 };
      const reset = () => { this.timers.clearTimeout(pending.timer); pending.timer = this.timers.setTimeout(() => this.cancel('no-progress'), COMPUTER_TIMING.stalledAfterMs); };
      pending.reset = reset; reset(); this.pending = pending;
      try { this.worker.postMessage({ ...message, ...(metadata ? { metadata } : {}), generation, id }); }
      catch (error) { this.cancel(error.message); }
    });
  }
  receive(worker, data) {
    const pending = this.pending;
    if (worker !== this.worker || !pending || pending.generation !== this.generation || data.id !== pending.id) return;
    if (data.generation !== pending.generation || JSON.stringify(data.metadata) !== JSON.stringify(pending.metadata)) { this.cancel('stale-result'); return; }
    if (data.type === 'progress') {
      // A phase label or repeated heartbeat cannot indefinitely keep stalled work alive.
      const work = data.work ?? data.completed;
      if (Number.isFinite(work) && work > pending.work) { pending.work = work; pending.reset(); }
      pending.onProgress(data); return;
    }
    if (data.type === 'error') { this.cancel(data.message || 'worker-error'); return; }
    if (data.type !== pending.expected) { this.cancel('invalid-worker-response'); return; }
    this.timers.clearTimeout(pending.timer); this.pending = null; pending.resolve(data);
  }
  async prepare(modelId, onProgress = () => {}) {
    if (this.modelId === modelId && this.worker) return;
    this.cancel('preparing');
    const preparingGeneration = this.generation;
    try {
    const descriptor = getComputerModel(modelId);
    if (!descriptor) throw new Error('model-unavailable');
    const generation = this.generation;
    const controller = this.controller = new AbortController();
    let manifest;
    const manifestTimeout = this.timers.setTimeout(() => controller.abort('no-progress'), COMPUTER_TIMING.stalledAfterMs);
    try {
      const response = await fetchComputerResource('/computer/runtime/manifest.json', { fetchImpl: this.fetchImpl, signal: controller.signal, cache: 'no-store' });
      try { manifest = await response.json(); }
      catch (error) { if (error instanceof SyntaxError) throw new Error('runtime-incompatible'); throw computerNetworkError(error, controller.signal); }
    } finally { this.timers.clearTimeout(manifestTimeout); }
    if (manifest.schema !== 1 || !manifest.runtimeVersion || !manifest.assets) throw new Error('runtime-incompatible');
    const asset = async name => {
      const entry = manifest.assets[name];
      if (!entry || !/^\/computer\/runtime\/[a-zA-Z0-9.-]+$/.test(entry.url)) throw new Error('runtime-incompatible');
      return fetchVerifiedAsset(entry.url, entry, { signal: controller.signal, fetchImpl: this.fetchImpl, noProgressMs: COMPUTER_TIMING.stalledAfterMs, onProgress: progress => onProgress({ phase: 'preparing', asset: name, ...progress }) });
    };
    const model = await loadComputerModel(descriptor, { signal: controller.signal, fetchImpl: this.fetchImpl, onProgress: progress => onProgress({ phase: 'preparing', asset: 'model', ...progress }) });
    const [workerBytes, runtimeMjsBytes, runtimeWasmBytes] = await Promise.all([asset('worker'), asset('runtimeMjs'), asset('runtimeWasm')]);
    if (generation !== this.generation || controller.signal.aborted) throw new Error('cancelled');
    this.workerUrl = URL.createObjectURL(new Blob([workerBytes], { type: 'text/javascript' }));
    const worker = this.worker = this.workerFactory(this.workerUrl);
    worker.onmessage = ({ data }) => this.receive(worker, data);
    worker.onerror = worker.onmessageerror = () => { if (this.worker === worker) this.cancel('worker-error'); };
    await this.request({ type: 'initialize', bytes: model.bytes, runtimeMjsBytes, runtimeWasmBytes, runtimeVersion: manifest.runtimeVersion, modelVersion: descriptor.sha256 }, onProgress);
    if (generation !== this.generation) throw new Error('cancelled');
    this.modelId = modelId; this.cacheAvailable = model.cached;
    } catch (error) { if (this.generation === preparingGeneration) this.cancel(error.message); throw error; }
  }
  async compute({ gameId, gameplayRevision, state, modelId, profile, seed, controlGeneration, analysis = false }, onProgress) {
    await this.prepare(modelId, onProgress);
    if (!COMPUTER_PROFILES[profile]) throw new Error('invalid-profile');
    const settings = { ...COMPUTER_PROFILES[analysis ? 'horus' : profile], ...(analysis ? { temperature: 0, maxValueGap: 0 } : {}) };
    return this.request({ type: 'compute', state, profile: settings, metadata: { gameId, gameplayRevision, fingerprint: deterministicStateHash(state), modelVersion: getComputerModel(modelId).sha256, profileVersion: settings.version, seed, controlGeneration } }, onProgress);
  }
}
