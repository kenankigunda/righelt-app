// Policy demonstrations from bounded, replayed certificates. Never optimal values.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {encodeState,legalActionMap,transition} from '../../packages/computer-player/src/index.ts';
import {encodedDigest,encodedFamily,commanderFamily} from './evaluation-protection.mjs';
import {verifyTurnDefense} from './tactical-evidence.mjs';
import {verifyTurnCertificate} from './turn-certificate.mjs';
import {canonical} from '../hosted-compute/policy.mjs';
import {publicEvaluationProfiles} from './public-evaluation-profiles.mjs';
const sha=v=>createHash('sha256').update(typeof v==='string'?v:canonical(v)).digest('hex');
const assert=(v,m)=>{if(!v)throw Error(m);};
const job=JSON.parse(readFileSync(0,'utf8'));
function facts(state){
 const encoded=Array.from(encodeState(state)),family=commanderFamily(state);
 assert(encodedFamily(encoded)===family,'family encoding mismatch');
 assert(!job.guards.encodingHashes.includes(encodedDigest(encoded))&&!job.guards.familyIds.includes(family),'protected example');
 const legal=state.outcome.status==='ongoing'?[...legalActionMap(state)]:[];
 return {state,stateHash:deterministicStateHash(state),controller:state.sideToMove,encoded,
  legal:legal.map(x=>x[0]),actions:legal.map(x=>x[1])};
}
function step(state,action){
 assert(facts(state).actions.some(a=>canonical(a)===canonical(action)),'illegal selected action');
 return transition(state,action);
}
if(job.mode==='profiles')process.stdout.write(JSON.stringify(publicEvaluationProfiles()));
else if(job.mode==='facts')process.stdout.write(JSON.stringify(facts(job.state)));
else if(job.mode==='step')process.stdout.write(JSON.stringify({state:step(job.state,job.action)}));
else if(job.mode==='prepare'){
 const rows=[],cases=[],proofs=[];
 for(const item of job.cases){
  const c=item.case,cert=item.certificate;
  assert(['S10-28-avoid-next-turn-loss','S05-01','S05-07'].includes(c.id),'unreviewed root');
  assert(deterministicStateHash(c.rootState)===c.rootRuleStateHash,'case root mismatch');
  let proof;
  if(c.id.startsWith('S10')){
   assert(cert.rootStateHash===c.rootRuleStateHash&&canonical(cert.defense)===canonical(c.knownDefensivePrefix[0]),'S10 prefix mismatch');
   proof=await verifyTurnDefense(cert,{milliseconds:60000,maxNodes:10000});
  }else{
   assert(cert.beforeHash===c.rootRuleStateHash&&canonical(cert.prelude)===canonical(c.knownDefensivePrefix),'S05 prefix mismatch');
   proof=await verifyTurnCertificate(cert,{milliseconds:120000,maxNodes:10000});
   assert(proof.value===false,'not a bounded safe defense');
  }
  assert(proof.disposition==='complete'&&proof.verifiedNodes===cert.verifiedNodes,'incomplete certificate');
  const certificateSha256=sha(cert);proofs.push({id:c.id,certificateSha256,proof});
  let state=c.rootState;
  for(let i=0;i<c.knownDefensivePrefix.length;i++){
   const f=facts(state),action=c.knownDefensivePrefix[i],index=f.actions.findIndex(a=>canonical(a)===canonical(action));
   assert(index>=0&&f.controller===c.rootState.sideToMove,'wrong controller or illegal target');
   const evidence={caseId:c.id,sourceFamily:c.sourceFamily,stateHash:f.stateHash,action,certificateSha256,
    prefixSha256:sha(c.knownDefensivePrefix),prefixIndex:i,scope:proof.scope};
   const id='certificate-policy:'+sha(evidence);
   rows.push({id,gameId:'certificate-policy:'+c.id,sourceFamily:c.sourceFamily,encoded:f.encoded,legal:f.legal,
    policy:[{index:f.legal[index],probability:1}],policyMask:true,terminalMask:false,terminalValue:0,
    futureFacts:{values:Array(24).fill(0),mask:Array(24).fill(false)},certificateEvidence:evidence});
   state=step(state,action);
  }
  assert(state.turnIndex>c.rootState.turnIndex&&state.outcome.status==='ongoing','incomplete defensive turn');
  cases.push({id:c.id,family:c.sourceFamily,rootState:c.rootState,rootRuleStateHash:c.rootRuleStateHash,
   knownDefensivePrefix:c.knownDefensivePrefix,knownLosingPrefix:c.knownLosingPrefix,
   knownDeficient:c.id!=='S05-01',scope:proof.scope});
 }
 assert(rows.length===7&&new Set(rows.map(r=>r.id)).size===7,'expected seven unique positions');
 process.stdout.write(JSON.stringify({schema:1,kind:'certificate-policy-demonstrations',rows,cases,proofs,
  freshSelfPlayGames:0,optimalPolicyClaim:false,eventualSafetyClaim:false,independentFamilies:2}));
}else throw Error('unknown certificate teacher mode');
