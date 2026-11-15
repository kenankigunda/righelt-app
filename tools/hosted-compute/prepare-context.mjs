import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assert } from './policy.mjs';
import { hashBytes,hashRecord,isRuntimeSourcePath,isProofSourcePath,LOCK_PATHS,validateBuildConfig,verifyImageIdentity } from './image-identity.mjs';

export async function prepareContext({root=process.cwd(),out,buildConfig}={}) {
  validateBuildConfig(buildConfig);
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
  assert(git('status','--porcelain','--untracked-files=all')==='','commit source before preparing a public image');
  root=await fs.realpath(git('rev-parse','--show-toplevel'));
  assert(typeof out==='string' && out.length>0,'new build context directory required');
  const requested=path.resolve(out);
  // macOS /var aliases /private/var, and a parent may itself be a symlink.
  // Compare canonical existing parents before creating the new destination.
  const sourceRevision=git('rev-parse','HEAD'),destination=path.join(await fs.realpath(path.dirname(requested)),path.basename(requested));
  assert(destination!==root && !destination.startsWith(root+path.sep),'build context must be a new directory outside the checkout');
  // Export only selected committed blobs. No clone, history, local run, model,
  // production export or credential is copied.
  const entries=git('ls-tree','-r',sourceRevision).split('\n').filter(Boolean).map(line=>{
    const match=/^(\d+) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    assert(match,'unsupported committed tree entry');return {mode:match[1],name:match[3]};
  });
  const sourceInventory={},proofInventory={},bytesByName=new Map();
  for(const {mode,name} of entries.filter(({name})=>isProofSourcePath(name))) {
    assert(mode==='100644' || mode==='100755','public image source cannot be a symlink');
    const bytes=execFileSync('git',['-C',root,'show',`${sourceRevision}:${name}`],{maxBuffer:16*1024*1024});
    proofInventory[name]=hashBytes(bytes);
    if(isRuntimeSourcePath(name)) {sourceInventory[name]=proofInventory[name];bytesByName.set(name,bytes);}
  }
  for(const name of [...LOCK_PATHS,'package.json','pnpm-workspace.yaml','tools/hosted-compute/image-identity.mjs','tools/hosted-compute/worker.mjs']) assert(bytesByName.has(name),`required build source missing: ${name}`);
  const locks=Object.fromEntries(LOCK_PATHS.map(name=>[name,sourceInventory[name]]));
  const identity={schema:2,sourceRevision,dependencySha256:hashRecord(locks),locks,
    sourceInventory,sourceInventorySha256:hashRecord(sourceInventory),proofInventory,proofInventorySha256:hashRecord(proofInventory),buildConfig,buildConfigSha256:hashRecord(buildConfig)};
  await fs.mkdir(destination,{recursive:false,mode:0o700});
  for(const [name,bytes] of bytesByName) {
    await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});
    await fs.writeFile(path.join(destination,name),bytes,{flag:'wx',mode:0o600});
  }
  await fs.writeFile(path.join(destination,'.compute-source.json'),JSON.stringify(identity,null,2)+'\n',{flag:'wx',mode:0o600});
  await verifyImageIdentity(destination);
  return {directory:destination,sourceRevision,dependencySha256:identity.dependencySha256,sourceInventorySha256:identity.sourceInventorySha256,buildConfigSha256:identity.buildConfigSha256,sourceFiles:Object.keys(sourceInventory).length};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [out,configPath]=process.argv.slice(2);
  assert(out && configPath,'Usage: prepare-context.mjs NEW_DIRECTORY REVIEWED_BUILD_CONFIG_JSON');
  const buildConfig=JSON.parse(await fs.readFile(configPath,'utf8'));
  console.log(JSON.stringify(await prepareContext({out,buildConfig})));
}
