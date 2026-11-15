import {assert,POLICY} from './policy.mjs';

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
  assert(value?.schema===1&&value.kind==='sanitized-development-evidence-inventory'&&value.sourceFamily==='S11'&&/^[a-f0-9]{40}$/.test(value.sourceRevision)&&Number.isSafeInteger(value.caseCount)&&value.caseCount>0&&value.caseCount<=100,'unsupported sanitized evidence inventory');
  assert(value.sanitization?.schema===1&&value.sanitization.allowlist===true&&value.sanitization.originalIdsRemoved===true,'explicit allowlisted sanitization required');
  const names=new Set(['development-cases.json','one-opposing-turn-certificate.json','retained-verification.json','analysis.txt','search-probe-summary.json']);
  assert(value.sanitizedFiles&&Object.keys(value.sanitizedFiles).every(n=>names.has(n)),'unknown sanitized evidence file');
  for(const name of ['development-cases.json','one-opposing-turn-certificate.json','retained-verification.json'])assert(Object.hasOwn(value.sanitizedFiles,name),'sanitized evidence file missing');
  for(const record of Object.values(value.sanitizedFiles))assert(record&&Object.keys(record).sort().join(',')==='bytes,sha256'&&/^[a-f0-9]{64}$/.test(record.sha256)&&Number.isSafeInteger(record.bytes)&&record.bytes>0&&record.bytes<=POLICY.maxObjectBytes,'bounded sanitized file identity required');
  for(const name of ['development-cases.json','G47-cut-2-certificate.json','verification.json'])assert(/^[a-f0-9]{64}$/.test(value.originalHashes?.[name]),'original evidence identity missing');
  return value;
}

// Source packet compatibility, not teacher-target admission. The initial
// adapter is deliberately specific to the already exposed S11 family.
export function adaptDevelopmentObservations(packet,verification,{certificateNames=['G47-cut-2-certificate.json']}={}) {
  assert(packet?.schema===1&&packet.kind==='scoped-development-observations','unsupported development observation schema or kind');
  assert(packet.sourceFamily==='S11'&&verification?.sourceFamily==='S11'&&packet.sourcePurpose==='exploratory','explicit exposed S11 exploratory family required');
  assert(/^[a-f0-9]{40}$/.test(packet.sourceRevision)&&verification.sourceRevision===packet.sourceRevision,'observation source revision mismatch');
  assert(Array.isArray(packet.cases)&&packet.cases.length>0&&packet.cases.length<=100&&verification.developmentCaseCount===packet.cases.length,'bounded observation case inventory required');
  const ids=new Set();
  return packet.cases.map(c=>{
    assert(Number.isSafeInteger(c.display)&&c.display>0&&c.display<100000&&!ids.has(c.display),'unique development display required');ids.add(c.display);
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
    return {id:`S11-${c.display}`,state:c.rootState,stateHash:c.rootStateHash,scope:c.scope,
      sourceFamily:'S11',sourcePurpose:'exploratory',actorProvenance:{kind:c.actorProvenance},
      scopedRequests:requests,referenceCertificates:references,referenceCaseId:c.id,
      referenceOnly:{disposition:'reference-only',verified:false,motif:c.motif??null,automaticEndingProof:c.automaticEndingProof??null},
      productionTerminalBoundary:true,sourceHistoryFinalityVerified:false,terminalTargetsQuarantined:true};
  });
}
