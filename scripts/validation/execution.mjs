import path from 'node:path';
import {readFile,lstat,readlink} from 'node:fs/promises';
import {command,git,readJSON,saveJSON} from './io.mjs';
import {hash} from './model.mjs';
import {loadSuccessfulEvidence,saveSuccessfulEvidence} from './reuse.mjs';

export async function installationKey(cwd) {
 const names=(await git(['ls-files'],cwd)).split('\n').filter(p=>/(^|\/)(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|\.npmrc|\.pnpmfile.cjs)$/.test(p));
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
 Typecheck:['apps/','packages/','tsconfig'],
 'Generated runtime':['apps/','packages/','scripts/build-web-engine.mjs','scripts/check-web-engine-generated.mjs','apps/web/js/engine/'],
 Unit:[''],
 Integration:[''],
 E2E:['apps/','packages/','db/','e2e/','scripts/','playwright'],
 'Auth E2E':['apps/','packages/','db/','e2e/','scripts/','playwright'],
};
export async function checkInputFingerprint(cwd,name){
 const prefixes=checkPaths[name];if(!prefixes)return null;
 const files=[...new Set((await git(['ls-files','-z'],cwd)+'\0'+await git(['ls-files','--others','--exclude-standard','-z'],cwd)).split('\0').filter(Boolean))].filter(f=>prefixes.some(p=>f.startsWith(p))||/(^|\/)(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|\.npmrc|\.pnpmfile.cjs)$/.test(f));
 const inputs=[];for(const f of files.sort()){try{const p=path.join(cwd,f);inputs.push([f,hash((await lstat(p)).isSymbolicLink()?await readlink(p):await readFile(p))]);}catch(e){if(e.code!=='ENOENT')throw e;inputs.push([f,'deleted']);}}return hash(inputs);
}
export async function checkProvenance(cwd,argv,env,{fingerprint,phase,name}) {
 const packageInfo=await readJSON(path.join(cwd,'node_modules/@playwright/test/package.json'),{});
 const relevant=Object.fromEntries(Object.entries({...process.env,...env}).filter(([k])=>/^(CI|NODE_OPTIONS|RIGHELT_|PLAYWRIGHT_|AUTH_)/.test(k)&&!/(OUTPUT|EVIDENCE|CONTINUITY|TARGET_ROOT|CANDIDATE_ROOT|PERSIST_ROOT)/.test(k)).sort());
 const inputFingerprint=await checkInputFingerprint(cwd,name);
 const compatibility={version:2,inputs:inputFingerprint??fingerprint,argv,environmentHash:hash(relevant),node:process.version,platform:process.platform,arch:process.arch,playwright:packageInfo.version??null,phase,installation:await installationKey(cwd)};
 return {compatibility,version:2,tree:await git(['rev-parse','HEAD^{tree}'],cwd),fingerprint,argv,environmentHash:hash(relevant),node:process.version,platform:process.platform,arch:process.arch,playwright:packageInfo.version??null,phase};
}
export async function executeCheck({cwd,argv,env,name,log,execute=command,cacheDir,provenance,reuse=false}) {
 const compatible=provenance.compatibility??provenance;
 const file=cacheDir&&path.join(cacheDir,hash(compatible)+'.json');
 if(reuse&&file){const prior=await loadSuccessfulEvidence(file,compatible);if(prior)return {...prior,status:'passed',reused:true,reusedProvenance:prior.provenance,provenance,duration:0};}
 const result=await execute(argv,{cwd,env,log,supervised:true,maxOutputBytes:6000,allowFailure:true});
 const record={name,status:result.code===0?'passed':'failed',duration:result.duration,outputBytes:result.outputBytes??0,summaryBytes:Buffer.byteLength(result.output??''),code:result.code??null,signal:result.signal??null,incomplete:result.code===75,provenance,log};
 if(result.code===0&&file)await saveSuccessfulEvidence(file,{provenance:compatible,result:record,artifacts:[log],expiresAt:new Date(Date.now()+86400000).toISOString()});
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
