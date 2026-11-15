// Reviewed operator startup override, passed as argv. No new file is copied into
// the frozen image. Only existing runtime modules are imported after admission.
export const manualStartupSource=`
import {Client} from './tools/hosted-compute/client.mjs';
const client=new Client({url:process.env.COMPUTE_URL,id:process.env.COMPUTE_ID,token:process.env.COMPUTE_WORKER_TOKEN,generation:Number(process.env.COMPUTE_GENERATION)});
const limit=Number(process.env.COMPUTE_MANUAL_READY_UNTIL);
if(!Number.isSafeInteger(limit)||Date.now()>=limit||limit-Date.now()>300000)throw Error('Manual startup window unavailable');
let ready=false;
while(Date.now()<limit){
  try{const answer=await client.json('manual-ready');if(answer.ready===true&&Date.now()<answer.until){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Math.max(0,limit-Date.now()))));
}
if(!ready)throw Error('Manual startup window expired');
const {runWorker}=await import('./tools/hosted-compute/worker.mjs');
await runWorker();
`;
export const manualStartupArgv=()=>['node','--input-type=module','-e',manualStartupSource];
