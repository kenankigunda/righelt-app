import { SYNC_LIMITS, SYNC_TIMING } from "../../shared-types/src/sync-protocol";
export class SyncBodyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
/** Bound actual bytes, including chunked requests, before parsing or mutating. */
export async function readSyncBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > SYNC_LIMITS.bodyBytes) throw new SyncBodyError(413, "sync_body_too_large");
  const reader = request.body?.getReader();
  if (!reader) throw new SyncBodyError(400, "invalid_sync_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new SyncBodyError(408, "sync_body_timeout")); void reader.cancel().catch(() => undefined); }, SYNC_TIMING.requestTimeoutMs);
  });
  try {
    while (true) {
      const item = await Promise.race([reader.read(), timeout]);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > SYNC_LIMITS.bodyBytes) { void reader.cancel().catch(() => undefined); throw new SyncBodyError(413, "sync_body_too_large"); }
      chunks.push(item.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); } catch { throw new SyncBodyError(400, "invalid_sync_request"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyncBodyError(400, "invalid_sync_request");
    return body as Record<string, unknown>;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
