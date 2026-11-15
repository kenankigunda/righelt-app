import {deterministicStateHash} from '../../packages/game-engine/src/index.ts';
import {verifyWitness} from '../ai-trainer/tactical-evidence.mjs';
import {assert,canonical,encode,sha256} from './policy.mjs';

// A retained search receipt and an executed reply can diagnose a known miss.
// Neither supplies a current-source teacher correction or a global state value.
export async function diagnoseRetainedSearch(packet,{milliseconds=5000,maxOperations=10000}={}){
 assert(packet?.schema===1&&packet.kind==='retained-search-diagnosis'&&packet.sourceFamily==='S05'&&packet.learnerEligible===false&&packet.cases.length===2,'bounded retained S05 diagnostics required');
 for(const k of ['sourcePacketSha256','sourceProbeSha256','sourceProbeScriptSha256'])assert(/^[a-f0-9]{64}$/.test(packet[k]),'diagnostic source identity required');
 assert(/^[a-f0-9]{40}$/.test(packet.sourceRevision),'diagnostic revision required');
 const cases=[];
 for(const c of packet.cases){
  assert(c.status==='ready'&&c.completedSimulations===128&&c.requestedSimulations===128&&c.stopped==='complete'&&c.fallback===null&&c.engineBudget.limitReached===false&&c.selected.tactical==='incomplete'&&c.selected.immediate==='eligible','retained search work/selection mismatch');
  assert(c.modelSha256==='f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f'&&c.state.sideToMove==='P2'&&c.reply.length===2&&c.reply[1].type==='end_turn','diagnostic model/controller/reply mismatch');
  const rootHash=deterministicStateHash(c.state),proof=await verifyWitness({state:c.state,stateHash:rootHash,actions:[c.selected.action,...c.reply],expectedOutcome:'p1_win',maxActions:3,milliseconds,maxOperations});
  assert(proof.disposition==='complete'&&proof.expectedOutcomeMatched&&proof.steps.map(s=>s.controller).join(',')==='P2,P1,P1','diagnostic winning reply not verified');
  cases.push({alias:c.alias,display:c.display,rootHash,modelSha256:c.modelSha256,completedSimulations:c.completedSimulations,selectedTacticalStatus:'incomplete',replyProof:proof,
   mechanism:'One-reply terminal safety does not cover RUSH plus End Turn. The selected action remained tactically incomplete under shared tactical work, then remained eligible for PUCT; the three-action loss fits the configured four-action depth.',
   correctionRequired:true,teacherQualified:false,rootOptimalValueP1:null});
 }
 return {schema:1,kind:'verified-retained-search-diagnosis',sourceRevision:packet.sourceRevision,sourceProbeSha256:packet.sourceProbeSha256,packetCanonicalSha256:await sha256(encode(canonical(packet))),cases,
  currentCandidateSearchReproduced:false,teacherQualified:false,publicBudgetsChanged:false,policyTargetsAdmitted:false,
  qualificationBlockers:['Run the proposed teacher on these guarded development roots with actual completed work and legal policy support.','Require checked useful corrections and complete-turn continuation coverage; a larger requested budget or low value estimate does not qualify a teacher.','Preserve observed values/masks; diagnose raw evaluation separately without relabeling historical states.']};
}
