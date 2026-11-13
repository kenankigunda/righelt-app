import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,chmod,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {storageLaneIsolation,isolationFailureLabel} from '../storage-lane-isolation.mjs';
import {STORAGE_TESTS} from '../storage-evidence.mjs';
import {runSuite} from '../run.mjs';
import {hasValidIntegrity,isRetryableReceipt} from '../receipts.mjs';

const lane=(project='chromium',suite='storage-lifecycle')=>({suite,project,shard:1,shards:1});
const discovery=(cwd,project='chromium',storage=true)=>{
 const file=path.join(cwd,storage?'e2e/workflows/storage-lifecycle.spec.mjs':'e2e/workflows/home-create-refresh.spec.mjs');
 const titles=storage?STORAGE_TESTS:['ordinary Home creation'];
 const tests=titles.map((title,i)=>({id:`${project}-${storage?'storage':'home'}-${i}`,file,name:` > ${project} > workflows/${path.basename(file)} > ${title}`}));
 return {total:tests.length,inventory:tests.map(test=>test.id),tests};
};

for(const project of ['chromium','firefox','webkit']){
 test(`${project}: exact storage discovery and disjoint general discovery are allowed`,()=>{
  assert.equal(storageLaneIsolation(lane(project),discovery('/candidate',project),{cwd:'/candidate'}),null);
  assert.equal(storageLaneIsolation(lane(project,'e2e'),discovery('/candidate',project,false),{cwd:'/candidate'}),null);
 });
}

for(const mutation of ['extra','missing','duplicate','wrong-project','foreign-file','empty','null-row','declared-ids','null']){
 test(`storage discovery refuses ${mutation} before destructive execution`,()=>{
  let value=discovery('/candidate');
  if(mutation==='extra')value.tests.push(discovery('/candidate','chromium',false).tests[0]);
  if(mutation==='missing')value.tests.pop();
  if(mutation==='duplicate')value.tests[1]={...value.tests[0]};
  if(mutation==='wrong-project')value=discovery('/candidate','webkit');
  if(mutation==='foreign-file')value.tests[0].file='/foreign/e2e/workflows/storage-lifecycle.spec.mjs';
  if(mutation==='empty')value.tests=[];
  if(mutation==='null-row')value.tests[0]=null;
  if(mutation!=='null'){value.total=value.tests.length;value.inventory=value.tests.map(test=>test?.id);}
  if(mutation==='declared-ids')value.inventory=['not-the-discovered-identities'];
  if(mutation==='null')value=null;
  const failure=storageLaneIsolation(lane(),value,{cwd:'/candidate'});
  assert.equal(failure.category,'infrastructure-inventory-isolation');
  assert.equal(failure.stackStarted,false);assert.ok(failure.errors.length);
 });
}

test('general E2E refuses storage cases without changing unrelated browser suites',()=>{
 const value=discovery('/candidate');
 assert.ok(storageLaneIsolation(lane('chromium','e2e'),value,{cwd:'/candidate'}));
 assert.equal(storageLaneIsolation(lane('chromium','browser-contract'),value,{cwd:'/candidate'}),null);
});

async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'storage-inventory-'))),cwd=path.join(root,'candidate'),bin=path.join(root,'bin');
 t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(cwd);await mkdir(bin);
 await writeFile(path.join(bin,'pnpm'),'#!/bin/sh\nprintf "9.15.9\\n"\n');await chmod(path.join(bin,'pnpm'),0o755);
 const previous={PATH:process.env.PATH,base:process.env.RIGHELT_TEST_BASE_REVISION};process.env.PATH=bin+path.delimiter+process.env.PATH;process.env.RIGHELT_TEST_BASE_REVISION='HEAD';
 t.after(()=>{process.env.PATH=previous.PATH;if(previous.base===undefined)delete process.env.RIGHELT_TEST_BASE_REVISION;else process.env.RIGHELT_TEST_BASE_REVISION=previous.base;});
 await mkdir(path.join(cwd,'node_modules/@playwright/test'),{recursive:true});await mkdir(path.join(cwd,'node_modules/.pnpm'),{recursive:true});
 await writeFile(path.join(cwd,'node_modules/@playwright/test/package.json'),JSON.stringify({version:'1.59.1'}));
 await writeFile(path.join(cwd,'node_modules/.pnpm/lock.yaml'),'controlled installed lock');
 await writeFile(path.join(cwd,'pnpm-lock.yaml'),'controlled source lock');await writeFile(path.join(cwd,'.gitignore'),'node_modules/\n');
 const git=(...args)=>execFileSync('git',args,{cwd,stdio:'pipe'});git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--no-gpg-sign','-qm','fixture');
 return {cwd,out:path.join(root,'out')};
}

for(const suite of ['storage-lifecycle','e2e'])test(`${suite}: actual runner seals one inventory failure and never launches the stack`,async t=>{
 const {cwd,out}=await fixture(t),selected=lane('firefox',suite);let launches=0;
 const value=discovery(cwd,'firefox',true);
 if(suite==='storage-lifecycle'){value.tests.push(discovery(cwd,'firefox',false).tests[0]);value.total=value.tests.length;value.inventory=value.tests.map(test=>test.id);}
 const receipt=await runSuite(selected,{cwd,out,profile:'nightly-full',discover:async()=>value,execute:async()=>{launches++;throw Error('Stack must not start');}});
 assert.equal(launches,0);assert.equal(receipt.status,'failed');assert.equal(receipt.failureKind,'inventory');assert.equal(receipt.incomplete,false);assert.equal(receipt.observations,null);assert.equal(receipt.stack,null);
 assert.equal(hasValidIntegrity(receipt),true);assert.equal(isRetryableReceipt(receipt),false);assert.equal(isolationFailureLabel(receipt),'infrastructure inventory isolation');
 const dir=path.dirname(receipt.log);assert.equal((await readdir(dir)).filter(file=>file.endsWith('.receipt.json')).length,1);
 assert.deepEqual(JSON.parse(await readFile(path.join(dir,'inventory.json'),'utf8')),value);
 assert.deepEqual(JSON.parse(await readFile(receipt.log,'utf8')),receipt.isolation);
});

for(const project of ['chromium','firefox','webkit'])test(`${project}: valid discovery reaches the original runner and is not an isolation failure`,async t=>{
 const {cwd,out}=await fixture(t),value=discovery(cwd,project);let launches=0;
 const receipt=await runSuite(lane(project),{cwd,out,profile:'nightly-full',discover:async()=>value,execute:async({env,log})=>{
  launches++;await writeFile(log,'original execution');await writeFile(env.RIGHELT_TEST_OBSERVATIONS,JSON.stringify({...value,passed:2,failed:0,flaky:0,uncompleted:0}));return {code:0};
 }});
 assert.equal(launches,1);assert.equal(receipt.status,'passed');assert.equal(receipt.failureKind,null);assert.equal(receipt.isolation,undefined);assert.equal(isolationFailureLabel(receipt),null);
});

test('a later storage_reset assertion stays an ordinary failed execution, not infrastructure classification',async t=>{
 const {cwd,out}=await fixture(t),value=discovery(cwd);let launches=0;
 const receipt=await runSuite(lane(),{cwd,out,profile:'nightly-full',discover:async()=>value,execute:async({env,log})=>{
  launches++;await writeFile(log,'HTTP409 storage_reset');await writeFile(env.RIGHELT_TEST_OBSERVATIONS,JSON.stringify({...value,passed:1,failed:1}));return {code:1};
 }});
 assert.equal(launches,1);assert.equal(receipt.status,'failed');assert.equal(receipt.failureKind,'assertion');assert.equal(receipt.isolation,undefined);assert.equal(isolationFailureLabel(receipt),null);assert.equal(isRetryableReceipt(receipt),false);
});
