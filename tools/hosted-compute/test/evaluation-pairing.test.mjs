import test from 'node:test';
import assert from 'node:assert/strict';
import packet from '../../ai-trainer/tests/fixtures/s05-effects-v1.json' with {type:'json'};
import {expectedEvaluationStart} from '../../ai-trainer/evaluation-start.mjs';
import {validateEvaluationPairing} from '../experiment.mjs';

function schedule(arm,state=packet.cases[0].rootState){
 return ['P1','P2'].map(candidateSeat=>{
  const job={id:arm+'-'+candidateSeat,arm,pairId:'same-pair',profile:'horus',candidateSeat,role:'candidate',partition:'validation',
   familyId:'S05-family',sourceFamily:'S05',seed:107,startKind:'developed',kind:'simple',initialState:structuredClone(state),gameSeconds:60};
  return {...job,startIdentity:expectedEvaluationStart(job)};
 });
}

test('portable admission retains exact native-constructed starts while allowing arm and job ID changes',()=>{
 const control=schedule('control'),treatment=schedule('treatment').reverse();
 assert.equal(validateEvaluationPairing(control,treatment),true);
 const recanonicalized=JSON.parse(JSON.stringify(treatment));recanonicalized[0].initialState=Object.fromEntries(Object.entries(recanonicalized[0].initialState).reverse());
 assert.equal(validateEvaluationPairing(control,recanonicalized),true);
});

test('same-family different boards and changed declared identities fail within pairs and across arms',()=>{
 const control=schedule('control'),different=schedule('treatment',packet.cases[1].rootState);
 assert.throws(()=>validateEvaluationPairing(control,different),/schedules differ/);
 const changedPair=schedule('control');changedPair[1]=different[1];
 assert.throws(()=>validateEvaluationPairing(changedPair),/paired seats differ/);
 const forged=schedule('treatment');for(const j of forged)j.startIdentity.stateHash='0'.repeat(64);
 assert.throws(()=>validateEvaluationPairing(control,forged),/schedules differ/);
 const sameClaim=schedule('treatment',packet.cases[1].rootState);for(const j of sameClaim)j.startIdentity=structuredClone(control[0].startIdentity);
 assert.throws(()=>validateEvaluationPairing(control,sameClaim),/schedules differ/);
});

test('portable start construction rejects custom normal boards and non-ID workload differences',()=>{
 const pair=schedule('control');for(const j of pair){j.kind='normal';j.startKind='normal';j.startIdentity={...j.startIdentity,kind:'normal',startKind:'normal'};}
 assert.throws(()=>validateEvaluationPairing(pair),/construction differs/);
 const control=schedule('control');
 for(const change of [j=>j.seed++,j=>j.sourceFamily='different-source',j=>j.gameSeconds++,j=>j.initialState.pieces.reverse()]){
  const treatment=schedule('treatment');treatment.forEach(change);assert.throws(()=>validateEvaluationPairing(control,treatment),/schedules differ/);
 }
 const missing=schedule('control').slice(0,1);assert.throws(()=>validateEvaluationPairing(missing),/paired evaluation seats/);
});
