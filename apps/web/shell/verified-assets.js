import { fetchComputerResource, computerNetworkError } from './computer-recovery.js';

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
export async function fetchVerifiedAsset(url, expected, { onProgress = () => {}, signal, noProgressMs = 30000,
  fetchImpl = fetch, cache = 'no-store' } = {}) {
  if (!/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0) throw new Error('Invalid asset manifest');
  const controller = new AbortController(); let timeout;
  const reset = () => { clearTimeout(timeout); timeout = setTimeout(() => controller.abort('no-progress'), noProgressMs); };
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  reset();
  try {
    const response = await fetchComputerResource(url, { fetchImpl, signal: controller.signal, cache });
    if (!response.body) throw Object.assign(new Error('Partial asset'), { code: 'computer_transfer_incomplete' });
    const reader = response.body.getReader(); let received = 0; const chunks = [];
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch (error) { throw computerNetworkError(error, controller.signal); }
      const { done, value } = chunk; if (done) break;
      if (!value.length) continue;
      received += value.length;
      if (received > expected.bytes) { await reader.cancel(); throw new Error('Asset size mismatch'); }
      chunks.push(value); reset(); onProgress({ received, total: expected.bytes });
    }
    if (received !== expected.bytes) throw Object.assign(new Error('Partial asset'), { code: 'computer_transfer_incomplete' });
    const bytes = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (await sha256(bytes) !== expected.sha256) throw new Error('Asset checksum mismatch');
    if (controller.signal.aborted) throw computerNetworkError(null, controller.signal);
    return bytes;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
