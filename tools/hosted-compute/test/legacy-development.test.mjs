import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import packet from './fixtures/legacy-development-review-v1.json' with {type:'json'};
import {adaptLegacyDevelopment} from '../legacy-development.mjs';
import {prepareDevelopment} from '../prepare-development.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
const verification={schema:1,sourceRevision:packet.sourceRevision,cases:5};
test('retained legacy review preserves scoped claims without inventing continuation goals',()=>{
 const cases=adaptLegacyDevelopment(packet,verification);
 assert.equal(cases.length,5);assert(cases.every(c=>c.sourceFamily===packet.familyId&&c.sourcePurpose==='unclassified'&&c.actorProvenance.kind==='human'&&c.terminalTargetsQuarantined&&c.sourceHistoryFinalityVerified===false));
 assert.deepEqual(cases[0].scopedRequests[0].predicates,[{kind:'count',owner:'P1',field:'commanded',expected:5},{kind:'count',owner:'P1',field:'supplied',expected:14},{kind:'count',owner:'P2',field:'commanded',expected:9},{kind:'count',owner:'P2',field:'supplied',expected:9}]);
 assert.deepEqual(cases[2].referenceOnly.claims.opposingContinuationProof,packet.cases[2].opposingContinuationProof);
 assert.deepEqual(cases[3].referenceOnly.claims.proofs,packet.cases[3].proofs);
 assert.equal(cases[3].referenceOnly.claims.acceptableActionSetComplete,false);
 for(const c of cases.slice(2,4))assert(c.scopedRequests.every(r=>r.actions.length===1&&r.expectedOutcome===null&&!r.expectedEndpointHash&&!r.predicates));
 assert.equal(cases[4].scopedRequests[0].expectedOutcome,'p1_win');
 for(const mutate of [p=>p.kind='unknown',p=>p.humanControlled=false,p=>p.cases[0].controller='P1',p=>p.cases[1].id=p.cases[0].id,p=>p.cases[0].retreatSemantics='old',p=>p.cases[3].acceptableActionSetComplete=true]){const bad=structuredClone(packet);mutate(bad);assert.throws(()=>adaptLegacyDevelopment(bad,verification));}
});
test('cases.json front door binds real-shaped verification and executes only supplied goals',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-legacy-review-')),sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const write=async p=>{const bytes=canonical(p)+'\n';await fs.writeFile(path.join(directory,'cases.json'),bytes);await fs.writeFile(path.join(directory,'verification.json'),canonical({...verification,packetSha256:await sha256(encode(bytes))}));};
 try{
  await write(packet);const result=await prepareDevelopment(directory,{sourceRevision});
  // Retain outputs before any postflight assertion, including failure diagnostics.
  await fs.writeFile(path.join(directory,'prepared.json'),result.packetBytes);await fs.writeFile(path.join(directory,'receipt.json'),result.receiptBytes);
  const prepared=JSON.parse(new TextDecoder().decode(result.packetBytes));assert.equal(prepared.cases.length,5);
  for(const c of result.receipt.cases){assert(c.witnesses.every(w=>w.disposition==='complete'&&w.completedActions===1&&w.terminalValueP1===null));assert.equal(c.policyTargetAdmitted,false);assert.equal(c.observedValueTargetAdmitted,false);assert.equal(c.competitiveScoreEligible,false);assert.equal(c.sourceHistoryFinalityVerified,false);}
  assert.equal(result.receipt.cases[0].witnesses[0].checkedPredicates.length,8);assert.equal(result.receipt.cases[1].witnesses[0].checkedPredicates.length,8);assert.equal(result.receipt.cases[4].witnesses[0].outcome,'p1_win');
  assert(prepared.cases.every(c=>Object.values(c.learnerEligibility).every(x=>x===false)));
  await fs.writeFile(path.join(directory,'cases.json'),canonical({...packet,humanControlled:false}));await assert.rejects(prepareDevelopment(directory,{sourceRevision}),/checksum/);
  const bad=structuredClone(packet);bad.cases[0].observedAfter.P1.commanded=6;await write(bad);await assert.rejects(prepareDevelopment(directory,{sourceRevision}),/zero executable witness/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
