import fixture from '../../ai-trainer/tests/fixtures/tactical-learning-v1.json' with {type:'json'};
import {legalActionMap,transition} from '../../../packages/computer-player/src/index.ts';
import {deterministicStateHash} from '../../../packages/game-engine/src/index.ts';
import {sourceQualification} from '../data-contract.mjs';
import {canonical,encode,sha256} from '../policy.mjs';
import {developmentDigest,developmentScope,validateDevelopmentSuite,validateDevelopmentSuiteReport} from '../development-suite.mjs';
import {assessDevelopmentCase} from '../development-suite-assessment.mjs';
import {verifyWitness} from '../../ai-trainer/tactical-evidence.mjs';
const bounds={maxActions:8,milliseconds:1000,maxOperations:2000};
export async function developmentSuiteFixture({identityOverrides={}}={}){
 const objects=new Map(),put=async x=>{const bytes=encode(canonical(x)),sha=await sha256(bytes);objects.set(sha,bytes);return sha;},read=async b=>objects.get(b.sha256);
 const original=fixture.cases.find(c=>c.id==='G74-finish-near-miss');
 const prepared={id:original.id,state:original.state,stateHash:original.stateHash,...sourceQualification({sourceFamily:'S08',sourcePurpose:'exploratory'}),requests:[{name:'finish',actions:original.winningLine,expectedOutcome:'p2_win'}]};
 const packet={schema:1,kind:'prepared-development',sourcePacketSha256:'a'.repeat(64),cases:[prepared]},packetSha=await put(packet);
 const witness=await verifyWitness({state:prepared.state,stateHash:prepared.stateHash,actions:original.winningLine,expectedOutcome:'p2_win',...bounds});
 const receipt={kind:'development-evidence',packetSha256:packetSha,sourcePacketSha256:packet.sourcePacketSha256,cases:[{id:prepared.id,stateHash:prepared.stateHash,witnesses:[{name:'finish',...witness}]}]};
 const coverage={schema:1,kind:'development-suite-coverage',version:'synthetic-canonical+S05+S11-v1',packets:[{id:'canonical',sourcePacketSha256:packet.sourcePacketSha256}]};
 const c={key:'canonical/finish',packetId:'canonical',caseId:prepared.id,rootSha256:prepared.stateHash,family:'S08',scopeSha256:await developmentDigest(developmentScope(prepared)),disposition:'admitted',reason:'checked resulting terminal only',category:'rules-proven',critical:true,minimumCriticalMass:.6,acceptableRequests:['finish']};
 const profileSha=identityOverrides.profileSha256??'b'.repeat(64),identity={sourceRevision:'c'.repeat(40),dependencySha256:'d'.repeat(64),modelSha256:'e'.repeat(64),profileSha256:profileSha,...identityOverrides};
 const index={schema:1,kind:'development-suite-index',coverageSha256:await put(coverage),packets:[{...coverage.packets[0],preparedSha256:packetSha,preparationSha256:await put(receipt)}],cases:[c],profiles:[profileSha],criteria:{schema:1,families:[{family:'S08',minimumCases:1,minimumMassGain:.2,minimumAfterMass:.6}]}};
 async function assess(actions,mass,assessmentIdentity=identity){
  let state=structuredClone(prepared.state);const stepSearches=[];
  for(const [i,selected] of actions.entries()){
   const legal=[...legalActionMap(state).values()],distribution=legal.map(action=>({action,probability:i===0?(canonical(action)===canonical(original.winningLine[0])?mass:(1-mass)/(legal.length-1)):1/legal.length}));
   const search={schema:1,kind:'actual-search-assessment-record',disposition:'complete',...assessmentIdentity,rootSha256:deterministicStateHash(state),controller:state.sideToMove,action:selected,distribution};
   stepSearches.push(search);await put(search);state=transition(state,selected);
  }
  return assessDevelopmentCase({caseIndex:c,prepared,identity:assessmentIdentity,search:stepSearches[0],stepSearches,actions,bounds});
 }
 const before=await assess(original.nonwinningLine,.1),after=await assess(original.winningLine,.8);
 const report={schema:1,kind:'development-suite-report',indexSha256:await developmentDigest(index),purpose:'teacher-qualification',before:identity,after:identity,rows:[{caseKey:c.key,profileSha256:profileSha,beforeSha256:await put(before),afterSha256:await put(after)}],dose:{historicalAssessmentPositions:0,trainingProofs:[]}};
 return {index,report,read,put,objects,prepared,c,identity,before,after,coverage,assess,original};
}
