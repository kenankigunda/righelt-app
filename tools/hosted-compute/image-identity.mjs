import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { assert, canonical } from './policy.mjs';

export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export const hashRecord=record=>hashBytes(canonical(record));
export const LOCK_PATHS=Object.freeze(['pnpm-lock.yaml','tools/ai-trainer/requirements.lock']);
const rootFiles=new Set(['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json']);
const hostedFiles=new Set(['worker.mjs','runtime.mjs','client.mjs','result.mjs','policy.mjs','policy.json','cash.mjs','data-contract.mjs','fixture-contract.json','image-identity.mjs','s05-observations.mjs','search-diagnosis.mjs','development-suite.mjs','development-suite-assessment.mjs','Dockerfile','Dockerfile.dockerignore']);
const trainerJson=new Set(['followup-policy-v1.json','learning-evidence-contract.json']);
const packageJson=new Set(['local-teaching-v2.json','followup-teaching-v1.json']);
export function safeSourcePath(name) { return typeof name==='string' && /^[A-Za-z0-9_@.+/-]+$/.test(name) && !name.startsWith('/') && name.split('/').every(p=>p && !p.startsWith('.')); }
export function isRuntimeSourcePath(name) {
  if(!safeSourcePath(name)) return false;
  if(rootFiles.has(name) || /^patches\/[^/]+\.patch$/.test(name)) return true;
  if(/^packages\/(game-engine|computer-player|shared-types)\/package\.json$/.test(name)) return true;
  if(/^packages\/(game-engine|computer-player|shared-types)\/src\/.+\.(ts|js|mjs|json)$/.test(name)) return true;
  if(/^packages\/computer-player\/config\/(experiment-v1|benchmark-v1|training-recipes-v1)\.json$/.test(name)) return true;
  if(/^tools\/ai-trainer\/[^/]+\.(mjs|py)$/.test(name)) return true;
  if(name.startsWith('tools/ai-trainer/') && trainerJson.has(name.slice('tools/ai-trainer/'.length))) return true;
  if(name==='tools/ai-trainer/requirements.lock') return true;
  if(/^tools\/ai-trainer\/righelt_training\/(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+\.py$/.test(name)) return true;
  if(name.startsWith('tools/ai-trainer/righelt_training/') && packageJson.has(name.slice('tools/ai-trainer/righelt_training/'.length))) return true;
  if(name==='tools/ai-benchmark/search-proof.mjs') return true;
  return name.startsWith('tools/hosted-compute/') && hostedFiles.has(name.slice('tools/hosted-compute/'.length));
}
export function isProofSourcePath(name) {
  return isRuntimeSourcePath(name) || /^tools\/ai-trainer\/tests\/[A-Za-z0-9_.-]+\.(py|mjs)$/.test(name);
}
export function validateBuildConfig(config) {
  const pinned=/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/;
  assert(config && Object.keys(config).sort().join(',')==='cudaVersion,evidenceReference,nodeImage,platform,pythonImage,pythonVersion,schema,torchIndex,torchVersion','only reviewed public build configuration fields are allowed');
  assert(config?.schema===1 && pinned.test(config.nodeImage) && pinned.test(config.pythonImage),'reviewed digest-pinned Node and Python base images required');
  assert(config.platform==='linux/amd64' && config.pythonVersion==='3.14' && config.torchVersion==='2.14.1' && config.torchIndex==='https://download.pytorch.org/whl/cu130' && config.cudaVersion==='13.0','reviewed CUDA wheel/platform configuration required');
  assert(typeof config.evidenceReference==='string' && config.evidenceReference.length>=8,'reviewed build configuration evidence required');
  return config;
}
async function actualFiles(root,prefix='') {
  const result=[];
  for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})) {
    const name=prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(),'source image cannot contain symbolic links');
    if(entry.isDirectory()) result.push(...await actualFiles(root,name));
    else {assert(entry.isFile(),'source image contains unsupported file');result.push(name);}
  }
  return result.sort();
}
export async function verifyImageIdentity(root,{buildEnvironment}={}) {
  const identity=JSON.parse(await fs.readFile(path.join(root,'.compute-source.json'),'utf8'));
  assert(Object.keys(identity).sort().join(',')==='buildConfig,buildConfigSha256,dependencySha256,locks,proofInventory,proofInventorySha256,schema,sourceInventory,sourceInventorySha256,sourceRevision','only source identity fields are allowed');
  assert(identity.schema===2 && /^[a-f0-9]{40}$/.test(identity.sourceRevision),'source-only image identity required');
  assert(identity.sourceInventory && hashRecord(identity.sourceInventory)===identity.sourceInventorySha256 && identity.proofInventory && hashRecord(identity.proofInventory)===identity.proofInventorySha256,'source inventory digest mismatch');
  validateBuildConfig(identity.buildConfig);
  assert(hashRecord(identity.buildConfig)===identity.buildConfigSha256,'build configuration digest mismatch');
  const expected=Object.keys(identity.sourceInventory).sort();assert(expected.length>0,'empty source image inventory');
  assert(canonical(await actualFiles(root))===canonical([...expected,'.compute-source.json'].sort()),'source image contains unexpected or missing files');
  for(const name of expected) {
    assert(isRuntimeSourcePath(name) && /^[a-f0-9]{64}$/.test(identity.sourceInventory[name]),'unapproved image source path');
    assert(hashBytes(await fs.readFile(path.join(root,name)))===identity.sourceInventory[name],`image source checksum mismatch: ${name}`);
    assert(identity.proofInventory[name]===identity.sourceInventory[name],'proof and exported source inventories differ');
  }
  for(const [name,digest] of Object.entries(identity.proofInventory)) assert(isProofSourcePath(name) && /^[a-f0-9]{64}$/.test(digest),'unapproved proof inventory path');
  const locks=Object.fromEntries(await Promise.all(LOCK_PATHS.map(async name=>[name,hashBytes(await fs.readFile(path.join(root,name)))])));
  assert(canonical(locks)===canonical(identity.locks) && hashRecord(locks)===identity.dependencySha256,'image dependency identity mismatch');
  if(buildEnvironment) {
    const env=buildEnvironment,c=identity.buildConfig;
    assert(env.SOURCE_REVISION===identity.sourceRevision && env.NODE_IMAGE===c.nodeImage && env.PYTHON_IMAGE===c.pythonImage && env.TORCH_INDEX===c.torchIndex && env.TORCH_VERSION===c.torchVersion && env.TARGET_PLATFORM===c.platform,'Docker build differs from reviewed source/base/wheel configuration');
  }
  return identity;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await verifyImageIdentity(process.cwd(),{buildEnvironment:process.env});
  console.log('Verified source-only image inventory and reviewed build configuration.');
}
