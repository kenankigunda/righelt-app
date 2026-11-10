import{storageFixture,storageJob}from'./storage-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import{execFileSync}from'node:child_process';
import{importCatalogCI}from'../../validation/suite-ci-evidence.mjs';import{sourceIdentity,sealReceipt,digest}from'../receipts.mjs';
const profiles=JSON.parse(await fs.readFile(new URL('../ci-layout-profiles.json',import.meta.url),'utf8')).profiles;
const currentWorkflow=JSON.parse(await fs.readFile(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
const currentCatalog=await fs.readFile(new URL('../catalog.mjs',import.meta.url),'utf8');
const legacyWorkflow=await fs.readFile(new URL('./fixtures/ci-legacy-34.json',import.meta.url));
const catalog=await fs.readFile(new URL('./fixtures/ci-legacy-catalog.txt',import.meta.url),'utf8');
async function fixture(t,id='guest-2-v1'){
 const cwd=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'righelt-layout-')));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));await fs.mkdir(path.join(cwd,'scripts/testing'),{recursive:true});const profile=profiles.find(p=>p.id===id);
 await fs.writeFile(path.join(cwd,'scripts/testing/catalog.mjs'),id==='guest-2-v1'?catalog:currentCatalog);await fs.mkdir(path.join(cwd,'.github/workflows'),{recursive:true});await fs.writeFile(path.join(cwd,'.github/workflows/ci.yml'),id==='guest-2-v1'?legacyWorkflow:JSON.stringify(currentWorkflow,null,2)+'\n');
 const git=(...a)=>execFileSync('git',a,{cwd});git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('add','.');git('commit','-qm','source');const identity=sourceIdentity(cwd),raw=Buffer.from('original log\n'),runtime={node:'22',pnpm:'9'},dependencies={lockHash:'lock',installedLockHash:'installed'};
 const receipts=profile.lanes.map(l=>sealReceipt({version:profile.evidenceProfile?2:1,...(profile.evidenceProfile?{evidenceProfile:profile.evidenceProfile,attempt:1,priorReceiptDigest:null,outcome:'passed',failureKind:null}:{}),catalog:profile.catalog,lane:`${l.suite}:${l.project??'default'}:${l.shard}/${l.shards}`,suite:l.suite,kind:['typecheck','generated','report-viewer'].includes(l.suite)?'check':'tests',stateMode:['e2e','guest-smoke','auth-smoke','storage-lifecycle','auth-e2e','auth-controls','responsive'].includes(l.suite)?'real-stack':'controlled',...identity,...(profile.evidenceProfile?{baseRevision:identity.revision}:{}),runtime,dependencies,status:'passed',exitCode:0,incomplete:false,dirtyDuringRun:false,inventory:{expected:['test'],missing:[],unexpected:[]},observations:{total:1,passed:1,failed:0,flaky:0,uncompleted:0},logHash:digest(raw)}));
 const run={id:1,head_sha:identity.revision,run_attempt:2,conclusion:'success'},artifacts=receipts.map((r,index)=>({id:index+1,name:profile.evidenceProfile?`suite-lane-${index}-attempt-1-2`:`suite-lane-${index}-2`,expired:false,created_at:new Date(1000+index).toISOString(),workflow_run:{id:1,head_sha:run.head_sha}}));const get=argv=>Number(/suite-(\d+)\.zip/.exec(argv.join(' '))[1])-1;const outDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'righelt-layout-out-')));t.after(()=>fs.rm(outDir,{recursive:true,force:true}));
 const storage=id=>{const lane=profile.lanes[id];return profile.storageEvidence&&lane.suite==='e2e'&&lane.shard===1?storageFixture(identity,lane.project):null;};
 const options={repository:'owner/repo',run,cwd,outDir,expectedLayout:id,expected:{},api:async endpoint=>endpoint.includes('/jobs?')?{total_count:3,jobs:['chromium','firefox','webkit'].map(p=>storageJob(storageFixture(identity,p).proof))}:{total_count:artifacts.length,artifacts},call:async argv=>{
   const i=get(argv),data=storage(i);return argv[1]==='-Z1'?'suites/lane/1.receipt.json'+(data?`\nstorage-lifecycle/${data.proof.project}/proof.json\nstorage-lifecycle/${data.proof.project}/results.xml\nstorage-lifecycle/${data.proof.project}/observations.json`:''):JSON.stringify(receipts[i]);
 },execute:async(argv,{log})=>{
   let bytes=Buffer.from('archive');if(argv[0]==='unzip'){const data=storage(get(argv)),name=argv.at(-1);bytes=name.endsWith('/proof.json')?Buffer.from(JSON.stringify(data.proof)):name.endsWith('/results.xml')?data.xml:name.endsWith('/observations.json')?data.observations:raw;}await fs.writeFile(log,bytes);return{output:'',code:0};
 }};return{options,receipts,cwd,runtime,dependencies};
}
test('legacy thirty-four lane compatibility remains accepted',async t=>{const{options}=await fixture(t,'guest-2-v1');assert.deepEqual((await importCatalogCI(options)).rejected,{});});
test('current pr-gate v2 imports represented checks and rejects nightly-only credit',async t=>{
 const{options,runtime,dependencies}=await fixture(t,'pr-gate-v3');
 const result=await importCatalogCI({...options,expected:{
  Unit:{argv:['pnpm','test:unit'],runtime,dependencies},
  E2E:{argv:['pnpm','test:e2e'],runtime,dependencies},
 }});
 assert.equal(result.expectedLayout,'pr-gate-v3');assert.ok(result.receipts.Unit);assert.match(result.rejected.E2E,/evidence profile differs/);
});
test('unknown, downgrade and changed source do not gain layout credit',async t=>{
 const{options,cwd}=await fixture(t,'guest-2-v1');await assert.rejects(importCatalogCI({...options,expectedLayout:'unknown'}));await assert.rejects(importCatalogCI({...options,expectedLayout:'guest-4-v1'}));await fs.appendFile(path.join(cwd,'scripts/testing/catalog.mjs'),'\nthrow Error("must never execute");');await assert.rejects(importCatalogCI(options));
});
test('mixed catalog receipts cannot satisfy the historical profile',async t=>{const{options,receipts}=await fixture(t);receipts[0]=sealReceipt({...receipts[0],catalog:'foreign'});await assert.rejects(importCatalogCI(options));});
