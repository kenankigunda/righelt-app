import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {importCI,checkoutCommit,workflowJobs} from '../ci-evidence.mjs';
import {collectCIProvenance} from '../ci-provenance.mjs';
const tree='a'.repeat(40),head='b'.repeat(40),checkout='c'.repeat(40);
const workflow=`name: CI
jobs:
  typecheck:
    name: Typecheck
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5
      - name: Setup Node
        uses: actions/setup-node@v5
        with:
          node-version: "22"
      - name: Setup pnpm
        run: corepack enable && corepack prepare pnpm@9 --activate
      - name: Install dependencies
        run: pnpm install --frozen-lockfile=false
      - name: Typecheck
        run: pnpm typecheck
`;
const environment={runner:'ubuntu-latest',nodeMajor:'22',pnpmMajor:'9',dependencyPolicy:'manifest-compatible-unfrozen',browserInstall:[]};
const dependencies={lockHash:'lock',installedLockHash:'resolved',manifestHash:'manifests'};
const runtime={node:'v22.23.3',pnpm:'9.15.9',platform:'linux',arch:'x64',playwrightVersion:null,browserManifestHash:null};
async function fixture(t,changes={}){
 const cwd=await realpath(await mkdtemp(path.join(os.tmpdir(),'ci-import-')));t.after(()=>rm(cwd,{recursive:true,force:true}));await mkdir(path.join(cwd,'.github/workflows'),{recursive:true});await writeFile(path.join(cwd,'.github/workflows/ci.yml'),workflow);await writeFile(path.join(cwd,'package.json'),JSON.stringify({scripts:{typecheck:'tsc', 'test:unit':'pnpm missing'}}));
 const run={id:123,run_attempt:1,head_sha:head,repository:{full_name:'owner/repo'},status:'completed',event:'pull_request',path:'.github/workflows/ci.yml'};
 const job={id:456,run_id:123,run_attempt:1,name:'Typecheck',status:'completed',conclusion:'success',steps:[{name:'Checkout',conclusion:'success'},{name:'Typecheck',conclusion:'success'}]};
 const proof={version:1,repository:'owner/repo',runId:123,attempt:1,job:'typecheck',checkout,testedTree:tree,dependencies,runtime};
 const artifact={id:789,name:'ci-provenance-typecheck-1',expired:false,workflow_run:{id:123,head_sha:head}};
 const log=`[command]/usr/bin/git log -1 --format=%H\n${checkout}\nnode: v22.23.3\n##[group]Run corepack enable && corepack prepare pnpm@9 --activate\n##[group]Run pnpm typecheck\n`;
 const requested=[];
 const execute=async(argv,options={})=>{
  requested.push(argv);
  if(argv[0]==='git')return {output:argv[1]==='status'?(changes.dirty?' M package.json':''):tree};
  if(argv[0]==='unzip')return {output:argv[1]==='-Z1'?(changes.archiveEntry??'typecheck.json'):JSON.stringify({...proof,...changes.proof})};
  const endpoint=argv[2];let value;
  if(endpoint.endsWith('/logs')){await writeFile(options.log,changes.log??log);return {output:''};}
  if(endpoint.endsWith('/zip')){await writeFile(options.log,'archive');return {output:''};}
  if(endpoint.endsWith('/actions/runs/123'))value={...run,...changes.run};
  else if(endpoint.includes('/jobs?'))value={total_count:1,jobs:[{...job,...changes.job}]};
  else if(endpoint.includes('/artifacts?'))value={total_count:changes.noArtifact?0:1,artifacts:changes.noArtifact?[]:[artifact]};
  else if(endpoint.includes('/contents/'))value={content:Buffer.from(workflow).toString('base64')};
  else if(endpoint.includes('/git/commits/')){assert.ok(endpoint.endsWith(checkout),'must inspect actual checkout, never assume run head');value={sha:checkout,tree:{sha:changes.wrongTree?'d'.repeat(40):tree}};}
  else throw Error(endpoint);
  return {output:JSON.stringify(value)};
 };
 return {args:{repository:'owner/repo',runId:123,cwd,outDir:path.join(cwd,'out'),expected:{Typecheck:{argv:['pnpm','typecheck'],environment,dependencies,runtime}},execute},requested};
}
test('imports successful named evidence only after verifying actual merge checkout tree and exact dependencies/runtime',async t=>{
 const {args,requested}=await fixture(t);const result=await importCI(args);assert.deepEqual(result.rejected,{});assert.equal(result.receipts.Typecheck.testedTree,tree);assert.equal(result.receipts.Typecheck.runHead,head);assert.equal(result.receipts.Typecheck.evidence[0].checkout,checkout);assert.ok(requested.some(a=>a[2]?.endsWith('/git/commits/'+checkout)));assert.equal(result.receipts.Typecheck.evidence[0].provenance.dependencies.installedLockHash,'resolved');
});
test('rejects unfrozen jobs without resolved provenance, tree mismatch, failed steps and unsafe archives',async t=>{
 for(const [changes,pattern] of [[{noArtifact:true},/provenance artifact/],[{wrongTree:true},/checkout tree/],[{job:{conclusion:'failure'}},/not successful/],[{archiveEntry:'../typecheck.json'},/archive entries/],[{proof:{attempt:2}},/identity mismatch/]]){
  const {args}=await fixture(t,changes);const result=await importCI(args);assert.match(result.rejected.Typecheck,pattern);assert.equal(result.receipts.Typecheck,undefined);
 }
});
test('explicit runtime, resolved versions, command coverage and clean source remain required',async t=>{
 const {args}=await fixture(t);let result=await importCI({...args,expected:{Typecheck:{...args.expected.Typecheck,runtime:{...runtime,node:'v26'}}}});assert.match(result.rejected.Typecheck,/runtime identity/);
 result=await importCI({...args,expected:{Typecheck:{...args.expected.Typecheck,dependencies:{...dependencies,installedLockHash:'changed'}}}});assert.match(result.rejected.Typecheck,/resolved dependencies/);
 result=await importCI({...args,expected:{Unit:{argv:['pnpm','test:unit'],environment,dependencies,runtime}}});assert.match(result.rejected.Unit,/Unknown package script/);
 const dirty=await fixture(t,{dirty:true});await assert.rejects(importCI(dirty.args),/clean exact tree/);
});
test('checkout log parsing fails closed on absent or conflicting hashes and accepts timestamped primary log',()=>{
 assert.equal(checkoutCommit(`2026-10-04T18:13:07Z [command]/usr/bin/git log -1 --format=%H\n2026-10-04T18:13:07Z ${checkout}`),checkout);
 assert.throws(()=>checkoutCommit(head),/missing/);assert.throws(()=>checkoutCommit(`[command]/usr/bin/git log -1 --format=%H\n${checkout}\n[command]/usr/bin/git log -1 --format=%H\n${head}`),/ambiguous/);
 assert.equal(workflowJobs(workflow)[0].steps.at(-1).commands[0],'pnpm typecheck');
});
test('emission hashes actual installed lock independently of tracked lock and records exact runtime identity',async t=>{
 const {args}=await fixture(t);await mkdir(path.join(args.cwd,'node_modules/.pnpm'),{recursive:true});await writeFile(path.join(args.cwd,'pnpm-lock.yaml'),'tracked');await writeFile(path.join(args.cwd,'node_modules/.pnpm/lock.yaml'),'resolved');
 const execute=async argv=>({output:argv[0]==='pnpm'?'9.15.9':argv[1]==='ls-files'?'package.json\nplaywright.config.mjs':argv[2]==='HEAD'?checkout:tree});await writeFile(path.join(args.cwd,'playwright.config.mjs'),'config');
 const options={cwd:args.cwd,env:{GITHUB_REPOSITORY:'owner/repo',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'typecheck'},execute};const first=await collectCIProvenance(options);assert.notEqual(first.dependencies.lockHash,first.dependencies.installedLockHash);assert.equal(first.runtime.node,process.version);
 await writeFile(path.join(args.cwd,'node_modules/.pnpm/lock.yaml'),'different resolution');const second=await collectCIProvenance(options);assert.notEqual(first.dependencies.installedLockHash,second.dependencies.installedLockHash);assert.equal(first.dependencies.lockHash,second.dependencies.lockHash);
});
test('persisted CI evidence requires exact name/tree/command, expiry and surviving primary files',async t=>{
 const {loadCIReceipt}=await import('../ci-evidence.mjs');const {args}=await fixture(t);const imported=await importCI(args);const file=path.join(args.outDir,'ci-import.json'),options={name:'Typecheck',argv:['pnpm','typecheck'],tree};
 assert.equal((await loadCIReceipt(file,options)).status,'passed');
 assert.equal(await loadCIReceipt(file,{...options,tree:head}),null);assert.equal(await loadCIReceipt(file,{...options,argv:['pnpm','test:unit']}),null);assert.equal(await loadCIReceipt(file,{...options,name:'Unit'}),null);assert.equal(await loadCIReceipt(file,{...options,now:Date.now()+86400001}),null);
 await writeFile(imported.receipts.Typecheck.evidence[0].archive,'corrupt');assert.equal(await loadCIReceipt(file,options),null);
});

test('tracked workflow has job mappings and provenance steps only inside real jobs',async()=>{
 const source=await readFile(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8');
 const {workflowJobs}=await import('../ci-evidence.mjs');const jobs=workflowJobs(source);assert.equal(jobs.length,10);assert.ok(!jobs.some(j=>j.id==='push'));
 for(const job of jobs.filter(j=>j.id!=='test-results'))assert.equal(job.steps.filter(s=>s.name==='Record exact CI environment').length,1);
 assert.throws(()=>workflowJobs(source.replace('jobs:\n','jobs:\n      - name: invalid\n')),/job mapping/);
});
