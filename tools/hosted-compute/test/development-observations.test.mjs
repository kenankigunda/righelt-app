import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fixture from './fixtures/development-observations-v1.json' with {type:'json'};
import {adaptDevelopmentObservations,validateEvidenceInventory} from '../development-observations.mjs';
import {prepareDevelopment} from '../prepare-development.mjs';
import {canonical,encode,sha256} from '../policy.mjs';

const verification=packet=>({schema:1,sourceFamily:'S11',sourceRevision:packet.sourceRevision,developmentCaseCount:packet.cases.length});

test('versioned observation adapter keeps explicit family, actor and unverified effects separate',()=>{
 const cases=adaptDevelopmentObservations(fixture,verification(fixture));
 assert.deepEqual(cases.map(c=>c.id),['S11-20','S11-70','S11-77']);
 assert.equal(cases[0].sourceFamily,'S11');assert.equal(cases[0].actorProvenance.kind,'computer');assert.equal(cases[2].actorProvenance.kind,'human');
 assert.equal(cases[0].scopedRequests[0].actions[0].type,'project');
 assert.equal(cases[0].scopedRequests[0].referenceOnly.verified,false);assert.equal(cases[0].scopedRequests[0].referenceOnly.claims.redCommanded,8);
 assert(cases.every(c=>c.terminalTargetsQuarantined&&c.sourceHistoryFinalityVerified===false));
 for(const change of [p=>p.schema=2,p=>p.kind='unknown-kind',p=>p.sourceFamily='fresh-family',p=>p.cases[0].alternatives=[],p=>p.cases[0].alternatives[0].line=[],p=>p.cases[0].learnerEligibility.historicalPolicy=true,p=>p.cases[0].alternatives[0].accountEmail='private@example',p=>p.cases[0].alternatives[0].line[0].authorization='secret',p=>p.cases[1].alternatives[0].blockedProjection.authorization='secret']){
  const changed=structuredClone(fixture);change(changed);assert.throws(()=>adaptDevelopmentObservations(changed,verification(changed)));
 }
 assert.throws(()=>adaptDevelopmentObservations(fixture,{...verification(fixture),sourceFamily:'S12'}),/S11/);
});

test('preparation executes supplied engine lines without admitting S11 finality or numeric effect claims',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-observations-'));
 const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 async function write(packet){const bytes=encode(canonical(packet));await fs.writeFile(path.join(directory,'development-cases.json'),bytes);await fs.writeFile(path.join(directory,'verification.json'),canonical({...verification(packet),packetSha256:await sha256(bytes)}));}
 try{
  await write(fixture);const result=await prepareDevelopment(directory,{sourceRevision,milliseconds:5000,maxOperations:10000});
  assert.equal(result.receipt.cases.length,3);assert.equal(result.receipt.trainingAuthorized,false);
  const repair=result.receipt.cases.find(c=>c.id==='S11-20');assert.equal(repair.witnesses[0].disposition,'complete');assert.equal(repair.witnesses[0].completedActions,1);assert.equal(repair.witnesses[0].outcome,'ongoing');
  const guard=result.receipt.cases.find(c=>c.id==='S11-70');assert(guard.witnesses.some(w=>w.outcome==='p2_win'&&w.completedActions===2));
  for(const c of result.receipt.cases){
   assert.equal(c.sourceFamily,'S11');assert.equal(c.terminalBoundary,'quarantined');assert.equal(c.sourceHistoryFinalityVerified,false);
   assert.equal(c.policyTargetAdmitted,false);assert.equal(c.observedValueTargetAdmitted,false);assert.equal(c.competitiveScoreEligible,false);
   assert(c.witnesses.every(w=>w.terminalValueP1===null));assert(c.alternativeClaims.every(r=>r.verified===false&&r.disposition==='reference-only'));
  }
  const sanitized=JSON.parse(new TextDecoder().decode(result.packetBytes));assert(!JSON.stringify(sanitized).includes('fd5540'));
  const referenced=structuredClone(fixture),row=referenced.cases.find(c=>c.display===70),alternative=row.alternatives[1];
  alternative.oneOpposingTurnCertificate='G47-cut-2-certificate.json';
  const certificate={schema:1,id:'G47-cut-2',beforeHash:row.rootStateHash,line:alternative.line,rootHash:'0'.repeat(64),nodes:[]};
  const certificateBytes=encode(canonical(certificate));await fs.writeFile(path.join(directory,'G47-cut-2-certificate.json'),certificateBytes);
  const packetBytes=encode(canonical(referenced));await fs.writeFile(path.join(directory,'development-cases.json'),packetBytes);
  await fs.writeFile(path.join(directory,'verification.json'),canonical({...verification(referenced),packetSha256:await sha256(packetBytes),replyCertificateSha256:await sha256(certificateBytes)}));
  const referenceResult=await prepareDevelopment(directory,{sourceRevision});
  const referencedCase=referenceResult.receipt.cases.find(c=>c.id==='S11-70');assert.equal(referencedCase.defense,null);assert.equal(referencedCase.referenceCertificates[0].replayed,false);assert.equal(referencedCase.referenceCertificates[0].disposition,'reference-only');
  const invalid=structuredClone(fixture);invalid.cases[0].alternatives[0].line[0].actorId='not-a-piece';await write(invalid);
  await assert.rejects(prepareDevelopment(directory,{sourceRevision}),/zero executable witness/);
  await write(fixture);await assert.rejects(prepareDevelopment(directory,{sourceRevision,maxOperations:1}),/zero executable witness/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('sanitized inventory keeps actual file identities separate from original evidence hashes',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-sanitized-observations-'));
 const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 try{
  const packet=structuredClone(fixture),originalPacketSha256=await sha256(encode(canonical(packet)));
  packet.sourcePacketSha256=originalPacketSha256;packet.sanitizationSchema=1;
  const row=packet.cases.find(c=>c.display===70),alternative=row.alternatives[1];alternative.oneOpposingTurnCertificate='one-opposing-turn-certificate.json';
  const originalCertificateSha256=await sha256(encode('original-certificate'));
  const retained=encode(canonical({...verification(packet),packetSha256:originalPacketSha256,replyCertificateSha256:originalCertificateSha256}));
  const files={'development-cases.json':encode(canonical(packet)),'one-opposing-turn-certificate.json':encode(canonical({schema:1,caseId:row.id,beforeHash:row.rootStateHash,line:alternative.line,rootHash:'0'.repeat(64),nodes:[]})),'retained-verification.json':retained};
  const sanitizedFiles={};for(const [name,bytes]of Object.entries(files)){await fs.writeFile(path.join(directory,name),bytes);sanitizedFiles[name]={sha256:await sha256(bytes),bytes:bytes.length};}
  const inventory={schema:1,kind:'sanitized-development-evidence-inventory',sourceFamily:'S11',sourceRevision:packet.sourceRevision,caseCount:packet.cases.length,
   originalHashes:{'development-cases.json':originalPacketSha256,'G47-cut-2-certificate.json':originalCertificateSha256,'verification.json':await sha256(retained)},
   sanitizedFiles,sanitization:{schema:1,allowlist:true,originalIdsRemoved:true}};
  validateEvidenceInventory(inventory);
  const save=async value=>fs.writeFile(path.join(directory,'evidence-manifest.json'),canonical(value));await save(inventory);
  const result=await prepareDevelopment(directory,{sourceRevision});
  assert.equal(result.receipt.sourcePacketSha256,sanitizedFiles['development-cases.json'].sha256);assert.equal(result.receipt.originalSourcePacketSha256,originalPacketSha256);assert.notEqual(result.receipt.sourcePacketSha256,originalPacketSha256);
  assert.equal(result.receipt.sanitizedFiles['retained-verification.json'].sha256,inventory.originalHashes['verification.json']);
  for(const mutate of [m=>m.schema=2,m=>m.kind='unknown',m=>m.sourceFamily='S12',m=>m.caseCount=1,m=>m.sanitizedFiles['development-cases.json'].bytes++,m=>m.sanitizedFiles['one-opposing-turn-certificate.json'].bytes++,m=>m.originalHashes['development-cases.json']='0'.repeat(64)]){
   const changed=structuredClone(inventory);mutate(changed);await save(changed);await assert.rejects(prepareDevelopment(directory,{sourceRevision}));
  }
  await save(inventory);await fs.writeFile(path.join(directory,'retained-verification.json'),encode('{}'));await assert.rejects(prepareDevelopment(directory,{sourceRevision}),/identity mismatch/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
