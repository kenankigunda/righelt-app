import test from 'node:test';
import assert from 'node:assert/strict';
import forced from './fixtures/s05-forced-loss-64.json' with {type:'json'};
import push from './fixtures/s05-forcing-push-56.json' with {type:'json'};
import packet from './fixtures/s05-effects-v1.json' with {type:'json'};
import {verifyTurnCertificate} from '../turn-certificate.mjs';
import {verifyWitness} from '../tactical-evidence.mjs';
import {adaptS05,bindS05Certificate} from '../../hosted-compute/s05-observations.mjs';
import guard66 from './fixtures/s05-guard-defense-6-6.json' with {type:'json'};
import guard57 from './fixtures/s05-guard-defense-5-7.json' with {type:'json'};
import diagnostic from './fixtures/s05-search-diagnosis.json' with {type:'json'};
import {diagnoseRetainedSearch} from '../../hosted-compute/search-diagnosis.mjs';
import {prepareDevelopment} from '../../hosted-compute/prepare-development.mjs';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from '../../hosted-compute/policy.mjs';
import {selectMove,SEARCH_POLICY_VERSION} from '../../../packages/computer-player/src/index.ts';
import {decisionProvenance,validateDecisionProvenance} from '../decision-provenance.mjs';
const bounds={milliseconds:10000,maxNodes:10000};

test('known forced-loss root retains honest least-bad selection instead of fabricating a defense',async()=>{
 const r=await selectMove({state:forced.rootState,seed:7,simulations:8,maxNodes:2048},async()=>({policyLogits:new Float32Array(2801),value:0}));
 assert.equal(r.status,'ready');assert.equal(r.reason,'search');
 const record=decisionProvenance(r,SEARCH_POLICY_VERSION);assert.equal(validateDecisionProvenance(record),true);
 // Exercise admission independently of how much this particular search finished.
 // The separate complete certificate, not this mutation, establishes forced loss.
 const allLost=structuredClone(record);for(const a of allLost.search.actions)if(a.immediate==='eligible')a.tactical='proven-loss';
 assert.equal(validateDecisionProvenance(allLost),true);
 const falseSafe=structuredClone(allLost);falseSafe.search.actions.find(a=>a.immediate==='eligible').tactical='incomplete';assert.throws(()=>validateDecisionProvenance(falseSafe),/Ineligible/);
});

test('S05 preparation retains executable predicates and exact endpoints and rejects tampering',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'s05-preparation-'));
 const p={...structuredClone(packet),cases:[structuredClone(packet.cases[0])]},revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const write=async()=>{const bytes=JSON.stringify(p);await fs.writeFile(path.join(directory,'development-cases.json'),bytes);await fs.writeFile(path.join(directory,'verification.json'),JSON.stringify({sourceFamily:'S05',proofs:[],sourceManifests:{original:{sourceRevision:p.sourceRevision},branch:{sourceRevision:p.sourceRevision}},packet:{cases:1},packetSha256:await sha256(new TextEncoder().encode(bytes))}));};
 try{
  await write();const result=await prepareDevelopment(directory,{sourceRevision:revision});
  const prepared=JSON.parse(new TextDecoder().decode(result.packetBytes)),request=prepared.cases[0].requests[0];
  assert.equal(request.expectedEndpointHash,'093db23c30762a60459cd1369c73d88c5499afb2c837b460b06caff3537a4d3c');assert.equal(request.predicates.length,4);assert(request.predicates.some(x=>x.field==='commanded'&&x.expected===false));
  p.cases[0].effects.blueCommandedAfter=6;await write();await assert.rejects(prepareDevelopment(directory,{sourceRevision:revision}),/zero executable witness/);
  p.cases[0].effects.blueCommandedAfter=5;p.cases[0].alternatives[0].endpointHash='0'.repeat(64);await write();await assert.rejects(prepareDevelopment(directory,{sourceRevision:revision}),/zero executable witness/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('retained public128 incompleteness diagnoses legal three-action losses without qualifying a teacher',async()=>{
 const r=await diagnoseRetainedSearch(diagnostic);assert.equal(r.cases.length,2);assert(r.cases.every(c=>c.replyProof.completedActions===3&&c.teacherQualified===false));assert.equal(r.teacherQualified,false);assert.equal(r.currentCandidateSearchReproduced,false);
 const fake=structuredClone(diagnostic);fake.cases[0].selected.tactical='proven-loss';await assert.rejects(diagnoseRetainedSearch(fake),/selection mismatch/);
 const wrong=structuredClone(diagnostic);wrong.cases[1].reply[0].actorId='C2';await assert.rejects(diagnoseRetainedSearch(wrong),/not legal/);
});

test('S05 terminal certificates execute actual retreat controllers and all required alternatives',async()=>{
 for(const [c,n]of [[push,27],[forced,13]]){
  const r=await verifyTurnCertificate(c,bounds);assert.equal(r.disposition,'complete');assert.equal(r.value,true);assert.equal(r.verifiedNodes,n);assert.equal(r.defender,'P2');assert.equal(r.globalSafetyProven,false);assert.equal(r.rootOptimalValueP1,null);
 }
 const missing=structuredClone(forced);missing.nodes.find(n=>n.id===missing.proofRoot).edges.pop();
 await assert.rejects(verifyTurnCertificate(missing,bounds),/missing universal/);
 for(const mutate of [c=>c.nodes[0].controller='P1',c=>c.nodes[0].depth--,c=>c.nodes.find(n=>n.kind==='terminal').kind='turn-boundary',c=>c.status='no-forced-win-in-scope']){
  const changed=structuredClone(forced);mutate(changed);await assert.rejects(verifyTurnCertificate(changed,bounds));
 }
 const prelude=structuredClone(push);prelude.prelude=[{type:'pass'}];await assert.rejects(verifyTurnCertificate(prelude,bounds),/prelude endpoint|illegal/);
 assert.equal((await verifyTurnCertificate(forced,{...bounds,maxNodes:1})).disposition,'incomplete');
});

test('S05-07 different guard retreats lose to different replies and cannot borrow another root proof',async()=>{
 for(const [c,n]of [[guard66,2],[guard57,4]]){
  bindS05Certificate({stateHash:'d5fc12edc2b812d954c8f127f5a4ed9d6741694b9d85b0d9afd30474c95d63ed'},{line:c.prelude},c);
  const p=await verifyTurnCertificate(c,bounds);assert.equal(p.disposition,'complete');assert.equal(p.value,true);assert.equal(p.verifiedNodes,n);assert.equal(p.globalSafetyProven,false);
 }
 assert.throws(()=>bindS05Certificate({stateHash:guard66.beforeHash},{line:guard66.prelude},push),/case\/prelude/);
});

test('S05 endpoint predicates distinguish command denial, group change, attack legality and completed rescue',async()=>{
 const verification={sourceFamily:'S05',packet:{cases:packet.cases.length},sourceManifests:{original:{sourceRevision:packet.sourceRevision},branch:{sourceRevision:packet.sourceRevision}}};
 const rows=adaptS05(packet,verification),proofs=[];
 for(const c of rows)for(const r of c.scopedRequests){
  const p=await verifyWitness({state:c.state,stateHash:c.stateHash,...r,maxActions:32,milliseconds:10000,maxOperations:10000});
  assert.equal(p.disposition,'complete');assert.equal(p.expectedOutcomeMatched,true);if(r.expectedEndpointHash)assert.equal(p.finalHash,r.expectedEndpointHash);proofs.push(p);
 }
 const rescue=proofs.find(p=>p.requestedActions===7&&p.outcome==='ongoing');assert(rescue);assert.deepEqual(rescue.steps.map(s=>s.controller),['P2','P1','P1','P1','P1','P1','P1']);
 assert(proofs.some(p=>p.checkedPredicates.some(x=>x.kind==='group'&&x.actual===1)));
 const c=rows[0],r=c.scopedRequests[0];
 await assert.rejects(verifyWitness({state:c.state,stateHash:c.stateHash,...r,predicates:[{kind:'piece',id:'U2-8',field:'commanded',expected:true}],maxActions:32,milliseconds:10000,maxOperations:10000}),/predicate mismatch/);
 await assert.rejects(verifyWitness({state:c.state,stateHash:c.stateHash,...r,expectedEndpointHash:'0'.repeat(64),maxActions:32,milliseconds:10000,maxOperations:10000}),/endpoint mismatch/);
 for(const predicate of [{kind:'group',id:'missing'},{kind:'group',id:'C2'},{kind:'piece',id:'C2',field:'supplied'},{kind:'legal',action:{type:'project'},expected:false}])await assert.rejects(verifyWitness({state:c.state,stateHash:c.stateHash,...r,predicates:[predicate],maxActions:32,milliseconds:10000,maxOperations:10000}));
 const admitted=structuredClone(packet);admitted.cases[0].learnerEligibility.training=true;assert.throws(()=>adaptS05(admitted,verification),/admission/);
});
