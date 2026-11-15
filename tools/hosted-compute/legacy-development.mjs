import {assert} from './policy.mjs';

// Retained production review evidence. This adapter carries supplied claims;
// it neither completes opposing turns nor qualifies historical teacher targets.
export function adaptLegacyDevelopment(packet,verification){
 assert(packet?.schema===1&&packet.kind===undefined&&packet.humanControlled===true&&typeof packet.familyId==='string'&&packet.familyId.length>0&&packet.familyId.length<=128,'unsupported retained development review');
 assert(/^[a-f0-9]{40}$/.test(packet.sourceRevision)&&packet.sourceRevision===verification?.sourceRevision&&Array.isArray(packet.cases)&&packet.cases.length>0&&packet.cases.length<=100&&verification.cases===packet.cases.length,'retained review source/case inventory differs');
 const ids=new Set();
 return packet.cases.map(c=>{
  assert(typeof c.id==='string'&&c.id.length>0&&c.id.length<=128&&!ids.has(c.id),'unique retained case identity required');ids.add(c.id);
  assert(c.state&&/^[a-f0-9]{64}$/.test(c.stateHash)&&['P1','P2'].includes(c.controller)&&c.state.sideToMove===c.controller&&c.retreatSemantics==='completion-preserving-retreat-v2','retained review root/controller/retreat semantics differ');
  const scope=c.scope??c.defenseScope??c.classification;
  assert(typeof scope==='string'&&scope.length>0&&scope.length<=2048,'explicit retained review scope required');
  const scopedRequests=[];
  const add=(name,action,expectedOutcome=null,options={})=>scopedRequests.push({name,actions:[action],expectedOutcome,...options,referenceOnly:{disposition:'reference-only',verified:false,scope:'Supplied action only; retained strategic claims are not newly verified.'}});
  const counts=value=>{
   assert(value&&['P1','P2'].every(owner=>value[owner]),'retained before/after counts required');
   return ['P1','P2'].flatMap(owner=>['commanded','supplied'].map(field=>{
    const expected=value[owner][field];assert(Number.isSafeInteger(expected)&&expected>=0,'literal retained count required');
    return {kind:'count',owner,field,expected};
   }));
  };
  if(c.historicalAction)add('historical-command-supply-change',c.historicalAction,null,{beforePredicates:counts(c.observedBefore),predicates:counts(c.observedAfter)});
  if(c.knownLosingAction)add('specified-push-diagnostic',c.knownLosingAction);
  if(c.candidateDefense)add('candidate-defense-diagnostic',c.candidateDefense);
  if(c.knownWinningActions){
   assert(c.acceptableActionSetComplete===false&&Array.isArray(c.knownWinningActions)&&c.knownWinningActions.length>0&&c.knownWinningActions.length<=32,'bounded incomplete retreat claims required');
   c.knownWinningActions.forEach((action,i)=>add(`retained-retreat-${i+1}-diagnostic`,action));
  }
  if(c.verifiedWinningAction){assert(['p1_win','p2_win','draw'].includes(c.outcome?.status)&&c.acceptableActionSetComplete===false,'explicit retained immediate outcome required');add('specified-immediate-outcome',c.verifiedWinningAction,c.outcome.status);}
  assert(scopedRequests.length>0,'retained case has no supplied action');
  // Deliberately omit game/decision IDs and profile checks. These allowlisted
  // claims retain their original scopes and controllers, without fresh proof.
  const claims=Object.fromEntries(['classification','retreatSemantics','observedBefore','observedAfter','reactivatedExistingPieces','knownLosingAction','winningRetreat','opposingContinuationProof','candidateDefense','defenseScope','defenseSafety','legalActionInventory','knownWinningActions','proofs','scope','otherActions','acceptableActionSetComplete','ordinaryOpponentPiecesRemoved','supplyCornerOccupied','learningGoal'].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
  return {id:c.id,sourceDisplay:c.sourceDisplay,state:c.state,stateHash:c.stateHash,scope,sourceFamily:packet.familyId,sourcePurpose:'unclassified',actorProvenance:{kind:'human'},scopedRequests,referenceCertificates:[],
   referenceOnly:{disposition:'reference-only',verified:false,claims,globalSafety:'unproved',optimality:'unproved',opposingTurnCompletion:'unsupported-reference-only',profileChecks:'retained-only-not-fresh-assessment'},
   sourceHistoryFinalityVerified:false,terminalTargetsQuarantined:true};
 });
}
