// Local prepared evidence only. Never connects to production or provisions hosts.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyWitness, verifyTurnDefense } from '../ai-trainer/tactical-evidence.mjs';
import { assert, canonical, encode, sha256 } from './policy.mjs';
import { LEARNING_EVIDENCE_CONTRACT, sourceQualification } from './data-contract.mjs';
import { adaptDevelopmentObservations,validateEvidenceInventory } from './development-observations.mjs';

export async function prepareDevelopment(directory, {sourceRevision,milliseconds=5000,maxActions=32,maxOperations=10000}={}) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const sourceDirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0;
  const actualRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  assert(sourceRevision===actualRevision,'verifier source revision mismatch');
  const sourceFiles=execFileSync('git',['ls-files','packages/game-engine/src','packages/shared-types/src','packages/computer-player/src'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  sourceFiles.push('tools/ai-trainer/tactical-evidence.mjs','tools/hosted-compute/prepare-development.mjs','tools/hosted-compute/development-observations.mjs','tools/hosted-compute/data-contract.mjs');
  const inventory={};for(const name of sourceFiles)inventory[name]=await sha256(readFileSync(path.join(root,name)));
  const contractBytes=readFileSync(path.join(root,'tools/ai-trainer/learning-evidence-contract.json'));
  const sourceInventorySha256=await sha256(encode(canonical(inventory)));
  const loaded=new Map();
  const load=name=>{assert(typeof name==='string'&&/^[a-zA-Z0-9._-]+$/.test(name)&&!['.','..'].includes(name),'unsafe proof name');if(!loaded.has(name))loaded.set(name,readFileSync(path.join(directory,name)));return loaded.get(name);};
  const optional=name=>{try{return load(name);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const evidenceBytes=optional('evidence-manifest.json'),evidence=evidenceBytes?validateEvidenceInventory(JSON.parse(evidenceBytes)):null,usedFiles={};
  const boundFile=async name=>{const bytes=load(name),record=evidence.sanitizedFiles[name];assert(record&&record.bytes===bytes.length&&record.sha256===await sha256(bytes),'sanitized evidence file identity mismatch');usedFiles[name]=record;return bytes;};
  const observations=evidence?await boundFile('development-cases.json'):optional('development-cases.json'),modern=observations?null:optional('handoff-cases.json');
  const raw=observations??modern??load('curation-proposal.json'),packet=JSON.parse(raw);
  const verificationBytes=evidence?await boundFile('retained-verification.json'):load(modern?'handoff-verification.json':'verification.json'),verification=JSON.parse(verificationBytes);
  if(evidence){
    assert(packet.sanitizationSchema===1&&packet.sourceRevision===evidence.sourceRevision&&packet.cases?.length===evidence.caseCount&&verification.developmentCaseCount===evidence.caseCount&&verification.sourceRevision===evidence.sourceRevision,'sanitized inventory source or case count mismatch');
    assert(await sha256(verificationBytes)===evidence.originalHashes['verification.json']&&verification.packetSha256===packet.sourcePacketSha256&&packet.sourcePacketSha256===evidence.originalHashes['development-cases.json']&&verification.replyCertificateSha256===evidence.originalHashes['G47-cut-2-certificate.json'],'original and sanitized evidence ancestry mismatch');
  }else assert(await sha256(raw)===(observations?verification.packetSha256:modern?verification.casePacketSha256:verification.proposalSha256),'development packet checksum mismatch');
  const inputCases=observations?adaptDevelopmentObservations(packet,verification,{certificateNames:evidence?['one-opposing-turn-certificate.json']:['G47-cut-2-certificate.json']}):packet.cases;
  const proofFiles=observations?Object.fromEntries([...new Set(inputCases.flatMap(c=>c.referenceCertificates.map(r=>r.name)))].map(name=>{
    if(evidence){assert(name==='one-opposing-turn-certificate.json','unsupported sanitized certificate binding');return [name,evidence.sanitizedFiles[name].sha256];}
    assert(name==='G47-cut-2-certificate.json'&&/^[a-f0-9]{64}$/.test(verification.replyCertificateSha256),'unsupported observation certificate binding');return [name,verification.replyCertificateSha256];
  })):modern?verification.proofFiles:{'S10-defense-certificate.json':verification.certificateSha256};
  for(const [name,hash] of Object.entries(proofFiles)) {
    assert(/^[a-zA-Z0-9._-]+$/.test(name),'unsafe proof name');
    assert(await sha256(evidence?await boundFile(name):load(name))===hash,'retained proof checksum mismatch');
  }
  const cases=[], preparedCases=[];
  for(const c of inputCases) {
    const qualification=sourceQualification({sourcePurpose:c.sourcePurpose??'exploratory',sourceFamily:c.sourceFamily??(c.id.startsWith('G')?'S08':c.id.split('-')[0]),
      actorProvenance:c.actorProvenance??{kind:c.observedComputerProof||c.observedComputerAction?'computer':'unknown'},
      label:{category:'strategic-diagnostic',scope:c.scope??c.classification??'Retained development witness, no global safety or optimality claim.'}});
    const witnesses=[],requests=[];
    const add=async(name,actions,expectedOutcome)=>{
      requests.push({name,actions,expectedOutcome});
      try {
        const proof=await verifyWitness({state:c.state,stateHash:c.stateHash,actions,expectedOutcome,maxActions,milliseconds,maxOperations});
        if(observations&&expectedOutcome!==null&&proof.disposition==='complete')assert(proof.expectedOutcomeMatched,'observation witness outcome mismatch');
        witnesses.push({name,...proof,...(c.terminalTargetsQuarantined?{terminalValueP1:null,terminalValueScope:'not-admitted-exposed-development',sourceHistoryFinalityVerified:false}:{})});
      }
      catch(error){witnesses.push({name,disposition:'quarantined',reason:error.message,winningContinuation:false,terminalValueP1:null});}
    };
    for(const request of c.scopedRequests??[])await add(request.name,request.actions,request.expectedOutcome);
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
      assert(Object.hasOwn(proofFiles,reference.name)&&certificate.schema===1&&certificate.beforeHash===c.stateHash&&canonical(certificate.line)===canonical(reference.line)&&(!evidence||certificate.caseId===c.referenceCaseId),'reference certificate root or prelude differs');
      referenceCertificates.push({name:reference.name,sha256:await sha256(bytes),disposition:'reference-only',checksumVerified:true,replayed:false,reason:'unsupported-two-action-prelude-certificate-v1'});
    }
    if(c.defenseCertificate){
      try{const bytes=load(c.defenseCertificate);const original=JSON.parse(bytes);certificateInput=Object.fromEntries(Object.entries(original).filter(([key])=>!['alias','display','verifiedNodes'].includes(key)));defense={...await verifyTurnDefense(JSON.parse(bytes),{milliseconds,maxNodes:maxOperations}),certificateSha256:await sha256(bytes)};}
      catch(error){defense={disposition:'quarantined',reason:error.message,globalSafetyProven:false,terminalValueP1:null};}
    }
    if(observations)assert(witnesses.some(w=>w.disposition==='complete'),'observation case has zero executable witness coverage');
    const referenceOnly=observations?{referenceOnly:c.referenceOnly,alternativeClaims:c.scopedRequests.map(r=>({name:r.name,...r.referenceOnly})),referenceCertificates,sourceHistoryFinalityVerified:false}:{};
    preparedCases.push({id:c.id,state:c.state,stateHash:c.stateHash,...qualification,requests,certificate:certificateInput,...referenceOnly});
    cases.push({id:c.id,state:c.state,stateHash:c.stateHash,...qualification,witnesses,defense,
      originalScope:c.scope??c.defenseScope??c.classification??null,
      originalMinimality:c.minimalActionsWithinSpecifiedPushBranch?{actions:c.minimalActionsWithinSpecifiedPushBranch,scope:'specified-push-branch-only',reverified:false}:null,
      terminalBoundary:c.productionTerminalBoundary||verification.boundaryQuarantines?.some(b=>b.alias===c.id.split('-')[0])?'quarantined':'not-admitted',
      policyTargetAdmitted:false,observedValueTargetAdmitted:false,competitiveScoreEligible:false,...referenceOnly});
  }
  const sourcePacketSha256=await sha256(raw);
  const provenance=evidence?{evidenceInventorySha256:await sha256(evidenceBytes),originalSourcePacketSha256:packet.sourcePacketSha256,sanitizedFiles:usedFiles}:{};
  const packetBytes=encode(canonical({schema:1,kind:'prepared-development',sourcePacketSha256,...provenance,cases:preparedCases})+'\n');
  const packetSha256=await sha256(packetBytes);
  const receipt={schema:1,kind:'development-evidence',sourceRevision,sourceDirty,sourceInventorySha256,originalSourceRevision:packet.sourceRevision,
    sourcePacketSha256,packetSha256,contractSha256:await sha256(contractBytes),...provenance,
    bounds:{milliseconds,maxActions,maxOperations},cases,trainingAuthorized:false,publicBudgetsChanged:false};
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
