// Reviewed operator startup override, passed as argv. No new file is copied into
// the frozen image. Only existing runtime modules are imported after admission.
import {MANUAL_INTENT_MS,MANUAL_STARTUP_MS} from './manual-authority.mjs';
export function manualStartupSettings(intent){return intent.startup?{until:intent.startup.deadline,protocol:intent.startup.kind}:{until:Math.min(intent.createdAt+MANUAL_INTENT_MS,intent.expiresAt)};}
export const manualStartupSource=`
import {Client} from './tools/hosted-compute/client.mjs';
import {randomBytes} from 'node:crypto';
const requested=Number(process.env.COMPUTE_MANUAL_READY_UNTIL);
const protocol=process.env.COMPUTE_MANUAL_READY_PROTOCOL;
const cold=protocol==='confirmed-pod-startup';
if(protocol&&!cold)throw Error('Manual startup protocol unavailable');
if(!Number.isSafeInteger(requested)||Date.now()>=requested||!cold&&requested-Date.now()>${MANUAL_INTENT_MS})throw Error('Manual startup window unavailable');
const limit=Math.min(requested,Date.now()+${MANUAL_STARTUP_MS});
const claim=cold?{podId:process.env.RUNPOD_POD_ID,intentSha256:process.env.COMPUTE_MANUAL_INTENT_SHA256,sessionId:randomBytes(16).toString('hex')}:undefined;
if(cold&&(!/^[A-Za-z0-9_-]+$/.test(claim.podId??'')||!/^[a-f0-9]{64}$/.test(claim.intentSha256??'')))throw Error('Manual startup identity unavailable');
const client=new Client({url:process.env.COMPUTE_URL,id:process.env.COMPUTE_ID,token:process.env.COMPUTE_WORKER_TOKEN,generation:Number(process.env.COMPUTE_GENERATION),fetcher:(url,options)=>fetch(url,{...options,headers:{...options.headers,...(cold?{'x-compute-startup-session':claim.sessionId}:{})}})});
if(cold)Object.defineProperty(client,'startupSessionId',{value:claim.sessionId});
let ready=false;
while(Date.now()<limit){
  try{const answer=await client.json('manual-ready',claim);if(!Number.isSafeInteger(answer.until)||Date.now()>=Math.min(limit,answer.until))break;if(answer.ready===true){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Math.max(0,limit-Date.now()))));
}
if(!ready)throw Error('Manual startup window expired');
const {runWorker}=await import('./tools/hosted-compute/worker.mjs');
await runWorker({client});
`;
export const manualStartupArgv=()=>['node','--input-type=module','-e',manualStartupSource];
