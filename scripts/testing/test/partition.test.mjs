import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { toolingFiles, stressSeeds, stressTestName, verifyStressSeeds, partitionIdentity } from "../partition.mjs";
import { nodeInventory, nodeLaneInventory, verifyInventory } from "../inventory.mjs";
import { verifyFull, sealReceipt, EVIDENCE_PROFILES } from "../receipts.mjs";
import { runSuite } from "../run.mjs";

const root = process.cwd();
test("four tooling partitions cover every real file exactly once and include new files", () => {
  const all = [...nodeInventory("tooling", root), path.join(root, "scripts/testing/test/future.test.mjs")];
  const partitions = [1,2,3,4].map(shard => toolingFiles(all, {shard, shards:4}, root));
  assert.deepEqual(partitions.flat().sort(), [...all].sort());
  assert.equal(new Set(partitions.flat()).size, all.length);
  for (const [i, files] of partitions.entries()) {
    assert.deepEqual(toolingFiles([...all].reverse(), {shard:i+1, shards:4}, root), files);
    const heavy = files.indexOf(path.join(root,"scripts/validation/test/streamlined.test.mjs"));
    if (heavy !== -1) assert.equal(heavy, files.length-1);
  }
  assert.deepEqual(toolingFiles(all).sort(), [...all].sort());
  assert.throws(()=>toolingFiles([all[0],all[0]]), /Duplicate/);
});
test("all 100 complete stress seeds have one owner, stable order and strict replay", () => {
  const partitions = [1,2,3,4].map(shard => stressSeeds({shard,shards:4}));
  assert.deepEqual(partitions.map(p=>p.length),[25,25,25,25]);
  assert.deepEqual(partitions[0].slice(0,3),[1,5,9]);
  assert.deepEqual(partitions.flat().sort((a,b)=>a-b),Array.from({length:100},(_,i)=>i+1));
  assert.deepEqual(stressSeeds({},"37"),[37]);
  for (const value of ["0","101","1.5","NaN",""]) assert.throws(()=>stressSeeds({},value));
  assert.throws(()=>stressSeeds({shard:1,shards:4},"1"));
  for (const lane of [{shard:0,shards:4},{shard:5,shards:4},{shard:1,shards:2},{shard:NaN,shards:1}]) assert.throws(()=>partitionIdentity(lane));
});
const identity={revision:"revision",baseRevision:"base",testedTree:"tree",sourceFingerprint:"fingerprint"};
const lane={suite:"sync-stress",project:null,shard:1,shards:4};
function seedReceipt(names) {
  return sealReceipt({version:2,evidenceProfile:"pr-gate",attempt:1,priorReceiptDigest:null,outcome:"passed",failureKind:null,catalog:"catalog",lane:"sync-stress:default:1/4",suite:"sync-stress",kind:"tests",stateMode:"controlled",...identity,status:"passed",exitCode:0,incomplete:false,dirtyDuringRun:false,runtime:{node:"22",pnpm:"9"},dependencies:{lockHash:"lock",installedLockHash:"installed"},inventory:{expected:["packages/api-handler/test-stress/sync-schedules.test.mjs"],missing:[]},observations:{total:names.length,passed:names.length,tests:names.map(name=>({name,status:"passed"}))}});
}
test("the aggregate independently rejects omitted, repeated, or foreign stress seeds", () => {
  const names=Array.from({length:25},(_,i)=>stressTestName(i*4+1));
  const verify=names=>verifyFull([seedReceipt(names)],identity,{lanes:[lane],catalog:"catalog",profile:"pr-gate",allowLegacy:false});
  assert.equal(verify(names).status,"passed");
  for(const broken of [names.slice(1),[...names,names[0]],[...names.slice(1),stressTestName(2)]])assert.equal(verify(broken).status,"failed");
  assert.equal(verifyStressSeeds({tests:names.map(name=>({name}))},lane).missing.length,0);
});
test("tooling aggregate proves full unique observed coverage independently of assignment weights", () => {
  const lanes=[1,2,3,4].map(shard=>({suite:"tooling",project:null,shard,shards:4}));
  const records=lanes.map(lane=>{
    const files=nodeLaneInventory("tooling",root,lane).map(f=>path.relative(root,f));
    const receipt=seedReceipt([]);delete receipt.integrity;
    return {...receipt,suite:"tooling",lane:`tooling:default:${lane.shard}/4`,inventory:{expected:files,missing:[],unexpected:[]},observations:{total:files.length,passed:files.length,tests:files.map(file=>({file,name:file,status:"passed"}))}};
  });
  const verify=records=>verifyFull(records.map(sealReceipt),identity,{lanes,catalog:"catalog",profile:"pr-gate",allowLegacy:false,cwd:root});
  assert.equal(verify(records).status,"passed");
  const mutated=patch=>records.map((r,i)=>i===0?{...r,...patch}:r),first=records[0];
  assert.equal(verify(mutated({observations:{total:1,passed:1}})).status,"failed");
  assert.equal(verify(mutated({observations:{...first.observations,tests:first.observations.tests.slice(1)}})).status,"failed");
  for(const status of ["passed","skipped","failed","unknown"])
    assert.equal(verify(mutated({observations:{...first.observations,tests:[...first.observations.tests,{name:"foreign",file:"foreign",status}]}})).status,"failed");
  assert.equal(verify(mutated({inventory:{...first.inventory,expected:[...first.inventory.expected,first.inventory.expected[0]]}})).status,"failed");
  const moved=structuredClone(records),file=moved[0].inventory.expected.shift(),observation=moved[0].observations.tests.shift();
  moved[1].inventory.expected.push(file);moved[1].observations.tests.push(observation);
  assert.equal(verify(moved).status,"passed","harmless rebalancing preserves coverage");
  moved[0].inventory.expected.push(file);moved[0].observations.tests.push(observation);
  assert.equal(verify(moved).status,"failed","overlap fails even with valid per-shard observations");
  const missing=structuredClone(records);missing[0].inventory.expected.shift();missing[0].observations.tests.shift();
  assert.equal(verify(missing).status,"failed","self-consistent omission cannot pass");
});
test("runSuite passes Node partition identity without a Playwright flag and refuses replay credit", async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),"partition-receipt-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  let seen;
  const result=await runSuite(lane,{cwd:root,out:dir,profile:EVIDENCE_PROFILES.PR_GATE,execute:async context=>{
    seen=context;
    const {writeFile}=await import("node:fs/promises");
    await writeFile(context.log,"controlled runner log");
    await writeFile(context.env.RIGHELT_TEST_OBSERVATIONS,JSON.stringify({total:25,passed:25,failed:0,tests:Array.from({length:25},(_,i)=>({name:stressTestName(i*4+1),file:path.join(root,"packages/api-handler/test-stress/sync-schedules.test.mjs"),status:"passed"}))}));
    return {code:0};
  }});
  assert.equal(result.status,"passed");
  assert(result.observations.tests.every(test=>!path.isAbsolute(test.file)));
  assert.equal(seen.env.RIGHELT_NODE_SHARD,"1");assert.equal(seen.env.RIGHELT_NODE_SHARDS,"4");
  assert(!seen.args.some(arg=>arg.startsWith("--shard=")));
  const prior=process.env.T114_SEED;process.env.T114_SEED="1";
  try{await assert.rejects(runSuite(lane,{cwd:root,out:dir,execute:async()=>assert.fail("must not launch")}),/replay cannot produce gate/);}finally{if(prior===undefined)delete process.env.T114_SEED;else process.env.T114_SEED=prior;}
});
test("actual multi-reporter command publishes the first failure while later tests finish", async t => {
  const {spawnSync}=await import("node:child_process");
  const dir=await mkdtemp(path.join(os.tmpdir(),"first-failure-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const fixture=path.join(dir,"failure.test.mjs");
  await writeFile(fixture,'import test from "node:test"; test("first failure",()=>{throw Error("controlled assertion");}); test("later completion",()=>{});');
  const env={...process.env,GITHUB_ACTIONS:"true",GITHUB_SHA:"synthetic-merge",RIGHELT_TEST_REVISION:"tested-head",RIGHELT_TEST_OBSERVATIONS:path.join(dir,"observations.json")};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,["scripts/run-node-tests.mjs",fixture,"--reporter","spec","--reporter",path.join(root,"scripts/testing/node-reporter.mjs"),"--reporter-destination","stdout","--reporter-destination",path.join(dir,"events.txt")],{cwd:root,encoding:"utf8",env});
  assert.equal(child.status,1,child.stderr);
  assert.equal(child.stdout.split("::error::").length-1,1);
  assert(child.stdout.includes("Revision: tested-head"));
  assert(!child.stdout.includes("synthetic-merge"));
  assert(child.stdout.includes("later completion"));
});
test("computer integration inventory includes every configured command file", async()=>{
 const {default:config}=await import("../../../package.json",{with:{type:"json"}});
 const configured=config.scripts["test:computer-player:integration"].split(" ").filter(value=>value.endsWith(".test.mjs")).map(file=>path.resolve(root,file));
 assert.deepEqual(nodeInventory("computer-integration",root).sort(),configured.sort());
 assert.deepEqual(verifyInventory(configured,{tests:configured.map(file=>({file,status:"passed"}))},root).unexpected,[]);
});
