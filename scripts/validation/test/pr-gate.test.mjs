import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {runPRGate} from '../pr-gate.mjs';
import {stagePolicy,defaultLocalPlan} from '../plan.mjs';
import {prGateLanes,laneKey,catalogDigest,suiteKind} from '../../testing/catalog.mjs';
import {sealReceipt} from '../../testing/receipts.mjs';
import {suiteRequestProfile} from '../suite-ci-evidence.mjs';
import {loadCIReceipt} from '../ci-evidence.mjs';
import {evidenceKey,fileDigest} from '../reuse.mjs';
const identity={revision:'a'.repeat(40),baseRevision:'b'.repeat(40),testedTree:'c'.repeat(40),sourceFingerprint:'exact-fixture',sourceClean:true};
function laneReceipt(lane,change={}){return sealReceipt({version:2,catalog:catalogDigest(),lane:laneKey(lane),suite:lane.suite,kind:suiteKind(lane.suite),stateMode:['guest-smoke','auth-smoke'].includes(lane.suite)?'real-stack':'controlled',...identity,runtime:{node:'v22.23.4',pnpm:'9.15.9'},dependencies:{lockHash:'lock',installedLockHash:'installed'},status:'passed',outcome:'passed',failureKind:null,attempt:1,priorReceiptDigest:null,evidenceProfile:'pr-gate',exitCode:0,incomplete:false,dirtyDuringRun:false,inventory:{expected:['actual-controlled-test'],missing:[],unexpected:[]},observations:{total:1,passed:1},...change});}
for(const mutation of [null,'nightly-profile','failed','wrong-lane','missing-base'])test(`PR gate runner ${mutation??'executes exactly its declared gate lanes'}`,async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pr-gate-'));t.after(()=>rm(root,{recursive:true,force:true}));const seen=[];
 const result=await runPRGate({cwd:root,out:'out',identity,executeSuite:async(lane,options)=>{seen.push(lane);assert.equal(options.profile,'pr-gate');assert.equal(options.attempt,1);assert.equal(options.priorReceiptDigest,null);return laneReceipt(lane,seen.length!==1?{}:mutation==='nightly-profile'?{evidenceProfile:'nightly-full'}:mutation==='failed'?{status:'failed',outcome:'failed',exitCode:1}:mutation==='wrong-lane'?{lane:'e2e:webkit:1/2'}:mutation==='missing-base'?{baseRevision:null}:{});}});
 assert.equal(result.status,mutation?'failed':'passed');
 if(!mutation){assert.deepEqual(seen,prGateLanes());for(const suite of ['e2e','storage-lifecycle','auth-e2e','auth-controls','browser-integration','performance'])assert(!seen.some(l=>l.suite===suite));for(const suite of ['guest-smoke','auth-smoke','browser-contract','tooling-browser'])assert(seen.some(l=>l.suite===suite));}
 if(mutation==='failed')assert.equal(seen.length,1,'A failed gate must not launch later lanes');
});
test('PR gate runner refuses missing base before any lane',async()=>{let calls=0;await assert.rejects(runPRGate({identity:{...identity,baseRevision:null},executeSuite:async()=>{calls++;}}),/explicit source base/);assert.equal(calls,0);});
test('final plan defaults to PR gate and explicit fresh/retained questions, not nightly matrix',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'gate-plan-'));t.after(()=>rm(root,{recursive:true,force:true}));const plan=await defaultLocalPlan(root),selected=stagePolicy(plan,0,{accounts:true}).selected;
 assert.deepEqual(selected,['PR gate']);
 const explicit={version:2,questions:[{id:'feature',description:'Specific browser behavior',paths:['apps/'],checks:['E2E','Performance']}]};assert.deepEqual(stagePolicy(explicit,0).selected,['PR gate','Responsive proof','E2E','Performance']);
});
test('PR profile cannot claim broad nightly browser group or accept a renamed command',()=>{
 const profile={id:'pr-gate-v2',evidenceProfile:'pr-gate',lanes:prGateLanes()};
 assert.deepEqual(suiteRequestProfile('PR gate',{argv:['pnpm','test:pr-gate']},profile).ids,[...new Set(prGateLanes().map(l=>l.suite))]);
 for(const[name,script]of[['E2E','test:e2e'],['Auth E2E','test:e2e:auth'],['Performance','test:performance'],['Browser integration','test:browser:integration']])assert.throws(()=>suiteRequestProfile(name,{argv:['pnpm',script]},profile),/profile differs/);
 assert.throws(()=>suiteRequestProfile('PR gate',{argv:['pnpm','test']},profile),/command differ/);
 assert.throws(()=>suiteRequestProfile('PR gate',{argv:['pnpm','test:pr-gate']},{...profile,evidenceProfile:'nightly-full'}),/profile differs/);
});
test('profile-aware receipt loading rejects missing, wrong and mislabelled profile/layout even after resealing',async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'profile-receipt-')));t.after(()=>rm(root,{recursive:true,force:true}));const log=path.join(root,'log'),archive=path.join(root,'archive'),file=path.join(root,'receipt.json');await writeFile(log,'primary');await writeFile(archive,'archive');
 const original={status:'passed',name:'PR gate',source:'github-actions',testedTree:identity.testedTree,argv:['pnpm','test:pr-gate'],evidenceProfile:'pr-gate',layout:'pr-gate-v2',importedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),evidence:[{checkout:identity.revision,provenance:{testedTree:identity.testedTree,checkout:identity.revision,evidenceProfile:'pr-gate',layout:'pr-gate-v2'},log,logHash:await fileDigest(log),archive,archiveHash:await fileDigest(archive)}]};
 const options={name:'PR gate',argv:original.argv,tree:identity.testedTree,evidenceProfile:'pr-gate'};
 for(const mutation of [null,'missing','wrong','layout','provenance','inner-profile','inner-layout']){
  const receipt=structuredClone(original);if(mutation==='missing')delete receipt.evidenceProfile;if(mutation==='wrong')receipt.evidenceProfile='nightly-full';if(mutation==='layout')receipt.layout='legacy-full';if(mutation==='provenance')delete receipt.evidence[0].provenance.evidenceProfile;if(mutation==='inner-profile')receipt.evidence[0].provenance.evidenceProfile='nightly-full';if(mutation==='inner-layout')receipt.evidence[0].provenance.layout='legacy-full';receipt.integrity=evidenceKey(receipt);await writeFile(file,JSON.stringify(receipt));assert.equal(Boolean(await loadCIReceipt(file,options)),mutation===null,mutation??'current profile');
 }
});
