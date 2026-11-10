import path from 'node:path';
import {readFile,lstat,readlink,mkdir,realpath,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {command,git,readJSON,saveJSON} from './io.mjs';
import {hash} from './model.mjs';
import {inspectSuccessfulEvidence,saveSuccessfulEvidence,fileDigest} from './reuse.mjs';

const executorRoot=fileURLToPath(new URL('../../',import.meta.url));
export async function evidenceCache(cwd){
 const common=await git(['rev-parse','--git-common-dir'],cwd);
 return path.resolve(cwd,common,'righelt-validation-evidence');
}
async function privateCache(dir){
 await mkdir(dir,{recursive:true,mode:0o700});
 const info=await lstat(dir);
 if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)||info.uid!==process.getuid?.())throw Error('Evidence cache must be an owner-private real directory');
 return realpath(dir);
}

export async function installationKey(cwd) {
 const names=(await git(['ls-files'],cwd)).split('\n').filter(p=>(/(^|\/)(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|\.npmrc|\.pnpmfile.cjs)$/.test(p)||p.startsWith('patches/')));
 const inputs=await Promise.all(names.map(async p=>[p,await readFile(path.join(cwd,p),'utf8')]));
 return hash({inputs,node:process.version,pnpm:(await command(['pnpm','--version'],{cwd})).output,platform:process.platform,arch:process.arch});
}
export async function ensureInstallation(cwd,{execute=command,log}={}) {
 const key=await installationKey(cwd),file=path.join(cwd,'node_modules','.righelt-validation-install.json');
 const installed=await readJSON(file,null);
 const lock=path.join(cwd,'node_modules/.pnpm/lock.yaml');
 let installedLockHash;try{installedLockHash=hash(await readFile(lock));}catch{}
 if(installed?.key===key&&installedLockHash&&installed.installedLockHash===installedLockHash)return {status:'reused',key};
 await execute(['pnpm','install','--frozen-lockfile','--ignore-scripts'],{cwd,log,supervised:true,maxOutputBytes:log?4000:undefined});
 await saveJSON(file,{key,installedLockHash:hash(await readFile(lock)),at:new Date().toISOString()});return {status:'passed',key};
}
const checkPaths={
 Typecheck:['apps/','packages/','tsconfig','scripts/'],
 'Generated runtime':['apps/','packages/','scripts/build-web-engine.mjs','scripts/check-web-engine-generated.mjs','apps/web/js/engine/','tsconfig','scripts/'],
 Unit:[''],
 Integration:[''],
 E2E:['apps/','packages/','db/','e2e/','scripts/','playwright','browser-integration/','validation-','tsconfig','patches/'],
 'Auth E2E':['apps/','packages/','db/','e2e/','scripts/','playwright','browser-integration/','validation-','tsconfig','patches/'],
 'Boundary E2E':['apps/','packages/','db/','e2e/','scripts/','playwright','browser-integration/','validation-','tsconfig','patches/'],
 'Browser integration':['apps/','packages/','browser-integration/','scripts/','playwright'],
 'Validation executor':['scripts/validation/','scripts/resources/','scripts/testing/','playwright.validation','validation-e2e/','validation-account-e2e/'],
};
export async function checkInputFingerprint(cwd,name){
 const prefixes=checkPaths[name];if(!prefixes)return null;
 const files=[...new Set((await git(['ls-files','-z'],cwd)+'\0'+await git(['ls-files','--others','--exclude-standard','-z'],cwd)).split('\0').filter(Boolean))].filter(f=>prefixes.some(p=>f.startsWith(p))||/(^|\/)(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|\.npmrc|\.pnpmfile.cjs)$/.test(f));
 const inputs=[];for(const f of files.sort()){try{const p=path.join(cwd,f);inputs.push([f,hash((await lstat(p)).isSymbolicLink()?await readlink(p):await readFile(p))]);}catch(e){if(e.code!=='ENOENT')throw e;inputs.push([f,'deleted']);}}return hash(inputs);
}
export async function checkProvenance(cwd,argv,env,{fingerprint,phase,name}) {
 const packageInfo=await readJSON(path.join(cwd,'node_modules/@playwright/test/package.json'),{});
 const relevant=Object.fromEntries(Object.entries({...process.env,...env}).filter(([k])=>/^(CI|NODE_OPTIONS|NODE_ENV|TZ$|LANG$|LC_|RIGHELT_|PLAYWRIGHT_|AUTH_)/.test(k)&&!['RIGHELT_EVIDENCE_DIR','RIGHELT_EVIDENCE_JSON','RIGHELT_VALIDATION_TARGET_ROOT','RIGHELT_ACCOUNT_CANDIDATE_ROOT','RIGHELT_ACCOUNT_PERSIST_ROOT','RIGHELT_E2E_PERSIST_ROOT','RIGHELT_CONTINUITY_FILE','RIGHELT_CONTINUITY_INPUT','RIGHELT_ACCOUNT_CONTINUITY_INPUT','RIGHELT_LEGACY_CONTINUITY_INPUT','PLAYWRIGHT_OUTPUT_DIR'].includes(k)).sort());
 const inputFingerprint=await checkInputFingerprint(cwd,name);
 // Conservatively bind all validation executor code. Report prose and unrelated candidate docs do not change execution.
 const executor=await checkInputFingerprint(executorRoot,'Validation executor');
 const browser=await readJSON(path.join(executorRoot,'node_modules/playwright-core/browsers.json'),null);
 const installed=await readFile(path.join(cwd,'node_modules/.pnpm/lock.yaml')).catch(()=>null);
 const compatibility={version:3,inputs:inputFingerprint??fingerprint,executor,argv,environmentHash:hash(relevant),node:process.version,platform:process.platform,arch:process.arch,playwright:packageInfo.version??null,browsers:browser,phase,executorInstallation:await installationKey(executorRoot),installation:await installationKey(cwd),installedLock:installed?hash(installed):null};
 return {compatibility,version:2,tree:await git(['rev-parse','HEAD^{tree}'],cwd),fingerprint,argv,environmentHash:hash(relevant),node:process.version,platform:process.platform,arch:process.arch,playwright:packageInfo.version??null,phase};
}
export async function checkReuse({cacheDir,provenance}){
 if(!cacheDir)return {reason:'cache-not-selected'};
 return inspectSuccessfulEvidence(path.join(cacheDir,hash(provenance.compatibility??provenance)+'.json'),provenance.compatibility??provenance);
}
export async function executeCheck({cwd,argv,env,name,log,execute=command,cacheDir,provenance,reuse=false,immutable=false,deferEvidence}) {
 const compatible=provenance.compatibility??provenance;
 const file=cacheDir&&path.join(cacheDir,hash(compatible)+'.json');
 let decision={reason:'execution-required'};
 if(reuse&&file){decision=await checkReuse({cacheDir,provenance});if(decision.result)return {...decision.result,status:'passed',reused:true,reusedProvenance:decision.result.provenance,provenance,duration:0,reuseReason:decision.reason};}
 const result=await execute(argv,{cwd,env,log,supervised:true,maxOutputBytes:6000,allowFailure:true});
 const record={name,status:result.code===0&&!result.signal?'passed':'failed',duration:result.duration,outputBytes:result.outputBytes??0,summaryBytes:Buffer.byteLength(result.output??''),code:result.code??null,signal:result.signal??null,incomplete:result.code===75,provenance,log,reuseReason:decision.reason};
 if(record.status==='passed'&&file&&(!immutable||reuse)){
  let artifact=log;
  if(immutable){const root=await privateCache(cacheDir),digest=await fileDigest(log);artifact=path.join(root,digest+'.log');await copyFile(log,artifact);}
  const publish=()=>saveSuccessfulEvidence(file,{provenance:compatible,result:{...record,log:artifact,originalLog:log},artifacts:[artifact],immutable,expiresAt:new Date(Date.now()+86400000).toISOString()});
  if(deferEvidence)deferEvidence(publish);else await publish();
 }
 return record;
}
export async function createAuthLane(cwd,dir,{execute=command}={}) {
 const head=await git(['rev-parse','HEAD'],cwd),lane=path.join(dir,'account-candidate');
 const existing=await readJSON(path.join(dir,'account-lane.json'),null);
 if(existing&&existing.head!==head)throw Error('Account lane revision changed; use a new attempt directory');
 if(!existing){await execute(['git','worktree','add','--detach',lane,head],{cwd});await saveJSON(path.join(dir,'account-lane.json'),{head,lane});}
 if(await git(['rev-parse','HEAD'],lane)!==head||await git(['status','--porcelain'],lane))throw Error('Account lane is not the clean requested candidate');
 await ensureInstallation(lane,{execute,log:path.join(dir,'account-install.log')});
 return lane;
}
