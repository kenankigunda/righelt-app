// Local prepared evidence only. Never connects to production or provisions hosts.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {verifyTurnCertificate} from '../ai-trainer/turn-certificate.mjs';
import {bindS05Certificate} from './s05-observations.mjs';
import {diagnoseRetainedSearch} from './search-diagnosis.mjs';
import { verifyWitness, verifyTurnDefense } from '../ai-trainer/tactical-evidence.mjs';
import { assert, canonical, encode, sha256 } from './policy.mjs';
import { LEARNING_EVIDENCE_CONTRACT, sourceQualification } from './data-contract.mjs';
import { adaptDevelopmentObservations,validateEvidenceInventory,validateScopedHandoff } from './development-observations.mjs';

export async function prepareDevelopment(directory, {sourceRevision,milliseconds=5000,maxActions=32,maxOperations=10000}={}) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const sourceDirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0;
  const actualRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  assert(sourceRevision===actualRevision,'verifier source revision mismatch');
  const sourceFiles=execFileSync('git',['ls-files','packages/game-engine/src','packages/shared-types/src','packages/computer-player/src'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  sourceFiles.push('tools/ai-trainer/tactical-evidence.mjs','tools/ai-trainer/turn-certificate.mjs','tools/hosted-compute/s05-observations.mjs','tools/hosted-compute/search-diagnosis.mjs','tools/hosted-compute/prepare-development.mjs','tools/hosted-compute/development-observations.mjs','tools/hosted-compute/data-contract.mjs');
  const inventory={};for(const name of sourceFiles)inventory[name]=await sha256(readFileSync(path.join(root,name)));
  const contractBytes=readFileSync(path.join(root,'tools/ai-trainer/learning-evidence-contract.json'));
  const sourceInventorySha256=await sha256(encode(canonical(inventory)));
  const loaded=new Map();
  const load=name=>{assert(typeof name==='string'&&/^(?:proofs\/)?[a-zA-Z0-9._-]+$/.test(name)&&!['.','..'].includes(name),'unsafe proof name');if(!loaded.has(name))loaded.set(name,readFileSync(path.join(directory,name)));return loaded.get(name);};
  const optional=name=>{try{return load(name);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const evidenceBytes=optional('evidence-manifest.json'),evidence=evidenceBytes?validateEvidenceInventory(JSON.parse(evidenceBytes)):null,usedFiles={};
  const boundFile=async name=>{const bytes=load(name),record=evidence.sanitizedFiles[name];assert(record&&record.bytes===bytes.length&&record.sha256===await sha256(bytes),'sanitized evidence file identity mismatch');usedFiles[name]=record;return bytes;};
  const modernInventory=evidence?.sourceFamily==='S12';
  const observations=modernInventory?null:evidence?await boundFile('development-cases.json'):optional('development-cases.json'),modern=observations?null:modernInventory?await boundFile('handoff-cases.json'):optional('handoff-cases.json');
  const raw=observations??modern??load('curation-proposal.json'),packet=JSON.parse(raw);
  const verificationBytes=modernInventory?await boundFile('handoff-verification.json'):evidence?await boundFile('retained-verification.json'):load(modern?'handoff-verification.json':'verification.json'),verification=JSON.parse(verificationBytes);
  const s05=packet.sourceFamily==='S05';
  if(modernInventory){
    for(const name of Object.keys(evidence.sanitizedFiles))await boundFile(name);
    assert(evidence.sourceRevision===packet.sourceRevision&&evidence.caseCount===packet.cases.length&&await sha256(raw)===evidence.originalHashes['handoff-cases.json']&&verification.casePacketSha256===evidence.originalHashes['handoff-cases.json'],'S12 immutable packet/source ancestry differs');
    for(const name of ['handoff-verification.json','witness-verification.json','independent-final-review-check.json'])assert(await sha256(load(name))===evidence.originalHashes[name],'S12 immutable source verification differs');
    const review=JSON.parse(load('independent-final-review-check.json'));
    assert(verification.witnessVerificationSha256===evidence.originalHashes['witness-verification.json']&&review.packetSha256===verification.casePacketSha256&&review.caseCount===10&&review.witnessCount===27&&review.allLearnerFlagsFalse===true,'S12 retained witness/review ancestry differs');
  }else if(evidence&&s05){
    assert(packet.sanitizationSchema===1&&packet.sourceRevision===evidence.sourceRevision&&packet.cases.length===evidence.caseCount&&verification.packet.cases===evidence.caseCount&&Object.values(verification.sourceManifests??{}).every(m=>m.sourceRevision===evidence.sourceRevision),'S05 sanitized inventory mismatch');
    assert(verification.packet.sha256===packet.sourcePacketSha256&&packet.sourcePacketSha256===evidence.originalHashes['development-cases.json'],'S05 source ancestry mismatch');
    for(const name of Object.keys(evidence.sanitizedFiles))await boundFile(name);
  }else if(evidence){
    assert(packet.sanitizationSchema===1&&packet.sourceRevision===evidence.sourceRevision&&packet.cases?.length===evidence.caseCount&&verification.developmentCaseCount===evidence.caseCount&&verification.sourceRevision===evidence.sourceRevision,'sanitized inventory source or case count mismatch');
    assert(await sha256(verificationBytes)===evidence.originalHashes['verification.json']&&verification.packetSha256===packet.sourcePacketSha256&&packet.sourcePacketSha256===evidence.originalHashes['development-cases.json']&&verification.replyCertificateSha256===evidence.originalHashes['G47-cut-2-certificate.json'],'original and sanitized evidence ancestry mismatch');
  }else assert(await sha256(raw)===(observations?verification.packetSha256:modern?verification.casePacketSha256:verification.proposalSha256),'development packet checksum mismatch');
  const s12=modern&&(packet.kind==='scoped-tactical-handoff'||packet.sourceFamily==='S12'||verification.sourceFamily==='S12');
  const inputCases=s12?validateScopedHandoff(packet,verification):observations?adaptDevelopmentObservations(packet,verification,{certificateNames:evidence?['one-opposing-turn-certificate.json']:['G47-cut-2-certificate.json']}):packet.cases;
  const proofFiles=s05?Object.fromEntries(verification.proofs.map(p=>[p.file,p.sha256])):observations?Object.fromEntries([...new Set(inputCases.flatMap(c=>c.referenceCertificates.map(r=>r.name)))].map(name=>{
    if(evidence){assert(name==='one-opposing-turn-certificate.json','unsupported sanitized certificate binding');return [name,evidence.sanitizedFiles[name].sha256];}
    assert(name==='G47-cut-2-certificate.json'&&/^[a-f0-9]{64}$/.test(verification.replyCertificateSha256),'unsupported observation certificate binding');return [name,verification.replyCertificateSha256];
  })):modern?verification.proofFiles:{'S10-defense-certificate.json':verification.certificateSha256};
  for(const [name,hash] of Object.entries(proofFiles)) {
    assert(/^(?:proofs\/)?[a-zA-Z0-9._-]+$/.test(name),'unsafe proof name');
    assert(await sha256(evidence?await boundFile(name):load(name))===hash,'retained proof checksum mismatch');
  }
  const cases=[], preparedCases=[];
  for(const c of inputCases) {
    const qualification=sourceQualification({sourcePurpose:c.sourcePurpose??'exploratory',sourceFamily:c.sourceFamily??(c.id.startsWith('G')?'S08':c.id.split('-')[0]),
      actorProvenance:c.actorProvenance??{kind:c.observedComputerProof||c.observedComputerAction?'computer':'unknown'},
      label:{category:'strategic-diagnostic',scope:c.scope??c.classification??'Retained development witness, no global safety or optimality claim.'}});
    const witnesses=[],requests=[];
    const add=async(name,actions,expectedOutcome,options={})=>{
      requests.push({name,actions,expectedOutcome,...options});
      try {
        const proof=await verifyWitness({state:c.state,stateHash:c.stateHash,actions,expectedOutcome,maxActions,milliseconds,maxOperations,...options});
        if((observations||s12)&&expectedOutcome!==null&&proof.disposition==='complete')assert(proof.expectedOutcomeMatched,'observation witness outcome mismatch');
        witnesses.push({name,...proof,...(c.terminalTargetsQuarantined?{terminalValueP1:null,terminalValueScope:'not-admitted-exposed-development',sourceHistoryFinalityVerified:false}:{})});
      }
      catch(error){witnesses.push({name,disposition:'quarantined',reason:error.message,winningContinuation:false,terminalValueP1:null});}
    };
    for(const request of c.scopedRequests??[])await add(request.name,request.actions,request.expectedOutcome,{expectedEndpointHash:request.expectedEndpointHash,predicates:request.predicates,beforePredicates:request.beforePredicates});
    if(c.winningLine)await add('winning-line',c.winningLine,c.state.sideToMove==='P1'?'p1_win':'p2_win');
    if(c.blueSequence)await add('escape-predicate',[...c.blueSequence,packet.cases.find(x=>x.id==='G54-no-retreat-push').winningLine[0]],'ongoing');
    if(c.observedAlternative)await add('observed-alternative',[c.observedAlternative,{type:'end_turn'}],'ongoing');
    if(c.redSequence){
      await add('supply-race-blue-finish',[...c.redSequence,...c.subsequentBlueWin],'p2_win');
      await add('supply-race-if-blue-passes',[...c.redSequence,...c.ifBluePassesRedWins],'p1_win');
      await add('relocated-endpoint',c.nonwinningUpperShortcut,'ongoing');
    }
    if(c.nonwinningLine)await add('corner-near-miss',c.nonwinningLine,'ongoing');
    if(c.variation)await add('commander-preparation',c.variation,'ongoing');
    for(const name of ['observedProjection','alternativeCommanderMove','observedComputerAction'])if(c[name])await add(name,[c[name]],'ongoing');
    if(c.winningReply)await add('observed-choice-then-opponent-win',[c.observedAction,...c.winningReply],c.state.sideToMove==='P1'?'p2_win':'p1_win');
    if(c.proofs)for(const [i,p]of c.proofs.entries())await add(`forced-loss-choice-${i}`,[p.action,...p.winningReply],c.state.sideToMove==='P1'?'p2_win':'p1_win');
    let defense=null, certificateInput;
    const referenceCertificates=[];
    for(const reference of c.referenceCertificates??[]){
      const bytes=load(reference.name),certificate=JSON.parse(bytes);
      if(s05){
        assert(Object.hasOwn(proofFiles,reference.name),'unbound S05 certificate');
        bindS05Certificate(c,reference,certificate);
        const proof=await verifyTurnCertificate(certificate,{milliseconds,maxNodes:maxOperations});
        referenceCertificates.push({name:reference.name,sha256:await sha256(bytes),...proof,replayed:proof.disposition==='complete'});
        continue;
      }
      assert(Object.hasOwn(proofFiles,reference.name)&&certificate.schema===1&&certificate.beforeHash===c.stateHash&&canonical(certificate.line)===canonical(reference.line)&&(!evidence||certificate.caseId===c.referenceCaseId),'reference certificate root or prelude differs');
      referenceCertificates.push({name:reference.name,sha256:await sha256(bytes),disposition:'reference-only',checksumVerified:true,replayed:false,reason:'unsupported-two-action-prelude-certificate-v1'});
    }
    if(c.defenseCertificate){
      try{const bytes=load(c.defenseCertificate);const original=JSON.parse(bytes);certificateInput=Object.fromEntries(Object.entries(original).filter(([key])=>!['alias','display','verifiedNodes'].includes(key)));defense={...await verifyTurnDefense(JSON.parse(bytes),{milliseconds,maxNodes:maxOperations}),certificateSha256:await sha256(bytes)};}
      catch(error){defense={disposition:'quarantined',reason:error.message,globalSafetyProven:false,terminalValueP1:null};}
    }
    if(observations||s12)assert(witnesses.some(w=>w.disposition==='complete')||referenceCertificates.some(p=>p.disposition==='complete'),'observation case has zero executable witness coverage');
    let retreatInventory=null;
    if(s12&&c.completeRetreatAlternatives){
      const retreats=c.scopedRequests.map(r=>r.actions[1]);
      assert(new Set(retreats.map(canonical)).size===3&&c.scopedRequests.every(r=>r.actions.length===3&&r.actions[0].type==='push'&&r.actions[1].type==='retreat'&&r.actions[2].type==='follow')&&canonical(retreats.map(canonical).sort())===canonical(c.completeRetreatAlternatives.map(canonical).sort()),'S12 retreat claims differ from executed alternatives');
      const complete=witnesses.length===3&&witnesses.every(w=>w.disposition==='complete'&&w.steps[1].legalAlternatives===3&&w.steps[2].legalAlternatives===1&&w.outcome==='ongoing')&&new Set(witnesses.map(w=>w.steps[1].beforeHash)).size===1;
      retreatInventory={disposition:complete?'complete':'incomplete',rootHash:complete?witnesses[0].steps[1].beforeHash:null,controller:complete?witnesses[0].steps[1].controller:null,actions:retreats,globalSafetyProven:false,scope:'All legal retreats after the specified push survive its sole Follow completion only.'};
    }
    const referenceOnly=s12?{referenceOnly:{...c.referenceOnly,disposition:'reference-only',verified:false},sourceHistoryFinalityVerified:false,retreatInventory}:observations?{referenceOnly:c.referenceOnly,alternativeClaims:c.scopedRequests.map(r=>({name:r.name,...r.referenceOnly})),referenceCertificates,sourceHistoryFinalityVerified:false}:{};
    preparedCases.push({id:c.id,state:c.state,stateHash:c.stateHash,...qualification,requests,certificate:certificateInput,...referenceOnly});
    cases.push({id:c.id,state:c.state,stateHash:c.stateHash,...qualification,witnesses,defense,
      originalScope:c.scope??c.defenseScope??c.classification??null,
      originalMinimality:c.minimalActionsWithinSpecifiedPushBranch?{actions:c.minimalActionsWithinSpecifiedPushBranch,scope:'specified-push-branch-only',reverified:false}:null,
      terminalBoundary:c.terminalTargetsQuarantined||c.productionTerminalBoundary||verification.boundaryQuarantines?.some(b=>b.alias===c.id.split('-')[0])?'quarantined':'not-admitted',
      policyTargetAdmitted:false,observedValueTargetAdmitted:false,competitiveScoreEligible:false,...referenceOnly});
  }
  const sourcePacketSha256=await sha256(raw);
  const searchDiagnosis=s05&&evidence?.sanitizedFiles['search-diagnosis.json']?await diagnoseRetainedSearch(JSON.parse(await boundFile('search-diagnosis.json')),{milliseconds,maxOperations}):null;
  const provenance=evidence?{evidenceInventorySha256:await sha256(evidenceBytes),originalSourcePacketSha256:modernInventory?verification.casePacketSha256:packet.sourcePacketSha256,sanitizedFiles:usedFiles}:{};
  const packetBytes=encode(canonical({schema:1,kind:'prepared-development',sourcePacketSha256,...provenance,cases:preparedCases})+'\n');
  const packetSha256=await sha256(packetBytes);
  const receipt={schema:1,kind:'development-evidence',sourceRevision,sourceDirty,sourceInventorySha256,originalSourceRevision:packet.sourceRevision,
    sourcePacketSha256,packetSha256,contractSha256:await sha256(contractBytes),...provenance,
    bounds:{milliseconds,maxActions,maxOperations},cases,...(s05?{searchDiagnosis,teacherQualified:false,qualificationBlockers:searchDiagnosis?.qualificationBlockers??['Retained public-search misses require source-bound executed diagnosis before teacher qualification.']}:{}),trainingAuthorized:false,publicBudgetsChanged:false};
  const receiptBytes=encode(canonical(receipt)+'\n');
  return {receipt,receiptBytes,packetBytes,packetSha256,contractBytes,receiptSha256:await sha256(receiptBytes)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [directory,sourceRevision,output]=process.argv.slice(2);
  assert(directory&&sourceRevision&&output,'Usage: prepare-development.mjs PREPARED_PACKET_DIR VERIFIER_SOURCE_REVISION NEW_RECEIPT_JSON');
  const result=await prepareDevelopment(directory,{sourceRevision});
  writeFileSync(output+'.packet.json',result.packetBytes,{flag:'wx',mode:0o600});
  writeFileSync(output+'.contract.json',result.contractBytes,{flag:'wx',mode:0o600});
  writeFileSync(output,result.receiptBytes,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({cases:result.receipt.cases.length,packetSha256:result.packetSha256,contractSha256:result.receipt.contractSha256,receiptSha256:await sha256(readFileSync(output)),quarantined:result.receipt.cases.flatMap(c=>c.witnesses).filter(w=>w.disposition!=='complete').length}));
}
