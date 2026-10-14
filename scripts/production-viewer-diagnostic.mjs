import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Wrangler emits formatted JSON objects after human-readable startup lines.
// Raw events stay in memory. Never log request headers, bodies or console logs.
export function tailDecoder(consume) {
 let buffer='',start=-1,depth=0,quoted=false,escaped=false;
 return chunk=>{
  for(const char of String(chunk)) {
   if(start<0) {if(char!=='{')continue;start=0;buffer='';}
   buffer+=char;
   if(buffer.length>2_000_000)throw Error('Tail event exceeded the diagnostic limit');
   if(quoted) {if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
   else if(char==='"')quoted=true;
   else if(char==='{')depth++;
   else if(char==='}'&&--depth===0) {const event=JSON.parse(buffer);buffer='';start=-1;consume(event);}
  }
 };
}
export function ownsTailEvent(event,requestId) {
 const request=event?.event?.request??event?.request;
 const headers=request?.headers??{};
 const id=Object.entries(headers).find(([key])=>key.toLowerCase()==='x-righelt-request-id')?.[1];
 return id===requestId;
}
export function exceptionSummary(event,requestId) {
 if(!ownsTailEvent(event,requestId)||!Array.isArray(event.exceptions)||!event.exceptions.length)return null;
 return {outcome:event.outcome,exceptions:event.exceptions.map(error=>({
  name:String(error.name??'Error').slice(0,100),
  message:String(error.message??'').replace(/id-[a-z0-9]+/gi,'[identity]').slice(0,1500),
  stack:String(error.stack??'').replace(/id-[a-z0-9]+/gi,'[identity]').slice(0,4000),
 }))};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Emit only fixed categories and numeric provider codes, never raw CLI output.
export function startupSummary(stderr,exitCode) {
 const codes=[...String(stderr).matchAll(/\[code:\s*(\d{1,8})\]/g)].map(match=>Number(match[1]));
 const category=/permission|not authorized|forbidden/i.test(stderr)?'permission':/authentication|authenticate|invalid.*token/i.test(stderr)?'authentication':/unknown argument|unknown command|invalid argument/i.test(stderr)?'arguments':/fetch failed|ENOTFOUND|ECONN|network/i.test(stderr)?'network':/Cannot find module|command .* not found|MODULE_NOT_FOUND/i.test(stderr)?'installation':/requires.*Node|unsupported.*Node/i.test(stderr)?'runtime':'unclassified';
 const knownCodes=['ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL','ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','ENOENT','ENOTFOUND','ECONNRESET','ERR_REQUIRE_ESM'];
 return {category,providerCodes:[...new Set(codes)],runtimeCodes:knownCodes.filter(code=>String(stderr).includes(code)),exitCode:Number.isInteger(exitCode)?exitCode:null};
}
export function diagnosticTarget(env) {
 const gameId=env.DIAGNOSTIC_GAME_ID;
 if(!/^game-[a-f0-9]{32,64}$/.test(gameId??''))throw Error('Provide one valid diagnostic game ID');
 const origin=new URL(env.RIGHELT_SITE_ORIGIN);
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Invalid diagnostic origin');
 if(!/^[a-z0-9-]+$/.test(env.CLOUDFLARE_PAGES_PROJECT??''))throw Error('Invalid Pages project');
 return {gameId,origin};
}
async function diagnose(env=process.env) {
 const {gameId,origin}=diagnosticTarget(env);
 const databaseUrl=`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/22435cc4-6655-4bdf-a05d-d100cd8e6cc9`;
 const databaseHeaders={Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'};
 const databaseResponse=await fetch(databaseUrl,{headers:databaseHeaders,signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!databaseResponse.ok)throw Error('Database metadata lookup failed');
 const database=await databaseResponse.json();
 console.log(JSON.stringify({phase:'database_capacity',fileSize:Number(database.result?.file_size??0)}));
 const sizeResponse=await fetch(`${databaseUrl}/query`,{method:'POST',headers:databaseHeaders,signal:AbortSignal.timeout(30000),redirect:'error',body:JSON.stringify({sql:'SELECT (SELECT COUNT(*) FROM live_games) AS game_count, (SELECT SUM(LENGTH(state_json)) FROM live_games) AS projection_bytes, (SELECT COUNT(*) FROM live_events) AS event_count, (SELECT SUM(LENGTH(payload_json)) FROM live_events) AS event_bytes, (SELECT COUNT(*) FROM live_command_receipts) AS receipt_count;'})});
 if(!sizeResponse.ok)throw Error('Database aggregate lookup failed');
 const sizes=await sizeResponse.json(),row=sizes.result?.[0]?.results?.[0];
 if(row)console.log(JSON.stringify({phase:'database_aggregates',...Object.fromEntries(['game_count','projection_bytes','event_count','event_bytes','receipt_count'].map(key=>[key,Number(row[key]??0)]))}));
 // Non-interactive Pages tails require an explicit immutable deployment ID.
 const deploymentResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT}/deployments?env=production`,{headers:{Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!deploymentResponse.ok)throw Error('Deployment lookup failed');
 const deployments=await deploymentResponse.json();
 const deployment=deployments.result?.filter(item=>item.environment==='production'&&item.latest_stage?.name==='deploy'&&item.latest_stage?.status==='success').sort((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
 if(!/^[a-f0-9-]{36}$/.test(deployment?.id??''))throw Error('No successful deployment');
 const requestId=randomUUID(),identityId=`diagnostic-${randomUUID()}`;
 const children=[],connected=new Set();let failures=0;
 const header=`X-Righelt-Request-Id:${requestId}`;
 const start=(name,args)=>{
  let stderr='';
  // Wrangler rejects an explicit sampling rate of 1. Its default captures all
  // matching requests, so preserve the header filter without a sampling option.
  const child=spawn('pnpm',['exec','wrangler',...args,'--format','json','--header',header],{stdio:['ignore','pipe','pipe'],env});
  children.push(child);
  const decode=tailDecoder(event=>{if(ownsTailEvent(event,requestId))connected.add(name);const summary=exceptionSummary(event,requestId);if(summary)console.log(JSON.stringify({tail:name,...summary}));});
  child.stdout.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-32000);try{decode(chunk);}catch{failures++;console.log(JSON.stringify({tail:name,phase:'decoder_failed'}));child.kill('SIGTERM');}});
  child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-32000);});
  child.on('error',()=>{failures++;console.log(JSON.stringify({tail:name,phase:'spawn_failed'}));});
  child.on('close',code=>{if(code&&code!==null){failures++;console.log(JSON.stringify({tail:name,phase:'startup_failed',...startupSummary(stderr,code)}));}});
 };
 try {
  start('api',['tail','righelt-api']);
  start('pages',['pages','deployment','tail',deployment.id,'--project-name',env.CLOUDFLARE_PAGES_PROJECT,'--environment','production']);
  // JSON tails emit no readiness banner. Observe our harmless health request
  // in both filtered streams before submitting the viewer-only reproduction.
  for(let attempt=0;attempt<25&&connected.size<2&&!failures;attempt++) {
   try {const response=await fetch(new URL('/api/health',origin),{redirect:'error',signal:AbortSignal.timeout(2000),headers:{'X-Righelt-Request-Id':requestId}});await response.body?.cancel();}catch{}
   await pause(1000);
  }
  if(connected.size!==2||failures)throw Error('Could not connect both diagnostic tails');
  console.log(JSON.stringify({phase:'tails_connected',requestId}));
  const url=new URL(`/api/shell/games/${gameId}/join`,origin);
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','X-Righelt-Request-Id':requestId},body:JSON.stringify({protocolVersion:2,identityId,mode:'viewer'})});
  console.log(JSON.stringify({phase:'viewer_probe',status:response.status}));
  await response.body?.cancel();
  await pause(15000);
 } finally {
  for(const child of children)child.kill('SIGTERM');
  await pause(1000);
  for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)diagnose().catch(()=>{console.error('Production diagnostic could not complete. No raw tail data was emitted.');process.exitCode=1;});
