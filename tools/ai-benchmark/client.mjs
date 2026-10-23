// Diagnostic client only. Production authority remains gated on T-114/T-108.
export class BenchmarkWorker {
  constructor({ url, workerFactory = url => new Worker(url, { type: 'module' }), timers = globalThis }) {
    Object.assign(this, { url, workerFactory, timers });
    this.generation = 0; this.nextId = 0; this.worker = null; this.pending = null;
  }
  cancel(reason = 'cancelled') {
    this.generation++;
    const worker = this.worker; this.worker = null; worker?.terminate();
    const pending = this.pending; this.pending = null;
    if (pending) { this.timers.clearTimeout(pending.timer); pending.reject(new Error(reason)); }
  }
  request(message, cutoffMs, { onProgress = () => {}, progressResetsTimeout = false } = {}) {
    if (this.pending) throw new Error('Only one computation may own the worker');
    if (!Number.isFinite(cutoffMs) || cutoffMs <= 0) throw new Error('Invalid watchdog');
    if (!this.worker) {
      const worker = this.worker = this.workerFactory(this.url);
      worker.onmessage = ({ data }) => {
        const request = this.pending;
        if (this.worker !== worker || !request || data.id !== request.id || request.generation !== this.generation) return;
        if (data.generation !== request.generation) { this.cancel('stale-generation'); return; }
        if (request.metadata && JSON.stringify(data.metadata) !== JSON.stringify(request.metadata)) { this.cancel('stale-result'); return; }
        if (data.type === 'progress') {
          onProgressGuard(request, data);
          return;
        }
        if (data.type === 'error') { this.cancel(data.message || 'worker-error'); return; }
        if (data.type !== request.expected) { this.cancel('invalid-worker-response'); return; }
        this.timers.clearTimeout(request.timer); this.pending = null; request.resolve(data);
      };
      worker.onerror = () => { if (this.worker === worker) this.cancel('worker-error'); };
      worker.onmessageerror = () => { if (this.worker === worker) this.cancel('worker-message-error'); };
    }
    const onProgressGuard = (request, data) => {
      if (request.progressResetsTimeout) {
        this.timers.clearTimeout(request.timer);
        request.timer = this.timers.setTimeout(() => this.cancel('no-progress'), request.cutoffMs);
      }
      request.onProgress(data);
    };
    const expected = { initialize: 'initialized', compute: 'computed', evaluateBatch: 'evaluated-batch' }[message.type];
    if (!expected) throw new Error('Unknown client request');
    const id = ++this.nextId, generation = this.generation;
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => this.cancel('watchdog-expired'), cutoffMs);
      this.pending = { id, generation, metadata: message.metadata, expected, resolve, reject, timer, onProgress, progressResetsTimeout, cutoffMs };
      try { this.worker.postMessage({ ...message, id, generation }); }
      catch (error) { this.cancel(error.message); }
    });
  }
}

import { sha256, fetchVerifiedAsset } from '../../apps/web/shell/verified-assets.js';
export { sha256, fetchVerifiedAsset };

const CACHE = 'righelt-benchmark-assets-v1';
export async function loadVerifiedAsset(url, expected, options = {}) {
  const key = new URL(url, location.href); key.searchParams.set('sha256', expected.sha256);
  let cache;
  try { cache = await caches.open(CACHE); } catch { /* Memory-only preparation is reported below. */ }
  if (options.mode === 'warm' && cache) {
    const found = await cache.match(key.href);
    if (found) {
      const bytes = new Uint8Array(await found.arrayBuffer());
      if (bytes.length !== expected.bytes || await sha256(bytes) !== expected.sha256) throw new Error('Cached asset is corrupt; retry cold preparation');
      options.onProgress?.({ received: bytes.length, total: expected.bytes });
      return { bytes, source: 'cache', cached: true };
    }
  }
  const bytes = await fetchVerifiedAsset(url, expected, options);
  let cached = false;
  if (cache) {
    try { await cache.put(key.href, new Response(bytes)); cached = true; } catch { /* Run validated bytes in memory with an explicit notice. */ }
  }
  return { bytes, source: 'network', cached };
}
