import { STORAGE_POLICY } from "../../shared-types/src/storage-policy";

export type StorageLimits = { rawBytes: number; storedBytes: number };
export class StorageWriteLimitError extends Error {
  constructor() { super("storage_payload_too_large"); this.name = "StorageWriteLimitError"; }
}
export const stateReadLimits: StorageLimits = Object.freeze({ rawBytes: STORAGE_POLICY.maximumStateBytes, storedBytes: STORAGE_POLICY.maximumLegacyStateBytes });
export const stateWriteLimits = (env: { STORAGE_LARGE_STATES_ENABLED?: string }): StorageLimits => ({
  rawBytes: env.STORAGE_LARGE_STATES_ENABLED === "true" ? STORAGE_POLICY.maximumStateBytes : STORAGE_POLICY.maximumLegacyStateBytes,
  storedBytes: STORAGE_POLICY.maximumStoredStateBytes,
});
const limitsFor = (limits: number | StorageLimits): StorageLimits => {
  const result = typeof limits === "number" ? { rawBytes: limits, storedBytes: limits } : limits;
  if (![result.rawBytes, result.storedBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("invalid_storage_limits");
  return result;
};

export const sha256 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
};
export async function collectBounded(stream: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array> {
  const reader=stream.getReader(), chunks:Uint8Array[]=[];
  let size=0;
  try {
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum)throw new Error("storage_payload_too_large");chunks.push(part.value);}
  } catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export async function encodeStorage(value:unknown, maximum:number|StorageLimits={rawBytes:STORAGE_POLICY.maximumStateBytes,storedBytes:STORAGE_POLICY.maximumStoredStateBytes}) {
  const limits=limitsFor(maximum);
  const raw=new TextEncoder().encode(JSON.stringify(value));
  if(raw.byteLength>limits.rawBytes)throw new StorageWriteLimitError();
  let blob:Uint8Array;
  try { blob=await collectBounded(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),limits.storedBytes); }
  catch(error) { if((error as Error).message==="storage_payload_too_large")throw new StorageWriteLimitError();throw error; }
  return {blob,checksum:await sha256(blob),rawBytes:raw.byteLength};
}
export async function decodeStorage(blob: ArrayBuffer|Uint8Array|number[], checksum:string, maximum:number|StorageLimits=stateReadLimits):Promise<unknown> {
  const limits=limitsFor(maximum);
  const bytes=blob instanceof Uint8Array?blob:new Uint8Array(blob);
  if(bytes.byteLength>limits.storedBytes || await sha256(bytes)!==checksum)throw new Error("storage_checksum_mismatch");
  const raw=await collectBounded(new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream("gzip")),limits.rawBytes);
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
}
