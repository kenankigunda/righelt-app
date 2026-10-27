import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// One captured regression, shared with the engine/API/archive tests. Do not
// regenerate its expected states from the implementation under test.
export const RETREAT_CAPTURE_SHA256='21f75915fef8c0eeb2a4070a44dc84eaddc6c890190e7269a32c2ca273c25236';
const bytes=readFileSync(new URL('../../packages/game-engine/test/fixtures/completion-preserving-retreat.json',import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'),RETREAT_CAPTURE_SHA256,'Captured retreat regression changed; review provenance before changing the native proof');
const captured=JSON.parse(bytes);
assert.equal(captured.provenance.sourceReceiptSha256,'5138f908367a26d1a985f0d5ae43a065d74939a537947de452f64cf3fad2a3c3');
export const readRetreatCapture=()=>structuredClone(captured);
export const FOLLOW_ACTION={type:'follow',actorId:'U2-15',from:{row:3,col:1},to:{row:4,col:1}};

export function makeRetreatScenario(kind){
 const identities={human:'a6f4954d-1500-4a15-8a2f-24b1e9807101',computer:'a6f4954d-1500-4a15-8a2f-24b1e9807102',retained:'a6f4954d-1500-4a15-8a2f-24b1e9807103'};
 assert.ok(Object.hasOwn(identities,kind),'Unknown native retreat fixture');
 const f=readRetreatCapture(),safe=f.alternatives.find(row=>row.completable),retained=kind==='retained';
 const semantics=retained?'geometric-retreat-v1':'completion-preserving-retreat-v2';
 const actions=kind==='human'?[]:[f.push.action,retained?f.retreat.action:safe.action];
 const resultingState=kind==='human'?f.states.prePush:retained?f.states.afterRetreat:safe.state;
 return {formatVersion:2,id:identities[kind],title:`Completion-preserving retreat ${kind}`,description:`Captured retreat regression ${RETREAT_CAPTURE_SHA256}`,incorrect:false,
  initialState:structuredClone(f.states.prePush),moves:actions.map((action,index)=>({turnIndex:f.states.prePush.turnIndex,turnMoveIndex:index,actorSide:index===0?'P2':'P1',notation:index===0?'Push':'Retreat',action:structuredClone(action),retreatSemantics:semantics})),
  resultingState:structuredClone(resultingState),expectedFinalStateHash:kind==='human'?f.push.beforeHash:retained?f.retreat.afterHash:safe.stateHash,expectedOutcome:'ongoing',savedSelection:null};
}
