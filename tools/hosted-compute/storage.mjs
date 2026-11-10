// Durable Object KV values have a size limit. A run inventory can exceed it,
// so commit bounded binary chunks and their head in one storage transaction.
const CHUNK_BYTES = 48 * 1024;
export class LedgerStorage {
  constructor(storage) { this.storage = storage; }
  async get(key) {
    const head = await this.storage.get(`${key}/head`);
    if (!head) return undefined;
    const keys = Array.from({ length: head.chunks }, (_, i) => `${key}/${i}`);
    const records = await this.storage.get(keys), bytes = new Uint8Array(head.bytes);
    let offset = 0;
    for (const name of keys) {
      const chunk = records.get(name);
      if (!(chunk instanceof Uint8Array)) throw Error('controller ledger chunk missing');
      bytes.set(chunk, offset); offset += chunk.byteLength;
    }
    if (offset !== head.bytes) throw Error('controller ledger size mismatch');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async put(key, value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)), count = Math.ceil(bytes.length / CHUNK_BYTES);
    await this.storage.transaction(async tx => {
      const old = await tx.get(`${key}/head`), updates = {};
      for (let i = 0; i < count; i++) updates[`${key}/${i}`] = bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      updates[`${key}/head`] = { chunks: count, bytes: bytes.length };
      await tx.put(updates);
      if (old?.chunks > count) await tx.delete(Array.from({ length: old.chunks - count }, (_, i) => `${key}/${count + i}`));
    });
  }
}
