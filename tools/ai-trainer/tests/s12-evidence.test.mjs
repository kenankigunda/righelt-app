import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import packet from './fixtures/s12-handoff-cases.json' with {type:'json'};
import verification from './fixtures/s12-handoff-verification.json' with {type:'json'};
import {validateScopedHandoff} from '../../hosted-compute/development-observations.mjs';
import {prepareDevelopment} from '../../hosted-compute/prepare-development.mjs';
import {sha256} from '../../hosted-compute/policy.mjs';

test('S12 stays one existing unclassified family with unknown actors and no learner/final upgrades',()=>{
 const cases=validateScopedHandoff(packet,verification);assert.equal(cases.length,10);assert(cases.every(c=>c.sourceFamily==='S12'&&c.sourcePurpose==='unclassified'&&c.actorProvenance.kind==='unknown'));
 for(const change of [p=>p.sourcePurpose='exploratory',p=>p.sourceFamily='S13',p=>p.cases[0].sourcePurpose='competitive',p=>p.cases[0].actorProvenance={kind:'computer',profile:'horus'},p=>p.cases[0].learning.heldOut=true,p=>p.cases[0].learning.policyTarget=true,p=>p.cases[0].terminalTargetsQuarantined=false,p=>p.cases[0].training=true,p=>p.cases.find(c=>c.id==='S12-09').referenceOnly.globalAvoidability.status='forced-loss']){
  const changed=structuredClone(packet);change(changed);assert.throws(()=>validateScopedHandoff(changed,verification));
 }
 const repeated=structuredClone(packet),retreat=repeated.cases.find(c=>c.id==='S12-05');retreat.completeRetreatAlternatives[1]=retreat.completeRetreatAlternatives[0];assert.throws(()=>validateScopedHandoff(repeated,verification),/retreat inventory/);
});

test('S12 modern preparation executes all scoped repairs and terminal routes with exact endpoints',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'s12-evidence-'));
 try{
  await fs.copyFile(new URL('./fixtures/s12-handoff-cases.json',import.meta.url),path.join(directory,'handoff-cases.json'));
  await fs.writeFile(path.join(directory,'handoff-verification.json'),JSON.stringify(verification));
  const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const result=await prepareDevelopment(directory,{sourceRevision:revision}),cases=result.receipt.cases,proofs=cases.flatMap(c=>c.witnesses);
  assert.equal(cases.length,10);assert.equal(proofs.length,27);assert(proofs.every(p=>p.disposition==='complete'&&p.expectedOutcomeMatched));
  assert.equal(proofs.reduce((n,p)=>n+p.completedActions,0),71);assert.equal(proofs.reduce((n,p)=>n+p.checkedPredicates.length,0),52);
  for(const c of cases){assert.equal(c.sourcePurpose,'unclassified');assert.equal(c.actorProvenance.kind,'unknown');assert.equal(c.terminalBoundary,'quarantined');assert.equal(c.policyTargetAdmitted,false);assert.equal(c.observedValueTargetAdmitted,false);assert.equal(c.competitiveScoreEligible,false);assert(c.witnesses.every(w=>w.terminalValueP1===null&&w.globalSafetyProven===false));}
  const retreat=cases.find(c=>c.id==='S12-05');assert.equal(retreat.retreatInventory.disposition,'complete');assert.equal(retreat.retreatInventory.actions.length,3);assert(retreat.witnesses.every(w=>w.outcome==='ongoing'));
  const denial=cases.find(c=>c.id==='S12-07');assert(denial.witnesses.some(w=>w.checkedPredicates.some(p=>p.kind==='legal'&&p.expected===false&&p.actual===false)));
  const late=cases.find(c=>c.id==='S12-09');assert.equal(late.referenceOnly.globalAvoidability.status,'unknown');assert.equal(late.referenceOnly.verified,false);
  const prepared=JSON.parse(new TextDecoder().decode(result.packetBytes));assert(prepared.cases.every(c=>c.requests.every(r=>r.expectedEndpointHash&&Array.isArray(r.beforePredicates)&&Array.isArray(r.predicates))));
  assert.equal(result.receipt.trainingAuthorized,false);assert.equal(result.receipt.sourcePacketSha256,'78dd0654eebb27596d6973b85125c8fd8b473d34ac9d2be88e9e386abcefca10');
  // Inventory transport binds original and sanitized bytes separately. This
  // fixture testimony grants no current proof, which comes from replay above.
  const witness=JSON.stringify({schema:1,sourceFamily:'S12',scope:'Historical witness reference only.'});
  await fs.writeFile(path.join(directory,'witness-verification.json'),witness);
  await fs.writeFile(path.join(directory,'handoff-verification.json'),JSON.stringify({...verification,witnessVerificationSha256:await sha256(new TextEncoder().encode(witness))}));
  await fs.writeFile(path.join(directory,'independent-final-review-check.json'),JSON.stringify({packetSha256:result.receipt.sourcePacketSha256,caseCount:10,witnessCount:27,allLearnerFlagsFalse:true}));
  await fs.writeFile(path.join(directory,'analysis.txt'),'Source scope only.');
  const files={};for(const name of ['handoff-cases.json','handoff-verification.json','witness-verification.json','independent-final-review-check.json','analysis.txt']){const bytes=await fs.readFile(path.join(directory,name));files[name]={bytes:bytes.length,sha256:await sha256(bytes)};}
  const inventory={schema:1,kind:'sanitized-development-evidence-inventory',sourceFamily:'S12',sourceRevision:packet.sourceRevision,caseCount:10,sanitization:{schema:1,allowlist:true,originalAccountDeviceGameDecisionIdsAbsent:true},originalHashes:Object.fromEntries(Object.entries(files).map(([name,r])=>[name,r.sha256])),sanitizedFiles:files};
  await fs.writeFile(path.join(directory,'evidence-manifest.json'),JSON.stringify(inventory));
  const inventoried=await prepareDevelopment(directory,{sourceRevision:revision});assert.equal(inventoried.receipt.cases.length,10);assert.equal(inventoried.receipt.originalSourcePacketSha256,result.receipt.sourcePacketSha256);
  await fs.appendFile(path.join(directory,'witness-verification.json'),' ');await assert.rejects(prepareDevelopment(directory,{sourceRevision:revision}),/file identity mismatch/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
