import {assert,canonical} from './policy.mjs';

export function bindS05Certificate(c,reference,certificate){
 assert((certificate.beforeHash??certificate.rootStateHash)===c.stateHash&&canonical(certificate.prelude??[])===canonical(reference.line),'S05 certificate case/prelude mismatch');
}

// Compatibility for the versioned, already exposed S05 packet. Metadata never
// grants learner eligibility. Unsupported strategic claims remain references.
export function adaptS05(packet,verification){
 assert(packet?.schema===1&&packet.kind==='scoped-development-observations'&&packet.sourceFamily==='S05'&&packet.sourcePurpose==='exploratory'&&verification.sourceFamily==='S05','explicit S05 exploratory evidence required');
 assert(/^[a-f0-9]{40}$/.test(packet.sourceRevision)&&Object.values(verification.sourceManifests??{}).length===2&&Object.values(verification.sourceManifests).every(m=>m.sourceRevision===packet.sourceRevision),'S05 source revision mismatch');
 assert(Array.isArray(packet.cases)&&packet.cases.length===verification.packet?.cases&&packet.cases.length<=100,'S05 case inventory mismatch');
 const ids=new Set();
 return packet.cases.map(c=>{
  assert(/^S05-\d{2}$/.test(c.id)&&!ids.has(c.id),'duplicate or invalid S05 identity');ids.add(c.id);
  assert(c.sourceFamily==='S05'&&c.rootState?.sideToMove===c.actor&&['P1','P2'].includes(c.actor)&&/^[a-f0-9]{64}$/.test(c.rootStateHash)&&['computer','human','unknown'].includes(c.actorProvenance),'S05 root/controller provenance required');
  assert(Object.keys(c.learnerEligibility??{}).sort().join(',')==='heldOut,policyTarget,strengthEvidence,training,valueTarget'&&Object.values(c.learnerEligibility).every(x=>x===false),'S05 target admission is forbidden');
  const alternatives=c.alternatives??c.conditionalContrasts??[],referenceCertificates=[];
  const scopedRequests=alternatives.map((a,i)=>{
   assert(Object.keys(a).every(k=>['role','actions','endpointHash','outcome','certificate','completionCount','followActions','blueCommanderSupplied','specifiedRush','globalSafety','attacks'].includes(k)),'unknown S05 alternative metadata');
   assert(Array.isArray(a.actions)&&a.actions.length>0&&a.actions.length<=32,'bounded S05 line required');
   for(const action of a.actions)assert(action&&Object.keys(action).every(k=>['type','actorId','from','to'].includes(k))&&['move','rush','push','project','retreat','follow','end_turn','pass'].includes(action.type),'unsupported S05 action');
   if(a.certificate)referenceCertificates.push({name:a.certificate,line:a.actions});
   if(a.endpointHash)assert(/^[a-f0-9]{64}$/.test(a.endpointHash),'S05 endpoint identity required');
   return {name:`alternative-${i+1}-explicit-rules-line`,actions:a.actions,expectedOutcome:a.outcome?.status??null,expectedEndpointHash:a.endpointHash??null,
    predicates:[...(a.attacks??[]).map(p=>({kind:'legal',action:p.action,expected:p.legal})),...(a.specifiedRush?[{kind:'legal',action:a.specifiedRush.action,expected:a.specifiedRush.legal}]:[]),
      ...(a.blueCommanderSupplied!==undefined?[{kind:'piece',id:'C2',field:'supplied',expected:a.blueCommanderSupplied}]:[]),
      ...(c.id==='S05-04'?[{kind:'count',owner:'P2',field:'commanded',expected:c.effects.blueCommandedAfter},{kind:'piece',id:'U2-8',field:'supplied',expected:true},{kind:'piece',id:'U2-8',field:'commanded',expected:false},{kind:'legal',action:c.attackAfterInterposition.action,expected:false}]:[])],
    referenceOnly:{disposition:'reference-only',verified:false,claims:Object.fromEntries(Object.entries(a).filter(([k])=>!['actions','endpointHash','outcome'].includes(k)))}};
  });
  if(c.id==='S05-05')scopedRequests.push({name:'observed-group-change',actions:[c.observedAction],expectedOutcome:'ongoing',
   beforePredicates:[{kind:'group',id:'C2',expected:c.effects.commanderGroupBefore},{kind:'group',id:c.observedAction.actorId,expected:c.effects.movingGroupBefore}],
   predicates:[{kind:'group',id:'C2',expected:c.effects.commanderGroupAfter},{kind:'group',id:c.observedAction.actorId,expected:c.effects.movingGroupAfter}],referenceOnly:{disposition:'reference-only',verified:false,claims:{globalSafety:'unknown'}}});
  if(c.certificate)referenceCertificates.push({name:c.certificate,line:[]});
  return {id:c.id,state:c.rootState,stateHash:c.rootStateHash,scope:c.scope,sourceFamily:'S05',sourcePurpose:'exploratory',actorProvenance:{kind:c.actorProvenance},scopedRequests,referenceCertificates,
   referenceCaseId:c.id,referenceOnly:{disposition:'reference-only',verified:false,motif:c.motif,effects:c.effects??null,relatedWinningRoots:c.relatedWinningRoots??null,reason:'Only executed endpoint predicates and complete certificates are qualified; global safety, minimality and historical targets are not admitted.'},
   productionTerminalBoundary:true,sourceHistoryFinalityVerified:false,terminalTargetsQuarantined:true};
 });
}
