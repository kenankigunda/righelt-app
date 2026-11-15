import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile,execFileSync } from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import { createHash } from 'node:crypto';
import { prepareContext } from '../prepare-context.mjs';
import { verifyImageIdentity } from '../image-identity.mjs';

const config={schema:1,nodeImage:`node:22-bookworm-slim@sha256:${'a'.repeat(64)}`,pythonImage:`python:3.14-slim-bookworm@sha256:${'b'.repeat(64)}`,platform:'linux/amd64',pythonVersion:'3.14',torchVersion:'2.14.1',torchIndex:'https://download.pytorch.org/whl/cu130',cudaVersion:'13.0',evidenceReference:'fixture-only-no-image-qualification'};
async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-public-context-')),root=path.join(directory,'source'),out=path.join(directory,'context');
  await fs.mkdir(root);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  const write=async(name,bytes)=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);};
  const files={
    'package.json':'{"name":"fixture","private":true}', 'pnpm-lock.yaml':'lockfileVersion: 9\n', 'pnpm-workspace.yaml':'packages: []\n',
    'tsconfig.json':'{}','tsconfig.base.json':'{}','tools/ai-trainer/requirements.lock':'torch==2.14.1\n',
    'tools/hosted-compute/image-identity.mjs':'export const fixture=true;\n','tools/hosted-compute/worker.mjs':"export {runtime} from './runtime.mjs';\n",
    'tools/hosted-compute/runtime.mjs':'export const runtime=true;\n',
    'tools/hosted-compute/policy.json':'{"schema":1}', 'tools/hosted-compute/fixture-contract.json':'{"schema":1}',
    'packages/game-engine/src/index.ts':'export const engine = 1;\n','packages/shared-types/src/control.js':'export const control = true;\n',
    'packages/game-engine/src/.env.json':'{"private":"hidden source credential"}',
    'packages/computer-player/config/experiment-v1.json':'{"id":"fixture"}',
    'tools/ai-trainer/righelt_training/manifest.py':'PROOF = True\n','tools/ai-trainer/tests/test_recovery.py':'retained_test_source = True\n',
    'tools/hosted-compute/controller.mjs':'unneeded operator/provider secret sentinel',
    'tools/hosted-compute/gh-cli-control.mjs':'operator keyring transport must not ship',
    'tools/hosted-compute/operator-backup.mjs':'operator backup credentials must not ship',
    'tools/ai-trainer/private-export.json':'{"raw":"private game"}', '.env':'SECRET=not-for-image',
    '.ai-runs/model.pt':'private model bytes','apps/web/models/private.onnx':'private export bytes',
    'historic-secret.txt':'private history bytes', '.gitignore':'.ai-runs/\n',
  };
  for(const [name,bytes] of Object.entries(files)) await write(name,bytes);
  git('add','--all');git('commit','-m','fixture source and private material');
  await fs.rm(path.join(root,'historic-secret.txt'));git('add','--all');git('commit','-m','remove historical secret');
  // Ignored local artifacts remain present. They must not enter the export.
  await write('.ai-runs/new-private.json','{"private":"local only"}');
  return {root,out,git,write,files};
}
test('public context exports committed allowlisted source, with no history, credentials, models, raw exports or operator modules',async t=>{
  const f=await fixture(t),result=await prepareContext({root:f.root,out:f.out,buildConfig:config}),identity=await verifyImageIdentity(f.out);
  assert.equal(result.sourceRevision,f.git('rev-parse','HEAD'));
  assert.equal(identity.sourceInventory['packages/game-engine/src/index.ts'],createHash('sha256').update(f.files['packages/game-engine/src/index.ts']).digest('hex'));
  for(const name of ['.git','.env','.ai-runs','historic-secret.txt','apps','packages/game-engine/src/.env.json','tools/ai-trainer/tests','tools/ai-trainer/private-export.json','tools/hosted-compute/controller.mjs','tools/hosted-compute/gh-cli-control.mjs','tools/hosted-compute/operator-backup.mjs'])
    await assert.rejects(fs.stat(path.join(f.out,name)),{code:'ENOENT'});
  assert.equal(identity.proofInventory['tools/ai-trainer/tests/test_recovery.py'],createHash('sha256').update(f.files['tools/ai-trainer/tests/test_recovery.py']).digest('hex'));
  assert.equal(identity.sourceInventory['tools/ai-trainer/tests/test_recovery.py'],undefined);
  assert.equal(identity.sourceInventory['tools/ai-trainer/righelt_training/manifest.py'],createHash('sha256').update(f.files['tools/ai-trainer/righelt_training/manifest.py']).digest('hex'));
});
test('native Docker copy preserves the audited inventory and worker runtime import closure',async t=>{
  const execute=promisify(execFile);
  try{await execute('docker',['info','--format','{{.ServerVersion}}'],{timeout:5000});}
  catch(error){
    if(process.env.GITHUB_ACTIONS==='true')throw Error('native Docker context proof requires the CI Docker daemon',{cause:error});
    t.skip('local Docker daemon unavailable; native context proof is mandatory in GitHub CI');return;
  }
  const f=await fixture(t),directory=path.dirname(f.root),dockerfile=path.join(directory,'context.Dockerfile');
  const rules=await fs.readFile(new URL('../Dockerfile.dockerignore',import.meta.url),'utf8');
  await f.write('tools/hosted-compute/Dockerfile',await fs.readFile(new URL('../Dockerfile',import.meta.url)));
  await f.write('tools/hosted-compute/Dockerfile.dockerignore',rules);
  f.git('add','--all');f.git('commit','-m','bind production container rules');
  await prepareContext({root:f.root,out:f.out,buildConfig:config});
  await fs.writeFile(dockerfile,'FROM scratch\nCOPY . /\n');
  const copied=async(ignore,name)=>{
    await fs.writeFile(dockerfile+'.dockerignore',ignore);
    const output=path.join(directory,name);
    await execute('docker',['build','--network=none','--progress=plain','--file',dockerfile,'--output',`type=local,dest=${output}`,f.out],
      {env:{...process.env,DOCKER_BUILDKIT:'1'},timeout:120000,maxBuffer:1024*1024});
    return output;
  };
  // Exercise a missing runtime file through Docker itself. An explicit final
  // deny avoids relying on how parent-directory exceptions include children.
  const broken=await copied(rules+'\ntools/hosted-compute/runtime.mjs\n','omitted-runtime');
  await assert.rejects(verifyImageIdentity(broken),/unexpected or missing/);
  const complete=await copied(rules,'complete-runtime');
  const identity=await verifyImageIdentity(complete);
  assert.equal(identity.sourceInventory['tools/hosted-compute/runtime.mjs'],createHash('sha256').update(f.files['tools/hosted-compute/runtime.mjs']).digest('hex'));
  assert.equal((await import(pathToFileURL(path.join(complete,'tools/hosted-compute/worker.mjs')))).runtime,true);
});
test('export refuses dirty source, mutable base tags, symlinks and checkout-local destinations',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareContext({root:f.root,out:f.out,buildConfig:{...config,nodeImage:'node:latest'}}),/digest-pinned/);
  await assert.rejects(prepareContext({root:f.root,out:f.out,buildConfig:{...config,operatorCredential:'must not ship'}}),/public build configuration/);
  await assert.rejects(prepareContext({root:f.root,out:path.join(f.root,'context'),buildConfig:config}),/outside/);
  const alias=path.join(path.dirname(f.root),'checkout-alias');await fs.symlink(f.root,alias,'dir');
  await assert.rejects(prepareContext({root:f.root,out:path.join(alias,'context'),buildConfig:config}),/outside/);
  await f.write('packages/game-engine/src/index.ts','changed without commit');
  await assert.rejects(prepareContext({root:f.root,out:f.out,buildConfig:config}),/commit source/);
  f.git('add','--all');f.git('commit','-m','fixture source amendment');
  await fs.symlink('/private/operator-file',path.join(f.root,'tools/ai-trainer/righelt_training/link.py'));
  f.git('add','--all');f.git('commit','-m','fixture unsafe link');
  await assert.rejects(prepareContext({root:f.root,out:f.out,buildConfig:config}),/symlink/);
});
test('image verification rejects source mutation, extra files and mismatched reviewed Docker build arguments',async t=>{
  const f=await fixture(t);await prepareContext({root:f.root,out:f.out,buildConfig:config});
  const identity=await verifyImageIdentity(f.out);
  const env={SOURCE_REVISION:identity.sourceRevision,NODE_IMAGE:config.nodeImage,PYTHON_IMAGE:config.pythonImage,TORCH_INDEX:config.torchIndex,TORCH_VERSION:config.torchVersion,TARGET_PLATFORM:config.platform};
  assert.equal((await verifyImageIdentity(f.out,{buildEnvironment:env})).sourceRevision,identity.sourceRevision);
  await assert.rejects(verifyImageIdentity(f.out,{buildEnvironment:{...env,TORCH_INDEX:'https://download.pytorch.org/whl/cpu'}}),/Docker build differs/);
  await fs.writeFile(path.join(f.out,'operator-key.txt'),'private sentinel');
  await assert.rejects(verifyImageIdentity(f.out),/unexpected/);
  await fs.rm(path.join(f.out,'operator-key.txt'));
  await fs.writeFile(path.join(f.out,'packages/game-engine/src/index.ts'),'different source');
  await assert.rejects(verifyImageIdentity(f.out),/checksum/);
});
