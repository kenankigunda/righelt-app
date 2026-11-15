import {assert,POLICY,canonical} from './policy.mjs';
import {adaptS05} from './s05-observations.mjs';

const countFields=new Set(['redPieces','redCommanded','bluePieces','blueCommanded','redGroup','blueGroup','counterRedGroup','counterBlueGroup','bluePiecesAfter','captured','redCommandedBefore','redCommandedAfter','redPiecesBefore','redPiecesAfter','blueCommandedBefore','blueCommandedAfter','observedAutomaticActions']);
const stringFields=new Set(['category','scope','globalSafety','fullOpposingTurnProof']);
const alternativeFields=new Set(['line','outcome','counterReply','pushBlocked','blockedProjection','oneOpposingTurnCertificate',...countFields,...stringFields]);
const actionFields=new Set(['type','actorId','from','to']);
function referenceAction(action,boardSize){
  assert(action&&typeof action==='object'&&Object.keys(action).every(k=>actionFields.has(k)),'unknown reference action metadata');
  if(['end_turn','pass'].includes(action.type)){assert(Object.keys(action).length===1,'unknown reference stop metadata');return;}
  assert(['move','rush','project','push'].includes(action.type)&&Object.keys(action).length===4&&typeof action.actorId==='string'&&action.actorId.length<=128,'unsupported reference action');
  for(const p of [action.from,action.to])assert(p&&Object.keys(p).sort().join(',')==='col,row'&&Number.isSafeInteger(p.row)&&Number.isSafeInteger(p.col)&&p.row>=0&&p.row<boardSize&&p.col>=0&&p.col<boardSize,'invalid reference coordinates');
}
function checkedAlternative(a,certificateNames,boardSize){
  assert(a&&typeof a==='object'&&Object.keys(a).every(k=>alternativeFields.has(k)),'unknown observation claim metadata');
  for(const [key,value] of Object.entries(a)){
    if(countFields.has(key))assert(Number.isSafeInteger(value)&&value>=0&&value<=100000,'invalid reference count');
    if(stringFields.has(key))assert(typeof value==='string'&&value.length>0&&value.length<=2048,'invalid reference scope');
  }
  if(a.pushBlocked!==undefined)assert(typeof a.pushBlocked==='boolean','invalid reference predicate');
  if(a.blockedProjection)referenceAction(a.blockedProjection,boardSize);
  if(a.counterReply){assert(Array.isArray(a.counterReply)&&a.counterReply.length>0&&a.counterReply.length<=32,'bounded reference reply required');a.counterReply.forEach(a=>referenceAction(a,boardSize));}
  if(a.outcome)assert(Object.keys(a.outcome).every(k=>['status','reason'].includes(k))&&(a.outcome.reason===undefined||typeof a.outcome.reason==='string'&&a.outcome.reason.length<=256),'unknown outcome metadata');
  if(a.oneOpposingTurnCertificate!==undefined&&a.oneOpposingTurnCertificate!==null)assert(certificateNames.includes(a.oneOpposingTurnCertificate),'unsupported observation certificate name');
  return a;
}

export function validateEvidenceInventory(value){
  if(value?.sourceFamily==='S12'){
    assert(value.schema===1&&value.kind==='sanitized-development-evidence-inventory'&&/^[a-f0-9]{40}$/.test(value.sourceRevision)&&value.caseCount===10,'unsupported S12 inventory');
    assert(value.sanitization?.schema===1&&value.sanitization.allowlist===true&&value.sanitization.originalAccountDeviceGameDecisionIdsAbsent===true,'explicit S12 sanitization required');
    const names=['handoff-cases.json','handoff-verification.json','witness-verification.json','independent-final-review-check.json','analysis.txt'];
    assert(Object.keys(value.sanitizedFiles??{}).sort().join(',')===names.sort().join(','),'S12 sanitized inventory mismatch');
    for(const record of Object.values(value.sanitizedFiles))assert(/^[a-f0-9]{64}$/.test(record.sha256)&&Number.isSafeInteger(record.bytes)&&record.bytes>0&&record.bytes<=POLICY.maxObjectBytes,'bounded S12 identity required');
    for(const name of names)assert(/^[a-f0-9]{64}$/.test(value.originalHashes?.[name]),'S12 source identity missing');
    return value;
  }
  if(value?.sourceFamily==='S05'){
    assert(value.schema===1&&value.kind==='sanitized-development-evidence-inventory'&&/^[a-f0-9]{40}$/.test(value.sourceRevision)&&value.caseCount===11,'unsupported S05 inventory');
    assert(value.sanitization?.schema===1&&value.sanitization.allowlist===true&&value.sanitization.originalAccountDeviceGameDecisionIdsAbsent===true,'explicit S05 sanitization required');
    const names=['development-cases.json','retained-verification.json','analysis.txt','proofs/early-escape.json','proofs/defense-55.json','proofs/forcing-push-56.json','proofs/forced-loss-64.json'];
    assert(Object.keys(value.sanitizedFiles??{}).every(n=>names.includes(n)||n==='search-diagnosis.json')&&names.every(n=>Object.hasOwn(value.sanitizedFiles,n)),'S05 sanitized inventory mismatch');
    for(const r of Object.values(value.sanitizedFiles))assert(/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=POLICY.maxObjectBytes,'bounded S05 identity required');
    for(const name of ['development-cases.json','verification.json',...names.filter(n=>n.startsWith('proofs/'))])assert(/^[a-f0-9]{64}$/.test(value.originalHashes?.[name]),'S05 source identity missing');
    return value;
  }
  assert(value?.schema===1&&value.kind==='sanitized-development-evidence-inventory'&&value.sourceFamily==='S11'&&/^[a-f0-9]{40}$/.test(value.sourceRevision)&&Number.isSafeInteger(value.caseCount)&&value.caseCount>0&&value.caseCount<=100,'unsupported sanitized evidence inventory');
  assert(value.sanitization?.schema===1&&value.sanitization.allowlist===true&&value.sanitization.originalIdsRemoved===true,'explicit allowlisted sanitization required');
  const names=new Set(['development-cases.json','one-opposing-turn-certificate.json','retained-verification.json','analysis.txt','search-probe-summary.json']);
  assert(value.sanitizedFiles&&Object.keys(value.sanitizedFiles).every(n=>names.has(n)),'unknown sanitized evidence file');
  for(const name of ['development-cases.json','one-opposing-turn-certificate.json','retained-verification.json'])assert(Object.hasOwn(value.sanitizedFiles,name),'sanitized evidence file missing');
  for(const record of Object.values(value.sanitizedFiles))assert(record&&Object.keys(record).sort().join(',')==='bytes,sha256'&&/^[a-f0-9]{64}$/.test(record.sha256)&&Number.isSafeInteger(record.bytes)&&record.bytes>0&&record.bytes<=POLICY.maxObjectBytes,'bounded sanitized file identity required');
  for(const name of ['development-cases.json','G47-cut-2-certificate.json','verification.json'])assert(/^[a-f0-9]{64}$/.test(value.originalHashes?.[name]),'original evidence identity missing');
  return value;
}

export function validateScopedHandoff(packet,verification){
  assert(packet?.schema===1&&packet.kind==='scoped-tactical-handoff'&&packet.sourceFamily==='S12'&&verification.sourceFamily==='S12','explicit existing S12 handoff required');
  assert(packet.sourcePurpose==='unclassified'&&verification.sourceHistoryComputerDecisions===0&&verification.learnerEligibilityEnabled===false&&verification.globalLateDefenseStatus==='unknown','S12 unknown purpose, actor and global defense must be preserved');
  assert(packet.activeLineOnly===true&&/^[a-f0-9]{40}$/.test(packet.sourceRevision)&&packet.sourceRevision===verification.sourceRevision&&packet.cases?.length===10&&verification.caseCount===10,'S12 source/case inventory mismatch');
  const ids=new Set();let witnesses=0;
  for(const c of packet.cases){
    assert(Object.keys(c).every(k=>['id','sourceFamily','sourcePurpose','sourceDisplay','uiTurn','controller','actorProvenance','state','stateHash','observedAction','motif','scope','scopedRequests','terminalTargetsQuarantined','learning','referenceOnly','diagnosticEffects','completeRetreatAlternatives'].includes(k)),'unknown S12 case metadata');
    assert(/^S12-(?:0[1-9]|10)$/.test(c.id)&&!ids.has(c.id),'unique S12 case identity required');ids.add(c.id);
    assert(c.sourceFamily==='S12'&&c.sourcePurpose==='unclassified'&&c.actorProvenance?.kind==='unknown'&&Object.keys(c.actorProvenance).length===1&&c.terminalTargetsQuarantined===true,'S12 purpose, actor or finality upgrade forbidden');
    assert(c.learning&&Object.keys(c.learning).sort().join(',')==='competitiveScore,heldOut,observedValueTarget,policyTarget'&&Object.values(c.learning).every(x=>x===false),'S12 learner/exposure upgrade forbidden');
    assert(c.state&&c.state.sideToMove===c.controller&&['P1','P2'].includes(c.controller)&&/^[a-f0-9]{64}$/.test(c.stateHash)&&typeof c.scope==='string'&&c.scope.length>0,'S12 controller/root/scope identity required');
    assert(Array.isArray(c.scopedRequests)&&c.scopedRequests.length>0&&c.scopedRequests.length<=32,'bounded S12 scoped requests required');
    const names=new Set();for(const r of c.scopedRequests){
      assert(Object.keys(r).sort().join(',')==='actions,beforePredicates,expectedEndpointHash,expectedOutcome,name,predicates'&&typeof r.name==='string'&&!names.has(r.name),'versioned S12 request required');names.add(r.name);
      assert(Array.isArray(r.actions)&&r.actions.length>0&&r.actions.length<=32&&/^[a-f0-9]{64}$/.test(r.expectedEndpointHash)&&['ongoing','p1_win','p2_win','draw'].includes(r.expectedOutcome)&&Array.isArray(r.predicates)&&Array.isArray(r.beforePredicates),'bounded S12 request identity required');witnesses++;
    }
    if(c.completeRetreatAlternatives)assert(c.completeRetreatAlternatives.length===3&&new Set(c.completeRetreatAlternatives.map(canonical)).size===3&&c.scopedRequests.length===3,'S12 retreat inventory differs');
    assert(c.referenceOnly?.globalSafety==='unproved'&&c.referenceOnly.optimality==='unproved','S12 unproved strategy upgrade forbidden');
    if(c.referenceOnly.globalAvoidability)assert(c.referenceOnly.globalAvoidability.status==='unknown','S12 incomplete late-defense search is unknown');
  }
  assert(witnesses===27&&verification.witnessCount===27,'S12 witness inventory mismatch');
  return packet.cases;
}

// Source packet compatibility, not teacher-target admission. The initial
// adapter is deliberately specific to the already exposed S11 family.
export function adaptDevelopmentObservations(packet,verification,{certificateNames=['G47-cut-2-certificate.json']}={}) {
  if(packet?.sourceFamily==='S05')return adaptS05(packet,verification);
  assert(packet?.schema===1&&packet.kind==='scoped-development-observations','unsupported development observation schema or kind');
  assert(packet.sourceFamily==='S11'&&verification?.sourceFamily==='S11'&&packet.sourcePurpose==='exploratory','explicit exposed S11 exploratory family required');
  assert(/^[a-f0-9]{40}$/.test(packet.sourceRevision)&&verification.sourceRevision===packet.sourceRevision,'observation source revision mismatch');
  assert(Array.isArray(packet.cases)&&packet.cases.length>0&&packet.cases.length<=100&&verification.developmentCaseCount===packet.cases.length,'bounded observation case inventory required');
  const ids=new Set(),sourceIds=new Set();
  return packet.cases.map(c=>{
    assert(Number.isSafeInteger(c.display)&&c.display>0&&c.display<100000&&!ids.has(c.display),'unique development display required');ids.add(c.display);
    const caseId=c.id;assert(typeof caseId==='string'&&caseId.length>0&&caseId.length<=128&&!sourceIds.has(caseId),'unique source case identity required');sourceIds.add(caseId);
    assert(c.rootState&&/^[a-f0-9]{64}$/.test(c.rootStateHash)&&['P1','P2'].includes(c.actor)&&c.rootState.sideToMove===c.actor,'observation root/controller identity required');
    assert(['computer','human','unknown'].includes(c.actorProvenance)&&c.purpose==='exposed-development-evidence'&&typeof c.scope==='string'&&c.scope.length>0&&c.scope.length<=2048&&(c.motif===undefined||typeof c.motif==='string'&&c.motif.length<=1024),'explicit observation actor and scope required');
    if(c.automaticEndingProof){
      const p=c.automaticEndingProof;
      assert(Object.keys(p).sort().join(',')==='cacheHits,display,endpoints,exactRecordedHash,optionalEndpoints,proofKind,visitedNodes'&&p.proofKind==='proven-terminal'&&/^[a-f0-9]{64}$/.test(p.exactRecordedHash)&&['cacheHits','display','endpoints','optionalEndpoints','visitedNodes'].every(k=>Number.isSafeInteger(p[k])&&p[k]>=0),'unknown automatic-ending reference metadata');
    }
    assert(c.learnerEligibility?.historicalPolicy===false&&c.learnerEligibility.historicalOptimalNonterminalValue===false&&c.learnerEligibility.competitiveScore===false,'observation target admission is forbidden');
    assert(Array.isArray(c.alternatives)&&c.alternatives.length>0&&c.alternatives.length<=32,'executable observation alternatives required');
    const references=[];
    const requests=c.alternatives.map((a,i)=>{
      checkedAlternative(a,certificateNames,c.rootState.boardSize);
      assert(Array.isArray(a.line)&&a.line.length>0&&a.line.length<=32&&a.line.every(action=>action&&typeof action.type==='string'),'nonempty bounded observation line required');
      a.line.forEach(action=>referenceAction(action,c.rootState.boardSize));
      const outcome=a.outcome?.status??null;assert(outcome===null||['ongoing','p1_win','p2_win','draw'].includes(outcome),'unsupported observation outcome');
      if(a.oneOpposingTurnCertificate){assert(/^[a-zA-Z0-9._-]+\.json$/.test(a.oneOpposingTurnCertificate),'unsafe observation certificate name');references.push({name:a.oneOpposingTurnCertificate,line:a.line});}
      const claims=Object.fromEntries(Object.entries(a).filter(([key])=>!['line','outcome'].includes(key)));
      return {name:`alternative-${i+1}-explicit-rules-line`,actions:a.line,expectedOutcome:outcome,
        referenceOnly:{disposition:'reference-only',verified:false,claims}};
    });
    return {id:caseId,sourceDisplay:c.display,state:c.rootState,stateHash:c.rootStateHash,scope:c.scope,
      sourceFamily:'S11',sourcePurpose:'exploratory',actorProvenance:{kind:c.actorProvenance},
      scopedRequests:requests,referenceCertificates:references,referenceCaseId:c.id,
      referenceOnly:{disposition:'reference-only',verified:false,motif:c.motif??null,automaticEndingProof:c.automaticEndingProof??null},
      productionTerminalBoundary:true,sourceHistoryFinalityVerified:false,terminalTargetsQuarantined:true};
  });
}
