import { STORAGE_POLICY } from "../../shared-types/src/storage-policy";

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
export async function encodeStorage(value:unknown, maximum:number=STORAGE_POLICY.maximumStateBytes) {
  const raw=new TextEncoder().encode(JSON.stringify(value));
  if(raw.byteLength>maximum)throw new Error("storage_payload_too_large");
  const blob=await collectBounded(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),maximum);
  return {blob,checksum:await sha256(blob),rawBytes:raw.byteLength};
}
export async function decodeStorage(blob: ArrayBuffer|Uint8Array|number[], checksum:string, maximum:number=STORAGE_POLICY.maximumStateBytes):Promise<unknown> {
  const bytes=blob instanceof Uint8Array?blob:new Uint8Array(blob);
  if(bytes.byteLength>maximum || await sha256(bytes)!==checksum)throw new Error("storage_checksum_mismatch");
  const raw=await collectBounded(new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream("gzip")),maximum);
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));
}
