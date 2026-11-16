import {canonical,encode,sha256} from '../policy.mjs';
import native from './fixtures/filtered-capacity.json' with {type:'json'};
export const approvedHost={gpu:'NVIDIA RTX PRO 6000 Blackwell Server Edition',dataCenterId:'US-NC-2',minRamGb:188,minVcpu:16,diskGb:80,minCudaVersion:'13.0'};
export async function capacityObservationFixture({now=Date.UTC(2026,10,16,13,15,10),hourlyCents=272}={}){
 const stamp=value=>new Date(value).toISOString().slice(0,19).replace('T',' ')+' UTC';
 const observation=structuredClone(native);observation.requestStartedAt=stamp(now-2000);observation.observedAt=stamp(now);
 const host={...approvedHost,hourlyCents,quoteObservedAt:now,quoteExpires:now+900000};
 const intent={createdAt:now,expiresAt:now+300000};
 const capacity={schema:2,kind:'fresh-filtered-runpod-capacity',validUntil:now+898000,observationSha256:'',observation};
 const freeze=async()=>{capacity.observationSha256=await sha256(encode(canonical(observation)));};await freeze();
 return {host,intent,capacity,freeze,core:{now:()=>now}};
}
