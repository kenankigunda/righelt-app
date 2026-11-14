import {workflow} from "../workflow.mjs";
import {nodeInventory,nodeLaneInventory} from "../inventory.mjs";
import {stressSeeds,stressTestName} from "../partition.mjs";
import {createHash} from 'node:crypto';
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
 await fs.writeFile(path.join(cwd,'scripts/testing/catalog.mjs'),id==='guest-2-v1'?catalog:id==='pr-gate-v5'?currentCatalog.replace(/export const NODE_PARTITIONS = [14];/,'export const NODE_PARTITIONS = 4;'):currentCatalog);await fs.mkdir(path.join(cwd,'.github/workflows'),{recursive:true});await fs.writeFile(path.join(cwd,'.github/workflows/ci.yml'),id==='guest-2-v1'?legacyWorkflow:JSON.stringify(id==='pr-gate-v5'?workflow({nodePartitions:4}):currentWorkflow,null,2)+'\n');
 if(id==='pr-gate-v5')for(const file of nodeInventory('tooling',process.cwd())){const target=path.join(cwd,path.relative(process.cwd(),file));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'fixture');}
 const git=(...a)=>execFileSync('git',a,{cwd});git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('add','.');git('commit','-qm','source');const identity=sourceIdentity(cwd),raw=Buffer.from('original log\n'),runtime={node:'22',pnpm:'9'},dependencies={lockHash:'lock',installedLockHash:'installed'};
 const receipts=profile.lanes.map(l=>sealReceipt({version:profile.evidenceProfile?2:1,...(profile.evidenceProfile?{evidenceProfile:profile.evidenceProfile,attempt:1,priorReceiptDigest:null,outcome:'passed',failureKind:null}:{}),catalog:profile.catalog,lane:`${l.suite}:${l.project??'default'}:${l.shard}/${l.shards}`,suite:l.suite,kind:['typecheck','generated','report-viewer'].includes(l.suite)?'check':'tests',stateMode:['e2e','guest-smoke','auth-smoke','storage-lifecycle','auth-e2e','auth-controls','responsive'].includes(l.suite)?'real-stack':'controlled',...identity,...(profile.evidenceProfile?{baseRevision:identity.revision}:{}),runtime,dependencies,status:'passed',exitCode:0,incomplete:false,dirtyDuringRun:false,inventory:{expected:['test'],missing:[],unexpected:[]},observations:{total:1,passed:1,failed:0,flaky:0,uncompleted:0},logHash:digest(raw)}));
 for(const [i,lane] of profile.lanes.entries())if(lane.shards>1){
  const r=receipts[i];delete r.integrity;
  if(lane.suite==='tooling'){
   const files=nodeLaneInventory('tooling',cwd,lane).map(file=>path.relative(cwd,file));r.inventory={expected:files,missing:[],unexpected:[]};r.observations={total:files.length,passed:files.length,tests:files.map(file=>({file,name:file,status:'passed'}))};
  }else if(lane.suite==='sync-stress'){
   const names=stressSeeds(lane).map(stressTestName);r.observations={total:names.length,passed:names.length,tests:names.map(name=>({name,file:'packages/api-handler/test-stress/sync-schedules.test.mjs',status:'passed'}))};
  }
  receipts[i]=sealReceipt(r);
 }
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
 const{options,runtime,dependencies}=await fixture(t,profiles.find(p=>p.catalogSourceSHA256===createHash('sha256').update(currentCatalog).digest('hex')&&p.workflowSourceSHA256===createHash('sha256').update(JSON.stringify(currentWorkflow,null,2)+'\n').digest('hex')).id);
 const result=await importCatalogCI({...options,expected:{
  Unit:{argv:['pnpm','test:unit'],runtime,dependencies},
  E2E:{argv:['pnpm','test:e2e'],runtime,dependencies},
 }});
 assert.equal(result.expectedLayout,options.expectedLayout);assert.ok(result.receipts.Unit);assert.match(result.rejected.E2E,/evidence profile differs/);
});
test('unknown, downgrade and changed source do not gain layout credit',async t=>{
 const{options,cwd}=await fixture(t,'guest-2-v1');await assert.rejects(importCatalogCI({...options,expectedLayout:'unknown'}));await assert.rejects(importCatalogCI({...options,expectedLayout:'guest-4-v1'}));await fs.appendFile(path.join(cwd,'scripts/testing/catalog.mjs'),'\nthrow Error("must never execute");');await assert.rejects(importCatalogCI(options));
});
test('mixed catalog receipts cannot satisfy the historical profile',async t=>{const{options,receipts}=await fixture(t);receipts[0]=sealReceipt({...receipts[0],catalog:'foreign'});await assert.rejects(importCatalogCI(options));});

test('released four-way reader imports complete portable evidence and rejects omitted or repeated seeds',async t=>{
 const {options,receipts,runtime,dependencies}=await fixture(t,'pr-gate-v5');
 const expected={'PR gate':{argv:['pnpm','test:pr-gate'],runtime,dependencies}};
 const good=await importCatalogCI({...options,expected});assert.ok(good.receipts['PR gate'],JSON.stringify(good.rejected));
 const index=receipts.findIndex(r=>r.suite==='sync-stress'),original=receipts[index];
 for(const tests of [original.observations.tests.slice(1),[...original.observations.tests,original.observations.tests[0]]]){
  const r={...original,observations:{...original.observations,tests}};delete r.integrity;receipts[index]=sealReceipt(r);
  await assert.rejects(importCatalogCI({...options,expected}),/seed inventory/);
 }
 receipts[index]=original;
 const tooling=receipts.findIndex(r=>r.suite==='tooling'),record=receipts[tooling];
 const r={...record,observations:{...record.observations,tests:record.observations.tests.slice(1)}};delete r.integrity;receipts[tooling]=sealReceipt(r);
 await assert.rejects(importCatalogCI({...options,expected}),/tooling partition inventory/);
});
