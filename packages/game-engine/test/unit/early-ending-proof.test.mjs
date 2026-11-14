// EXPECTED_FUTURE_POLICY. Inactive same-sequence proof; no current-product bug claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proveRelevantContinuation } from '../../src/early-ending-proof.ts';
import { probeTerminalSettlement } from '../../src/terminal-settlement.ts';
import { applyAction,listLegalActions,validateAction,canCloseContinuationNow,serializeState,deterministicStateHash,
  MAX_ENGINE_OPERATION_EXPANSIONS,withEngineComputationGuard,EngineComputationLimit } from '../../src/index.ts';
import { commander,unit,makeState } from '../helpers/state-builders.mjs';
// Needed raw data only from exact supplied fixture SHA b34b977f446cac0e0c19db96e046f721f2ccbf4785bfd600201378661d13ecf3.
const raw={"boardSize":10,"sideToMove":"P1","turnIndex":0,"pieces":[{"id":"C1","owner":"P1","kind":"commander","position":{"row":3,"col":3},"supplied":true,"commanded":true},{"id":"C2","owner":"P2","kind":"commander","position":{"row":9,"col":0},"supplied":true,"commanded":true},{"id":"A","owner":"P1","kind":"unit","position":{"row":7,"col":3},"supplied":true,"commanded":true},{"id":"B","owner":"P1","kind":"unit","position":{"row":7,"col":5},"supplied":true,"commanded":true},{"id":"X","owner":"P1","kind":"unit","position":{"row":3,"col":5},"supplied":true,"commanded":true},{"id":"V0","owner":"P2","kind":"unit","position":{"row":0,"col":4},"supplied":true,"commanded":true},{"id":"V2","owner":"P2","kind":"unit","position":{"row":2,"col":4},"supplied":true,"commanded":true},{"id":"H0","owner":"P2","kind":"unit","position":{"row":5,"col":0},"supplied":true,"commanded":true},{"id":"H1","owner":"P2","kind":"unit","position":{"row":5,"col":4},"supplied":true,"commanded":true},{"id":"V8","owner":"P2","kind":"unit","position":{"row":8,"col":4},"supplied":true,"commanded":true},{"id":"V9","owner":"P2","kind":"unit","position":{"row":9,"col":4},"supplied":true,"commanded":true}],"continuation":{"type":"rush","owner":"P1","frozenOwner":"P1","frozenPieceStatesById":{"C1":{"supplied":true,"commanded":true},"A":{"supplied":true,"commanded":true},"B":{"supplied":true,"commanded":true},"X":{"supplied":true,"commanded":true}},"rushedPieceIds":["A"],"rushChainPieceIds":["A"],"chainLength":1},"outcome":{"status":"ongoing"}};
const family=()=>makeState(structuredClone(raw));
const lower={type:'rush',actorId:'B',from:{row:7,col:5},to:{row:7,col:4}};
const upper={type:'rush',actorId:'X',from:{row:3,col:5},to:{row:3,col:4}};
const close={type:'end_turn'};
const settled=state=>{if(state.outcome.status!=='ongoing')return structuredClone(state);const r=probeTerminalSettlement(state);assert.equal(r.kind,'settled');return r.frame.occupancy;};
const step=(state,action)=>{assert.ok(listLegalActions(state).some(a=>JSON.stringify(a)===JSON.stringify(action)),'complete current-legal membership');assert.equal(validateAction(state,action).ok,true);return applyAction(state,action).state;};
const path=(state,actions)=>actions.reduce((s,a)=>step(s,a),structuredClone(state));
const witness=(state,r)=>{assert.equal(r.kind,'continue');assert.equal(r.witness.complete,true);const end=path(state,r.witness.actions);assert.equal(end.continuation,null);assert.equal(serializeState(settled(end)),serializeState(r.witness.endpoint));return r.witness.endpoint;};
const spentExceptB=state=>{state.continuation.rushedPieceIds=state.pieces.filter(p=>p.owner==='P1'&&p.id!=='B').map(p=>p.id);return state;};
const optionalMulti=()=>{const s=family();s.continuation.rushChainPieceIds=['B'];s.continuation.rushedPieceIds=['A','C1'];return s;};
const defenderOnly=()=>{
 const pieces=[commander('C1','P1',0,9),commander('C2','P2',3,6),unit('V0','P1',0,4),unit('V2','P1',2,4),unit('H1','P1',5,4),unit('H9','P1',5,9),unit('V8','P1',8,4),unit('V9','P1',9,4),unit('bait','P2',1,5)];
 return makeState({pieces,continuation:{type:'rush',owner:'P1',frozenOwner:'P1',frozenPieceStatesById:Object.fromEntries(pieces.filter(p=>p.owner==='P1').map(p=>[p.id,{supplied:true,commanded:true}])),rushedPieceIds:pieces.filter(p=>p.owner==='P1'&&p.id!=='V0').map(p=>p.id),rushChainPieceIds:['C1'],chainLength:1}});
};
const pushFixture=(trapped=false)=>{
 const row=trapped?0:4,col=trapped?0:5;
 const pieces=[commander('C1','P1',trapped?0:3,trapped?9:6),unit('A','P1',row,col,{shifted:true}),commander('C2','P2',row,col,{pushed:true,supplied:false,commanded:false,shifted:false})];
 if(trapped)pieces.push(unit('wall-e','P1',0,2),unit('wall-se','P1',1,1),unit('wall-s','P1',2,0));
 const from=trapped?{row:0,col:1}:{row:4,col:4};
 const state=makeState({pieces,sideToMove:'P2',continuation:{type:'push',owner:'P2',attackerOwner:'P1',phase:'retreat',pushedPieceId:'C2',followPoint:from,followGroupPieceIds:['A'],chainLength:1}});
 // Synthetic caller-supplied acknowledged frame. No simulated branch manufactures a decision ID.
 return {state,push:{decisionId:'acknowledged-physical-frame',frameHash:deterministicStateHash(state),action:{type:'push',actorId:'A',targetId:'C2',from,to:{row,col}}}};
};
const diagnostic=(t,s,r)=>t.diagnostic(JSON.stringify({rootLegalActions:listLegalActions(s),kind:r.kind,reason:r.reason,witness:r.witness?.actions,endpoint:r.witness?.endpoint.outcome,endpointCount:r.endpointCount,optionalEndpointCount:r.optionalEndpointCount}));
if(process.env.CLOUD13_PROOF_CONTROL==='naive-finality'){
 test('behavioral control: physical settlement and nonrescuing prefix do not prove finality',{timeout:15000},()=>{
  const s=optionalMulti();assert.equal(canCloseContinuationNow(s),true);assert.equal(settled(s).outcome.status,'p2_win');
  assert.equal(settled(step(s,lower)).outcome.status,'p2_win');assert.equal(settled(path(s,[lower,upper,close])).outcome.status,'ongoing');
  assert.equal(settled(s).outcome.status!=='ongoing',false,'EXPECTED_FALSE_FINALITY: physical probe misses a complete legal attacker rescue');
 });
}else{
 test('R3 required alternatives preserve complete current-legal rescue',{timeout:15000},t=>{
  const s=family(),before=structuredClone(s),hash=deterministicStateHash(s),ordered=listLegalActions(s);
  assert.equal(canCloseContinuationNow(s),false);assert.equal(settled(s).outcome.status,'p2_win');assert.equal(settled(path(s,[lower,close])).outcome.status,'p2_win');assert.equal(settled(path(s,[upper,lower,close])).outcome.status,'ongoing');
  const r=proveRelevantContinuation(s,'P1');assert.equal(witness(s,r).outcome.status,'ongoing');assert.deepEqual(r.rootLegalActions,ordered);assert.deepEqual(s,before);assert.equal(deterministicStateHash(s),hash);diagnostic(t,s,r);
 });
 // SOURCE-DERIVED proposal; Cloud17 does not execute the engine or claim a
 // verified divergence. The pinned run must establish every assertion below.
 test('initial candidate rescue attribution survives a real required prefix',{timeout:15000},t=>{
  const s=family(),baseLegal=listLegalActions(s);
  // Add an unspent, supplied-side actor, rather than disabling/filtering any
  // existing legal choice. Original A is side P1 / commander C1, NOT unit A.
  s.pieces.push(unit('Y','P1',7,6));
  s.continuation.frozenPieceStatesById.Y={supplied:true,commanded:true};
  const before=structuredClone(s),ordered=listLegalActions(s);
  for(const action of baseLegal)assert.ok(ordered.some(candidate=>JSON.stringify(candidate)===JSON.stringify(action)),'adding Y must not narrow the supplied family Legal list');
  const rootPhysical=settled(s);
  assert.equal(s.sideToMove,'P1');assert.equal(canCloseContinuationNow(s),false);
  assert.equal(rootPhysical.outcome.status,'p2_win');
  assert.equal(rootPhysical.pieces.find(piece=>piece.id==='C1').supplied,false);
  // All three edges are required: the commander moves first, the lower gate
  // reconnects unit A, and the upper gate reconnects original commander C1.
  const commanderPrefix={type:'rush',actorId:'C1',from:{row:3,col:3},to:{row:2,col:3}};
  assert.deepEqual(ordered[0],commanderPrefix,'control depends on native first-witness order, never a filtered Legal list');
  const required=[commanderPrefix,lower,upper];
  let current=structuredClone(s);
  for(const action of required){
   assert.equal(canCloseContinuationNow(current),false,'prefix edge is mandatory, not an optional branch');
   current=step(current,action);
  }
  assert.equal(current.outcome.status,'ongoing');assert.equal(canCloseContinuationNow(current),true);
  assert.equal(settled(current).outcome.status,'ongoing');
  assert.equal(settled(current).pieces.find(piece=>piece.id==='C1').supplied,true);
  // Existing real enumeration supplies the entire optional legal list. This
  // extension keeps A alive through an actual End Turn, not a stopped prefix.
  const optional={type:'rush',actorId:'Y',from:{row:7,col:6},to:{row:7,col:5}};
  const closableLegal=listLegalActions(current);
  assert.ok(closableLegal.some(action=>action.type==='end_turn'));
  const afterOptional=step(current,optional);
  assert.equal(canCloseContinuationNow(afterOptional),true);
  const expectedEnd=settled(step(afterOptional,close));
  assert.equal(expectedEnd.continuation,null);assert.equal(expectedEnd.outcome.status,'ongoing');
  assert.equal(expectedEnd.pieces.find(piece=>piece.id==='C1').supplied,true);

  // The input Cloud13 source is expected to call this outcome-change instead:
  // it disables optional self-rescue using the later already-alive physical A.
  // The corrected root-scoped quantifier must retain the complete optional
  // witness. This control expectation is UNRUN, not observed failing-first.
  const r=proveRelevantContinuation(s,'P1');
  assert.equal(r.kind,'continue');assert.equal(r.reason,'attacker-rescue');
  assert.deepEqual(r.rootLegalActions,ordered);
  assert.deepEqual(r.witness.actions,[...required,optional,close]);
  const endpoint=witness(s,r);
  assert.equal(endpoint.pieces.find(piece=>piece.id==='C1').supplied,true);
  assert.deepEqual(s,before);
  t.diagnostic(JSON.stringify({initialOriginalOwner:'P1',rootPhysical:rootPhysical.outcome,
   requiredPrefix:required,closablePhysical:settled(current).outcome,closableLegalActions:closableLegal,
   completeWitness:r.witness.actions,endpoint:endpoint.outcome}));
 });
 test('R5 legal closure retains optional attacker rescue',{timeout:15000},t=>{
  const s=step(family(),lower);assert.equal(canCloseContinuationNow(s),true);assert.equal(settled(s).outcome.status,'p2_win');const r=proveRelevantContinuation(s,'P1');assert.equal(r.reason,'attacker-rescue');assert.equal(witness(s,r).outcome.status,'ongoing');diagnostic(t,s,r);
 });
 test('optional multi-step rescue keeps a first nonrescuing prefix',{timeout:15000},t=>{
  const s=optionalMulti();assert.equal(canCloseContinuationNow(s),true);assert.equal(settled(step(s,lower)).outcome.status,'p2_win');assert.equal(settled(path(s,[lower,upper,close])).outcome.status,'ongoing');
  const r=proveRelevantContinuation(s,'P1');assert.equal(r.reason,'attacker-rescue');assert.ok(r.witness.actions.length>=3);assert.equal(settled(step(s,r.witness.actions[0])).outcome.status,'p2_win');assert.equal(witness(s,r).outcome.status,'ongoing');diagnostic(t,s,r);
 });
 test('optional defender-only rescue is ignored while A already survives',{timeout:15000},t=>{
  const s=defenderOnly(),before=structuredClone(s);assert.equal(canCloseContinuationNow(s),true);assert.equal(settled(s).outcome.status,'p1_win');
  assert.equal(settled(path(s,[{type:'rush',actorId:'V0',from:{row:0,col:4},to:{row:0,col:5}},close])).outcome.status,'ongoing');
  const r=proveRelevantContinuation(s,'P1');assert.equal(r.kind,'proven-terminal');assert.equal(r.candidateOutcome.status,'p1_win');assert.ok(r.endpointCount>0);assert.ok(r.optionalEndpointCount>0);assert.deepEqual(r.rootLegalActions,listLegalActions(s));assert.deepEqual(s,before);diagnostic(t,s,r);
 });
 test('all required legal endpoints agree on terminal status',{timeout:15000},t=>{
  const s=spentExceptB(family());assert.equal(canCloseContinuationNow(s),false);const r=proveRelevantContinuation(s,'P1');assert.equal(r.kind,'proven-terminal');assert.equal(r.candidateOutcome.status,'p2_win');assert.equal(r.complete,true);assert.ok(r.endpointCount>0);assert.deepEqual(r.rootLegalActions,listLegalActions(s));diagnostic(t,s,r);
 });
 test('one required win-to-draw status change prevents finality',{timeout:15000},t=>{
  const s=family();s.pieces.find(p=>p.id==='A').position.col=2;s.pieces.find(p=>p.id==='C2').position={row:7,col:3};s.pieces.push(unit('north','P1',6,3),unit('south','P1',8,3));for(const id of ['north','south'])s.continuation.frozenPieceStatesById[id]={supplied:true,commanded:true};spentExceptB(s);
  assert.equal(settled(s).outcome.status,'p2_win');assert.equal(settled(path(s,[lower,close])).outcome.status,'draw');const r=proveRelevantContinuation(s,'P1');assert.equal(r.reason,'outcome-change');assert.equal(witness(s,r).outcome.status,'draw');diagnostic(t,s,r);
 });
 test('required defender retreat uses original A, not temporary sideToMove',{timeout:15000},t=>{
  const {state:s,push}=pushFixture();assert.equal(s.sideToMove,'P2');const r=proveRelevantContinuation(s,'P1',{push});assert.equal(r.reason,'outcome-change');assert.equal(witness(s,r).outcome.status,'ongoing');assert.equal(proveRelevantContinuation(s,'P2',{push}).kind,'unknown');diagnostic(t,s,r);
 });
 test('outcome key ignores destroyed-versus-unsupplied reason text',{timeout:15000},t=>{
  const {state:s,push}=pushFixture(true);const candidate=probeTerminalSettlement(s,push);assert.equal(candidate.kind,'settled');assert.equal(candidate.frame.occupancy.outcome.reason,'p2_commander_destroyed');const all=listLegalActions(s);assert.ok(all.length>0);
  for(const action of all){const end=settled(path(s,[action,close]));assert.equal(end.outcome.status,'p1_win');assert.equal(end.outcome.reason,'p2_commander_unsupplied');}
  const r=proveRelevantContinuation(s,'P1',{push});assert.equal(r.kind,'proven-terminal');assert.equal(r.endpointCount,all.length);diagnostic(t,s,r);
 });
 test('missing/mismatched push acknowledgement is unknown, never fabricated',{timeout:15000},()=>{
  const {state:s,push}=pushFixture(),before=structuredClone(s);assert.equal(proveRelevantContinuation(s,'P1').kind,'unknown');assert.equal(proveRelevantContinuation(s,'P1',{push:{...push,frameHash:'0'.repeat(64)}}).kind,'unknown');assert.deepEqual(s,before);
 });
 test('ongoing candidate continues without an invented completed witness',{timeout:15000},()=>{
  const r=proveRelevantContinuation(path(family(),[upper,lower]),'P1');assert.equal(r.kind,'continue');assert.equal(r.reason,'candidate-ongoing');assert.equal(r.candidate.outcome.status,'ongoing');assert.equal('witness' in r,false);
 });
 test('completed public history is unknown while legal internal endpoints are accepted',{timeout:15000},()=>{
  const s=spentExceptB(family());assert.equal(proveRelevantContinuation(s,'P1').kind,'proven-terminal');const historical=settled(path(s,[lower,close])),before=structuredClone(historical);assert.equal(proveRelevantContinuation(historical,'P1').kind,'unknown');assert.deepEqual(historical,before);
 });
 test('incoming Pass remains outside this evaluator',{timeout:15000},()=>{
  const s=makeState({pieces:[commander('C1','P1',0,9),commander('C2','P2',9,0)]});assert.equal(validateAction(s,{type:'pass'}).ok,true);assert.equal(proveRelevantContinuation(s,'P1').reason,'outside-sequence');
 });
 test('tiny budget is unknown; later sufficient proof is not poisoned',{timeout:15000},()=>{
  const s=spentExceptB(family()),before=structuredClone(s);const r=proveRelevantContinuation(s,'P1',{maxExpansions:1});assert.equal(r.kind,'unknown');assert.equal(r.reason,'rules_budget_exceeded');assert.equal(proveRelevantContinuation(s,'P1',{maxExpansions:MAX_ENGINE_OPERATION_EXPANSIONS}).kind,'proven-terminal');assert.deepEqual(s,before);
 });
 test('typed interruption is unknown; genuine dependency error propagates',{timeout:15000},()=>{
  const s=spentExceptB(family());let n=0;const r=withEngineComputationGuard(()=>{if(++n===3)throw new EngineComputationLimit();},()=>proveRelevantContinuation(s,'P1'));assert.equal(r.kind,'unknown');assert.equal(proveRelevantContinuation(s,'P1').kind,'proven-terminal');
  const real=new Error('genuine dependency failure');n=0;assert.throws(()=>withEngineComputationGuard(()=>{if(++n===2)throw real;},()=>proveRelevantContinuation(s,'P1')),e=>e===real);
 });
 for(const cap of [0,-1,1.5,NaN,Infinity,MAX_ENGINE_OPERATION_EXPANSIONS+1])test(`invalid lower-only cap ${cap}`,{timeout:15000},()=>assert.throws(()=>proveRelevantContinuation(family(),'P1',{maxExpansions:cap}),TypeError));
 test('invalid explicit owner is rejected, never inferred',{timeout:15000},()=>{assert.throws(()=>proveRelevantContinuation(family(),'P3'),TypeError);assert.equal(proveRelevantContinuation(family(),'P2').kind,'unknown');});
 test('witness actions/endpoint do not alias caller or each other',{timeout:15000},()=>{
  const s=family(),before=structuredClone(s),r=proveRelevantContinuation(s,'P1');witness(s,r);const refs=(v,set=new Set())=>{if(v&&typeof v==='object'&&!set.has(v)){set.add(v);for(const x of Object.values(v))refs(x,set);}return set;};const seen=refs(s);
  for(const group of [...r.witness.actions,r.witness.endpoint]){const own=refs(group);for(const ref of own)assert.equal(seen.has(ref),false);for(const ref of own)seen.add(ref);}
  r.witness.actions.find(a=>a.to).to.row=99;r.witness.endpoint.pieces[0].position.row=99;assert.deepEqual(s,before);witness(s,proveRelevantContinuation(s,'P1'));
 });
}
