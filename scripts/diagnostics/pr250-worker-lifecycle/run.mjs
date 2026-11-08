import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {compareApiEvents} from './canonical-api-events.mjs';
import {auditLifecycle} from './lifecycle-audit.mjs';
import {requireDirectIdentity,signalDirectChild,captureInitialChildIdentity} from './direct-child-identity.mjs';
const source='e4979ad6e9d57e69753b0fe0788b636882e6c368',toolsPin='0c7b51b64c26604f1e08939e827cb4a934aa4f93';
const runner=path.dirname(fileURLToPath(import.meta.url));
const candidate=path.resolve(process.env.RIGHELT_DIAGNOSTIC_CANDIDATE??''),tools=path.resolve(process.env.RIGHELT_DIAGNOSTIC_TOOLS??'');
const out=path.resolve(process.env.RIGHELT_DIAGNOSTIC_OUT??''),grantFile=process.env.RIGHELT_DIAGNOSTIC_GRANT;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const command=(args,cwd=candidate)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}).trim();
function assert(value,message){if(!value)throw Error(message);}
assert(process.platform==='linux'&&process.version==='v22.23.4','Exact qualified Linux Node required');
assert(candidate!==tools&&out!==candidate&&grantFile,'Separate candidate/tools/output and actual grant required');
assert(command(['rev-parse','HEAD'])===source&&command(['status','--porcelain'])==='','Exact clean product source required');
assert(command(['rev-parse','HEAD'],tools)===toolsPin&&command(['status','--porcelain'],tools)==='','Released tools pin required');
assert(json(path.join(candidate,'node_modules/@playwright/test/package.json')).version==='1.59.1','Original Playwright required');
assert(execFileSync('pnpm',['--version'],{cwd:candidate,encoding:'utf8',timeout:5000}).trim()==='9.15.9','Qualified pnpm required');
const grant=json(grantFile),freeze=json(path.join(runner,'source-freeze.json'));
assert(grant.execute===true&&grant.diagnosticOnly===true&&grant.fullOriginalWK1Shard===true,'No actual diagnostic execution grant');
assert(grant.sourceFreezeSHA256===hash(fs.readFileSync(path.join(runner,'source-freeze.json'))),'Grant/freeze mismatch');
for(const [relative,digest]of Object.entries(freeze.files))assert(hash(fs.readFileSync(path.resolve(runner,relative)))===digest,'Diagnostic source changed: '+relative);
assert(!fs.existsSync(out),'Never overwrite or reuse a diagnostic output');fs.mkdirSync(out,{recursive:true,mode:0o700});
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
function sealProduct(){
 const files=execFileSync('git',['ls-files','-z'],{cwd:candidate,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}).split('\0').filter(Boolean);
 return Object.fromEntries(files.map(file=>{const full=path.join(candidate,file),stat=fs.lstatSync(full);return[file,{mode:stat.mode&0o777,symlink:stat.isSymbolicLink(),sha256:hash(stat.isSymbolicLink()?fs.readlinkSync(full):fs.readFileSync(full))}];}));
}
const before=sealProduct();write('source-before.json',{head:source,tree:command(['rev-parse','HEAD^{tree}']),files:before});
const playwright=await import(pathToFileURL(path.join(candidate,'node_modules/playwright/index.mjs')).href);
const browserPath=playwright.webkit.executablePath();
const sourceLock=fs.readFileSync(path.join(candidate,'pnpm-lock.yaml')),installedLock=fs.readFileSync(path.join(candidate,'node_modules/.pnpm/lock.yaml'));
const receiptDigest=bytes=>hash(JSON.stringify(bytes));
assert(receiptDigest(sourceLock)==='341b60501f75b87b0e84d393c0a09828e9a0ca6e964acdd9fc959352920d5436'&&receiptDigest(installedLock)==='c915e9421b37eb675521395a7eef58fd3faeb8fe8ff754d79bffe7daa7c5f1ed','Exact historical dependency receipt contract required');
write('runtime.json',{node:process.version,pnpm:'9.15.9',playwright:'1.59.1',platform:process.platform,arch:process.arch,
 sourceLock:{rawByteSHA256:hash(sourceLock),receiptStandardBufferJSONSHA256:receiptDigest(sourceLock)},installedLock:{rawByteSHA256:hash(installedLock),receiptStandardBufferJSONSHA256:receiptDigest(installedLock)},
 browserPath,browserLauncherSHA256:hash(fs.readFileSync(browserPath)),browsers:json(path.join(candidate,'node_modules/playwright-core/browsers.json'))});
const registry=path.join(out,'resources'),events=path.join(out,'worker-lifecycle');fs.mkdirSync(registry,{mode:0o700});
function knownListeners(){
 const ports=new Set();for(const file of['/proc/net/tcp','/proc/net/tcp6']){
  const lines=fs.readFileSync(file,'utf8').trim().split('\n').slice(1);
  for(const line of lines){const fields=line.trim().split(/\s+/);assert(fields.length>=10,'Malformed native TCP table');if(fields[3]==='0A')ports.add(parseInt(fields[1].split(':')[1],16));}
 }
 return[9887,9888,10188].filter(port=>ports.has(port));
}
assert(knownListeners().length===0,'Original guest ports must be free before launch');
const inheritedNodeOptions=process.env.NODE_OPTIONS,observerOption=`--import=${pathToFileURL(path.join(runner,'register.mjs')).href}`;
const nodeOptions=inheritedNodeOptions?`${inheritedNodeOptions} ${observerOption}`:observerOption;
write('launch.json',{grantFile,grantSHA256:hash(fs.readFileSync(grantFile)),candidate,tools,registry,source,node:process.version,pnpm:'9.15.9',playwright:'1.59.1',purpose:'Full original WK1 shard, passive diagnostic only',nodeOptions:{inheritedPresent:Object.hasOwn(process.env,'NODE_OPTIONS'),inherited:inheritedNodeOptions??null,effective:nodeOptions,historicalOriginalValue:'unavailable in sealed original job log and all178 primary members, not proved empty'}});
const env={...process.env,SUITE:'e2e',PROJECT:'webkit',SHARD:'1',SHARDS:'2',RIGHELT_RESOURCE_REGISTRY:registry,
 RIGHELT_DIAGNOSTIC_CANDIDATE:candidate,RIGHELT_DIAGNOSTIC_OUT:events,
 RIGHELT_E2E_PERSIST_ROOT:path.join(out,'owned-fixture'),PWTEST_CACHE_DIR:path.join(out,'pw-cache'),
 NODE_OPTIONS:nodeOptions};
const argv=[path.join(tools,'scripts/resources/cli.mjs'),'run','--kind','heavy','--timeout-ms','3540000','--',process.execPath,path.join(candidate,'scripts/testing/ci-run.mjs')];
write('native-argv.json',{executable:process.execPath,argv,lane:{suite:'e2e',project:'webkit',shard:1,shards:2},originalConfig:'playwright.config.mjs',originalWrapper:'scripts/playwright-e2e.mjs'});
const log=fs.openSync(path.join(out,'original.log'),'ax',0o600),osLog=fs.openSync(path.join(out,'owned-linux-processes.jsonl'),'ax',0o600);
const observed=new Map(),errors=[];let samples=0,configCaptured=false,child,directIdentity;
const loop=monitorEventLoopDelay({resolution:20});loop.enable();
function stat(pid){
 const raw=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),end=raw.lastIndexOf(')'),fields=raw.slice(end+2).trim().split(/\s+/);
 assert(raw.startsWith(`${pid} (`)&&end>0&&fields.length>=20&&[fields[1],fields[2],fields[19]].every(value=>/^\d+$/.test(value)),'Malformed native process identity');
 return{pid:Number(pid),ppid:Number(fields[1]),pgid:Number(fields[2]),startTicks:fields[19],state:fields[0],raw};
}
function sample(){
 try{
  if(++samples>1800)throw Error('OS sample cap reached');
  const table=new Map();for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{table.set(Number(pid),stat(pid));}catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}}
  const root=table.get(child.pid);
  if(!root){fs.writeSync(osLog,JSON.stringify({nodeNow:performance.now(),directChildAbsent:true,savedIdentity:directIdentity})+'\n');return;}
  requireDirectIdentity(directIdentity,()=>root);
  const selected=new Set([directIdentity.pid]);let changed=true;
  while(changed){const count=selected.size;for(const row of table.values())if(selected.has(row.ppid))selected.add(row.pid);changed=count!==selected.size;}
  assert(selected.size<=256,'Owned process cap exceeded');const processes=[];
  for(const pid of selected){const row=table.get(pid);if(!row)continue;observed.set(`${pid}:${row.startTicks}`,{pid,startTicks:row.startTicks});
   try{
    const status=fs.readFileSync(`/proc/${pid}/status`,'utf8'),tasks=fs.readdirSync(`/proc/${pid}/task`);assert(tasks.length<=2048,'Thread cap exceeded');
    const commandLine=fs.readFileSync(`/proc/${pid}/cmdline`),args=commandLine.toString().split('\0').filter(Boolean),configs=[];
    for(let i=0;i<args.length;i++){if(['--config','-c'].includes(args[i])&&args[i+1])configs.push(args[i+1]);else if(args[i].startsWith('--config='))configs.push(args[i].slice(9));}
    processes.push({...row,status,threads:tasks,executable:fs.readlinkSync(`/proc/${pid}/exe`),cwd:fs.readlinkSync(`/proc/${pid}/cwd`),commandSHA256:hash(commandLine),configPaths:configs});
   }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')processes.push({...row,exitedDuringRead:true});else throw error;}
  }
  fs.writeSync(osLog,JSON.stringify({at:new Date().toISOString(),nodeNow:performance.now(),processes,meminfo:fs.readFileSync('/proc/meminfo','utf8'),pressure:fs.existsSync('/proc/pressure/memory')?fs.readFileSync('/proc/pressure/memory','utf8'):null,nodeObserverLoop:{meanNs:loop.mean,maxNs:loop.max}})+'\n');
 }catch(error){errors.push({phase:'os-observer',message:error.message});}
}
function captureConfigs(){
 if(configCaptured)return;configCaptured=true;
 try{
  const entries=[['api',path.join(out,'owned-fixture/storage-api.toml')],['web',path.join(candidate,'apps/web/wrangler.toml')]];
  fs.mkdirSync(path.join(out,'live-config'),{mode:0o700});
  write('live-config.json',entries.map(([role,file])=>{const body=fs.readFileSync(file),copy=path.join(out,'live-config',role+'.toml');fs.writeFileSync(copy,body,{mode:0o600});return{role,source:file,copy,sha256:hash(body),capturedAt:new Date().toISOString()};}));sample();
 }catch(error){errors.push({phase:'live-config',message:error.message});}
}
let timer,result,exited;
const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned child deadline')),ms);})]).finally(()=>clearTimeout(timer));};
try{
 child=spawn(process.execPath,argv,{cwd:candidate,env,stdio:['ignore','pipe','pipe']});
 exited=new Promise(resolve=>{child.once('close',(code,signal)=>resolve({code,signal}));});
 child.once('error',error=>errors.push({phase:'direct-child-native-error',message:error.message,stack:error.stack}));
 directIdentity=await captureInitialChildIdentity(child,exited,pid=>{
  write('direct-creation.json',{pid:pid??null,executable:process.execPath,argv,createdAt:new Date().toISOString()});return stat(pid);
 },(cleanup,primary)=>{
  result=cleanup.result;write('initial-identity-cleanup.json',{primary:{name:primary.name,message:primary.message,stack:primary.stack},cleanup});
 });write('direct-child.json',{pid:child.pid,identity:directIdentity});sample();timer=setInterval(sample,2000);
 let tail='';for(const stream of[child.stdout,child.stderr])stream.on('data',data=>{fs.writeSync(log,data);process.stdout.write(data);tail=(tail+data).slice(-4096);if(tail.includes('[e2e-stack] ready at '))captureConfigs();});
 result=await bounded(exited,3550000);
}catch(error){errors.push({phase:'launch',message:error.message,stack:error.stack,causes:error instanceof AggregateError?error.errors.map(value=>({name:value.name,message:value.message,stack:value.stack})):undefined});}
finally{
 if(child&&child.exitCode===null&&child.signalCode===null){
  errors.push({phase:'direct-child-stop',message:'Original guardian did not finish normally'});
  try{signalDirectChild(child,directIdentity,'SIGTERM',stat);result=await bounded(exited,10000);}catch(error){errors.push({phase:'direct-child-term',message:error.message});try{signalDirectChild(child,directIdentity,'SIGKILL',stat);result=await bounded(exited,3000);}catch(error){errors.push({phase:'direct-child-kill-reap',message:error.message});child.stdout?.destroy();child.stderr?.destroy();child.unref();}}
 }
 clearInterval(timer);loop.disable();fs.closeSync(log);fs.closeSync(osLog);
}
// The original guardian owns bounded stop/reap. No retry or separate browser is
// launched for missing evidence. All audits run independently after case failure.
const attempt=(phase,fn)=>{try{return fn();}catch(error){errors.push({phase,message:error.message});return null;}};
if(!configCaptured)errors.push({phase:'live-config',message:'Original stack readiness/config snapshot unavailable'});
attempt('source-after',()=>{const after=sealProduct();write('source-after.json',{head:command(['rev-parse','HEAD']),tree:command(['rev-parse','HEAD^{tree}']),files:after});assert(JSON.stringify(before)===JSON.stringify(after)&&command(['status','--porcelain'])==='','Product source changed');});
attempt('preserve-originals',()=>{
 for(const relative of['test-results/suites','test-results/e2e-stack-diagnostics']){const full=path.join(candidate,relative);assert(fs.existsSync(full),'Missing original '+relative);fs.cpSync(full,path.join(out,path.basename(relative)),{recursive:true});}
 const receiptsRoot=path.join(candidate,'test-results/e2e-stack-diagnostics');
 for(const folder of fs.readdirSync(receiptsRoot)){const raw=path.join(os.tmpdir(),folder);assert(fs.existsSync(raw),'Original raw directory missing');fs.cpSync(raw,path.join(out,'private-raw',folder),{recursive:true});}
});
let receipts=[],apiRaw='';
attempt('read-original-receipts',()=>{
 const root=path.join(out,'e2e-stack-diagnostics');
 for(const folder of fs.readdirSync(root))for(const file of fs.readdirSync(path.join(root,folder)).filter(file=>file.endsWith('.json')))receipts.push({...json(path.join(root,folder,file)),originalFolder:folder});
 write('original-service-receipts.json',receipts);assert(receipts.length===2&&new Set(receipts.map(row=>row.service)).size===2,'Exact API/web receipts required');
});
let summarize;
try{({summarizeWranglerLog:summarize}=await import(pathToFileURL(path.join(tools,'scripts/auth-stack-diagnostics.mjs')).href));}
catch(error){errors.push({phase:'raw-summary-module',message:error.message});}
for(const receipt of receipts)attempt('raw-summary-'+receipt.service,()=>{
 const directory=path.join(out,'private-raw',receipt.originalFolder,receipt.service==='api'?'api-1':'web-2');
 const files=fs.readdirSync(directory).filter(file=>/^wrangler-[\d_-]+\.log$/.test(file)).sort();assert(files.length>0,'No actual raw logs');
 const raw=files.map(file=>fs.readFileSync(path.join(directory,file),'utf8'));
 if(receipt.service==='api')apiRaw+=raw.join('\n');
 assert(typeof summarize==='function','Released raw summarizer unavailable');
 const actual=raw.map(summarize);write('raw-summary-'+receipt.service+'.json',{actual,emitted:receipt.logs});
 assert(JSON.stringify(actual)===JSON.stringify(receipt.logs),'Actual raw/receipt mismatch');
});
// Canonical API evidence is preserved even when web strict flags are genuinely
// non-clear. A strict failure must not short-circuit this independent audit.
const canonical=attempt('canonical-api',()=>{
 const proof=compareApiEvents(apiRaw,fs.readFileSync(path.join(out,'original.log'),'utf8'));
 assert(proof.count>0,'Empty API evidence');const value={complete:true,count:proof.count,exactObjectsEqual:true,sha256:hash(JSON.stringify(proof.events))};write('canonical-api.json',value);return value;
});
if(!canonical)write('canonical-api.json',{complete:false,errors:errors.filter(row=>row.phase==='canonical-api')});
attempt('strict-service-status',()=>{
 const flags=['proxyControllerError','networkConnectionLost','connectionRefused','connectionReset','certificateUnknown','proxyReceiptFailed','malformedRequiredReceipt'];
 assert(receipts.length===2,'Both original services required');
 for(const receipt of receipts)assert(receipt.expected===true&&receipt.code===130&&receipt.logs.length>0&&receipt.logs.every(log=>log.bytes>0&&flags.every(flag=>log[flag]===false)),'Strict original service flags remain failed');
});
attempt('lifecycle-evidence',()=>{
 let observations=null;const directory=path.join(out,'suites');
 try{
  const paths=fs.readdirSync(directory).map(folder=>path.join(directory,folder,'observations.json')).filter(file=>fs.existsSync(file));assert(paths.length===1,'Exact original shard observations required');observations=json(paths[0]);
 }catch(error){errors.push({phase:'original-observation-input',message:error.message});}
 const audit=auditLifecycle(events,observations);write('lifecycle-audit.json',audit);assert(audit.complete,'Lifecycle evidence incomplete');
});
attempt('owned-process-absence',()=>{
 const surviving=[];for(const identity of observed.values()){try{if(stat(identity.pid).startTicks===identity.startTicks)surviving.push(identity);}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}}
 const resources=fs.readdirSync(registry).filter(f=>f.endsWith('.json')).map(f=>json(path.join(registry,f))),listening=knownListeners();write('owned-process-cleanup.json',{observed:[...observed.values()],surviving,resources,knownListeningPorts:listening});
 assert(resources.length>0&&resources.every(r=>r.status==='finished'&&r.cleanup==='verified')&&!surviving.length&&!listening.length,'Owned cleanup incomplete');
});
write('completion.json',{result,errors,configCaptured,samples,diagnosticOnly:true,noOfficialCICredit:true,noRetry:true});
const files={};function inventory(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())inventory(file);else if(entry.isFile()){fs.chmodSync(file,0o600);files[path.relative(out,file)]={bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))};}}}inventory(out);write('artifact-inventory.json',files);
if(!result||result.code!==0||errors.length)process.exitCode=1;
