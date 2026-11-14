// Bounded witness checking for preparation, shared by hosted and local trainers.
// Uses the common rules engine. This is not a second search engine or a solver.
import { deterministicStateHash } from '../../packages/game-engine/src/index.ts';
import { transition, legalActionMap, terminalValue } from '../../packages/computer-player/src/index.ts';
import { createEngineOperationBudget, EngineExpansionLimit } from './engine-operation-budget.mjs';
import { canonical, encode, sha256, assert } from '../hosted-compute/policy.mjs';

export async function verifyWitness({ state, stateHash, actions, expectedOutcome, maxActions, milliseconds, maxOperations }) {
  assert(state && deterministicStateHash(state) === stateHash, 'tactical root identity mismatch');
  assert(Array.isArray(actions) && actions.length > 0 && Number.isSafeInteger(maxActions) && maxActions > 0 &&
    Number.isFinite(milliseconds) && milliseconds > 0 && Number.isSafeInteger(maxOperations) && maxOperations > 0, 'explicit bounded witness required');
  const deadline=performance.now()+milliseconds;
  class Interrupted extends Error {}
  const {bounded,stats}=createEngineOperationBudget('replay',maxOperations,()=>{
    if(performance.now()>=deadline || stats.operations>maxOperations)throw new Interrupted('bounded-work');
  });
  let current=structuredClone(state),completedTurns=0;
  const steps=[];
  let disposition='complete';
  try {
    for(const action of actions) {
      if(steps.length>=maxActions){disposition='action-horizon';break;}
      assert(current.outcome.status==='ongoing','witness extends beyond settled terminal');
      const controller=current.sideToMove, beforeHash=deterministicStateHash(current), turn=current.turnIndex;
      const legal=bounded(()=>[...legalActionMap(current).values()]);
      assert(legal.some(a=>canonical(a)===canonical(action)),'witness action is not legal for actual controller');
      current=bounded(()=>transition(current,action));
      completedTurns+=current.turnIndex!==turn?1:0;
      steps.push({action,controller,beforeHash,afterHash:deterministicStateHash(current),outcome:current.outcome.status,
        continuation:current.continuation?.type??null,legalAlternatives:legal.length});
    }
  } catch(error) {
    if(error instanceof Interrupted || error instanceof EngineExpansionLimit)disposition='incomplete';
    else throw error;
  }
  const outcome=current.outcome.status;
  const sameController=steps.every(s=>s.controller===state.sideToMove);
  const rootWin=outcome===(state.sideToMove==='P1'?'p1_win':'p2_win');
  const complete=disposition==='complete' && steps.length===actions.length;
  return {schema:1,kind:'tactical-witness',rootHash:stateHash,actionsSha256:await sha256(encode(canonical(actions))),
    requestedActions:actions.length,completedActions:steps.length,requestedMaxActions:maxActions,completedTurns,
    disposition,steps,finalHash:deterministicStateHash(current),outcome,
    expectedOutcomeMatched:complete && outcome===expectedOutcome,
    // Opponent alternatives were not enumerated. A line involving their choices
    // is a witness only, never a forced win or a safe-defense proof.
    winningContinuation:complete && rootWin && sameController,
    terminalValueP1:complete ? terminalValue(current)??null:null, terminalValueScope:'resulting-terminal-state-only',rootOptimalValueP1:null,
    finalPieceCounts:{P1:current.pieces.filter(p=>p.owner==='P1').length,P2:current.pieces.filter(p=>p.owner==='P2').length},
    globalSafetyProven:false,globalShortestProven:false,acceptableActionSetComplete:false,engineWork:stats};
}

export async function verifyTurnDefense(certificate, {milliseconds,maxNodes}) {
  assert(Number.isFinite(milliseconds)&&milliseconds>0&&Number.isSafeInteger(maxNodes)&&maxNodes>0,'bounded defense verification required');
  assert(deterministicStateHash(certificate.rootState)===certificate.rootStateHash,'defense root mismatch');
  const deadline=performance.now()+milliseconds, defender=certificate.rootState.sideToMove;
  class Interrupted extends Error {}
  let visited=0;
  const {bounded,stats}=createEngineOperationBudget('replay',maxNodes,()=>{if(performance.now()>=deadline)throw new Interrupted();});
  const nodes=new Map(certificate.nodes.map(n=>[n.id,n]));
  assert(nodes.size===certificate.nodes.length,'duplicate certificate node');
  const legal=bounded(()=>[...legalActionMap(certificate.rootState).values()]);
  assert(legal.some(a=>canonical(a)===canonical(certificate.defense)),'illegal defensive choice');
  const start=bounded(()=>transition(certificate.rootState,certificate.defense)),seen=new Set();
  function check(state,id,previousDepth=Infinity) {
    if(++visited>maxNodes||performance.now()>=deadline)throw new Interrupted();
    const n=nodes.get(id),hash=deterministicStateHash(state);
    assert(n&&n.hash===hash&&n.controller===state.sideToMove&&Number.isSafeInteger(n.depth)&&n.depth>=0&&n.depth<previousDepth,'certificate state/controller/depth mismatch');
    if(seen.has(id))return;
    if(n.kind==='turn-boundary') {
      assert(state.outcome.status==='ongoing'&&!state.continuation&&state.sideToMove===defender&&state.turnIndex>start.turnIndex,'false complete-opponent-turn boundary');
      assert(n.edges.length===0,'boundary has unverified edges'); seen.add(id);return;
    }
    assert(n.kind==='choice'&&n.depth>0&&state.outcome.status==='ongoing','unknown, horizon or terminal certificate leaf');
    const actions=bounded(()=>[...legalActionMap(state).values()]),keys=actions.map(canonical).sort(),edges=n.edges.map(e=>canonical(e.action)).sort();
    assert(edges.length>0&&new Set(edges).size===edges.length&&edges.every(k=>keys.includes(k)),'illegal or duplicate certificate alternatives');
    if(state.sideToMove!==defender)assert(canonical(edges)===canonical(keys),'missing opponent alternative');
    for(const edge of n.edges)check(bounded(()=>transition(state,edge.action)),edge.child,n.depth);
    seen.add(id);
  }
  try {
    check(start,certificate.proofRoot);
    return {schema:1,kind:'scoped-turn-defense',disposition:'complete',scope:'No forced opponent win during the next complete opposing turn only.',
      rootHash:certificate.rootStateHash,defender,verifiedNodes:seen.size,globalSafetyProven:false,terminalValueP1:null,
      certificateCanonicalSha256:await sha256(encode(canonical(certificate))),engineWork:stats};
  } catch(error) {
    if(error instanceof Interrupted||error instanceof EngineExpansionLimit)return {schema:1,kind:'scoped-turn-defense',disposition:'incomplete',verifiedNodes:seen.size,globalSafetyProven:false,terminalValueP1:null,engineWork:stats};
    throw error;
  }
}
