// Local prepared evidence only. Never connects to production or provisions hosts.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyWitness, verifyTurnDefense } from '../ai-trainer/tactical-evidence.mjs';
import { assert, canonical, encode, sha256 } from './policy.mjs';
import { LEARNING_EVIDENCE_CONTRACT, sourceQualification } from './data-contract.mjs';

export async function prepareDevelopment(directory, {sourceRevision,milliseconds=5000,maxActions=32,maxOperations=10000}={}) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const sourceDirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0;
  const actualRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  assert(sourceRevision===actualRevision,'verifier source revision mismatch');
  const sourceFiles=execFileSync('git',['ls-files','packages/game-engine/src','packages/shared-types/src','packages/computer-player/src'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  sourceFiles.push('tools/ai-trainer/tactical-evidence.mjs','tools/hosted-compute/prepare-development.mjs');
  const inventory={};for(const name of sourceFiles)inventory[name]=await sha256(readFileSync(path.join(root,name)));
  const contractBytes=readFileSync(path.join(root,'tools/ai-trainer/learning-evidence-contract.json'));
  const sourceInventorySha256=await sha256(encode(canonical(inventory)));
  const load=name=>{assert(typeof name==='string'&&/^[a-zA-Z0-9._-]+$/.test(name)&&!['.','..'].includes(name),'unsafe proof name');return readFileSync(path.join(directory,name));};
  const modern=(()=>{try{return load('handoff-cases.json');}catch(e){if(e.code==='ENOENT')return null;throw e;}})();
  const raw=modern??load('curation-proposal.json'),packet=JSON.parse(raw);
  const verification=JSON.parse(load(modern?'handoff-verification.json':'verification.json'));
  assert(await sha256(raw)===(modern?verification.casePacketSha256:verification.proposalSha256),'development packet checksum mismatch');
  const proofFiles=modern?verification.proofFiles:{'S10-defense-certificate.json':verification.certificateSha256};
  for(const [name,hash] of Object.entries(proofFiles)) {
    assert(/^[a-zA-Z0-9._-]+$/.test(name),'unsafe proof name');
    assert(await sha256(load(name))===hash,'retained proof checksum mismatch');
  }
  const cases=[], preparedCases=[];
  for(const c of packet.cases) {
    const qualification=sourceQualification({sourcePurpose:'exploratory',sourceFamily:c.id.startsWith('G')?'S08':c.id.split('-')[0],
      actorProvenance:{kind:c.observedComputerProof||c.observedComputerAction?'computer':'unknown'},
      label:{category:'strategic-diagnostic',scope:c.scope??c.classification??'Retained development witness, no global safety or optimality claim.'}});
    const witnesses=[],requests=[];
    const add=async(name,actions,expectedOutcome)=>{
      requests.push({name,actions,expectedOutcome});
      try {witnesses.push({name,...await verifyWitness({state:c.state,stateHash:c.stateHash,actions,expectedOutcome,maxActions,milliseconds,maxOperations})});}
      catch(error){witnesses.push({name,disposition:'quarantined',reason:error.message,winningContinuation:false,terminalValueP1:null});}
    };
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
    if(c.defenseCertificate){
      try{const bytes=load(c.defenseCertificate);const original=JSON.parse(bytes);certificateInput=Object.fromEntries(Object.entries(original).filter(([key])=>!['alias','display','verifiedNodes'].includes(key)));defense={...await verifyTurnDefense(JSON.parse(bytes),{milliseconds,maxNodes:maxOperations}),certificateSha256:await sha256(bytes)};}
      catch(error){defense={disposition:'quarantined',reason:error.message,globalSafetyProven:false,terminalValueP1:null};}
    }
    preparedCases.push({id:c.id,state:c.state,stateHash:c.stateHash,...qualification,requests,certificate:certificateInput});
    cases.push({id:c.id,state:c.state,stateHash:c.stateHash,...qualification,witnesses,defense,
      originalScope:c.scope??c.defenseScope??c.classification??null,
      originalMinimality:c.minimalActionsWithinSpecifiedPushBranch?{actions:c.minimalActionsWithinSpecifiedPushBranch,scope:'specified-push-branch-only',reverified:false}:null,
      terminalBoundary:c.productionTerminalBoundary||verification.boundaryQuarantines?.some(b=>b.alias===c.id.split('-')[0])?'quarantined':'not-admitted',
      policyTargetAdmitted:false,observedValueTargetAdmitted:false,competitiveScoreEligible:false});
  }
  const sourcePacketSha256=await sha256(raw);
  const packetBytes=encode(canonical({schema:1,kind:'prepared-development',sourcePacketSha256,cases:preparedCases})+'\n');
  const packetSha256=await sha256(packetBytes);
  const receipt={schema:1,kind:'development-evidence',sourceRevision,sourceDirty,sourceInventorySha256,originalSourceRevision:packet.sourceRevision,
    sourcePacketSha256,packetSha256,contractSha256:await sha256(contractBytes),
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
