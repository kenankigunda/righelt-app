// Controller-only admission evidence. Catalog availability is not a reservation
// or a guarantee that all create constraints fit one physical machine.
import {assert,canonical,encode,sha256} from './policy.mjs';
const shape=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
const nonNone=value=>['LOW','MEDIUM','HIGH'].includes(value);
const cuda=value=>typeof value==='string'&&/^\d+\.\d+$/.test(value)?value.split('.').map(Number):null;
const atLeast=(value,floor)=>{const v=cuda(value),f=cuda(floor);return v&&f&&(v[0]>f[0]||v[0]===f[0]&&v[1]>=f[1]);};
function timestamp(value){
 // The operator packet retains the MCP observation's UTC spelling.
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(value))return NaN;
 return Date.parse(value.replace(' ','T').replace(' UTC','Z'));
}
export async function validateCapacityAvailability(core,host,intent,capacity){
 assert(shape(capacity,'schema,kind,validUntil,observationSha256,observation')&&capacity.schema===2&&capacity.kind==='fresh-filtered-runpod-capacity','typed fresh filtered capacity evidence required');
 const observation=capacity.observation;
 assert(shape(observation,'schema,kind,requestStartedAt,observedAt,query,response,notReservation,noProviderCreate')&&observation.schema===1&&observation.kind==='runpod-filtered-gpu-type-observation'&&observation.notReservation===true&&observation.noProviderCreate===true,'single catalog query/response observation required');
 assert(/^[a-f0-9]{64}$/.test(capacity.observationSha256)&&await sha256(encode(canonical(observation)))===capacity.observationSha256,'catalog observation hash differs');
 const startedAt=timestamp(observation.requestStartedAt),observedAt=timestamp(observation.observedAt);
 assert(Number.isSafeInteger(startedAt)&&Number.isSafeInteger(observedAt)&&startedAt<=observedAt&&observedAt<=intent.createdAt&&intent.createdAt-startedAt<=900000&&Number.isSafeInteger(capacity.validUntil)&&capacity.validUntil>=intent.expiresAt&&capacity.validUntil<=startedAt+900000&&core.now()<capacity.validUntil,'fresh catalog observation through intent expiry required');
 const q=observation.query,r=observation.response;
 assert(shape(q,'id,cloud,count,countryCodes,minCudaVersion,product,include')&&q.id==='NVIDIA RTX PRO 6000 Blackwell Server Edition'&&q.id===host.gpu&&q.cloud==='SECURE'&&q.count===1&&canonical(q.countryCodes)===canonical(['US'])&&canonical(q.product)===canonical(['POD'])&&canonical(q.include)===canonical(['AVAILABILITY'])&&atLeast(q.minCudaVersion,'13.0'),'catalog availability filters differ');
 assert(host.dataCenterId==='US-NC-2'&&host.minRamGb===188&&host.minVcpu===16&&host.diskGb===80&&host.minCudaVersion==='13.0','approved recovery create floors differ');
 assert(r&&r.id===q.id&&r.manufacturer==='NVIDIA'&&r.memory===96&&r.secure===true&&nonNone(r.availability)&&Number.isSafeInteger(r.minRam)&&r.minRam>=188&&Number.isSafeInteger(r.minVcpuCount)&&r.minVcpuCount>=16&&Number.isSafeInteger(r.maxCount?.secure)&&r.maxCount.secure>=1,'filtered GPU availability or minimum resources differ');
 assert(Array.isArray(r.dataCenters)&&r.dataCenters.filter(dc=>dc.id===host.dataCenterId).length===1&&r.dataCenters.some(dc=>dc.id===host.dataCenterId&&nonNone(dc.availability)),'filtered approved datacenter unavailable');
 assert(Array.isArray(r.cudaVersions)&&r.cudaVersions.every(v=>typeof v.available==='boolean'&&atLeast(v.version,q.minCudaVersion))&&r.cudaVersions.some(v=>v.available===true),'filtered compatible CUDA unavailable');
 const base=r.price?.secure;
 assert(Number.isFinite(base)&&base>0&&Number.isSafeInteger(host.hourlyCents)&&host.hourlyCents>=Math.ceil(base*100)&&host.hourlyCents<=272&&host.quoteObservedAt>=startedAt&&host.quoteObservedAt<=intent.createdAt&&host.quoteExpires>=intent.expiresAt,'fresh bounded all-in quote required');
}
