import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionRuleCache, withDecisionRuleCache, completedDecisionRule, withEngineComputationGuard,
  createInitialState, isContinuationCompletable, buildContinuationSuccessorState } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';

const state=createInitialState();
test('completed positive and negative answers are cached, but interruptions and cancellation are not',()=>{
  const cache=new DecisionRuleCache();let calls=0;
  const ask=(s,operation)=>withDecisionRuleCache(cache,()=>completedDecisionRule('rule',s,operation));
  assert.throws(()=>ask(state,()=>{throw new Error('interrupted');}),/interrupted/);
  assert.equal(cache.stats.stores,0);
  assert.equal(ask(state,()=>{calls++;return false;}),false);
  assert.equal(ask(state,()=>{calls++;return true;}),false);assert.equal(calls,1);
  const stopped=new Error('cancelled');
  assert.throws(()=>withEngineComputationGuard(()=>{throw stopped;},()=>ask(state,()=>true)),error=>error===stopped);
  const next={...state,turnIndex:state.turnIndex+1};assert.equal(ask(next,()=>true),true);
  assert.equal(cache.stats.hits,1);assert.equal(cache.stats.stores,2);
});

test('full keys separate frozen values, flags, controller, identity, context and ordering',()=>{
  const base={...state,continuation:{type:'rush',owner:'P1',frozenOwner:'P1',chainLength:1,
    frozenPieceStatesById:{C1:{supplied:false,commanded:false}},rushedPieceIds:['C1'],rushChainPieceIds:['C1']}};
  const changes=[s=>s.continuation.frozenPieceStatesById.C1.supplied=true,
    s=>s.continuation.frozenPieceStatesById.C1.commanded=true,s=>delete s.continuation.frozenPieceStatesById.C1,
    s=>s.pieces[0].supplied=!s.pieces[0].supplied,s=>s.pieces[0].commanded=!s.pieces[0].commanded,
    s=>s.pieces[0].pushed=true,s=>s.pieces[0].shifted=true,s=>s.pieces[0].id+='new',
    s=>s.pieces.reverse(),s=>s.sideToMove='P2',s=>s.continuation.owner='P2',s=>s.continuation.rushedPieceIds=[],
    s=>s.continuation.rushChainPieceIds=[],s=>s.continuation.followPoint={row:1,col:1},s=>s.turnIndex++];
  const cache=new DecisionRuleCache();let calls=0;
  withDecisionRuleCache(cache,()=>{
    completedDecisionRule('rule',base,()=>{calls++;return true;});
    for(const change of changes){const changed=structuredClone(base);change(changed);
      completedDecisionRule('rule',changed,()=>{calls++;return false;});}
  });
  assert.equal(calls,changes.length+1);assert.equal(cache.stats.hits,0);
});

test('cache eviction, oversized entries and nested scope restoration are bounded',async()=>{
  const cache=new DecisionRuleCache({maxEntries:1,maxEstimatedBytes:200});
  cache.store('a',true);cache.store('b',false);assert.equal(cache.read('a'),undefined);
  assert.equal(cache.read('b'),false);assert.equal(cache.stats.evictions,1);
  cache.store('x'.repeat(200),true);assert.equal(cache.stats.oversized,1);assert.ok(cache.stats.estimatedBytes<=200);
  const outer=new DecisionRuleCache(),inner=new DecisionRuleCache();
  withDecisionRuleCache(outer,()=>{
    assert.throws(()=>withDecisionRuleCache(inner,()=>{throw new Error('nested');}),/nested/);
    completedDecisionRule('rule',state,()=>true);
  });
  assert.equal(outer.stats.stores,1);assert.equal(inner.stats.stores,0);
  assert.throws(()=>withDecisionRuleCache(outer,()=>Promise.resolve()),/synchronous/);
  await Promise.resolve();completedDecisionRule('other',state,()=>false);assert.equal(outer.stats.stores,1);
});

test('interrupted recursive continuation never poisons a later complete check',()=>{
  const raw=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),
    unit('A','P1',4,4),unit('B','P1',5,5),unit('E0','P2',0,4),unit('E1','P2',9,4),unit('E2','P2',4,2)]});
  const state=buildContinuationSuccessorState(raw,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  const before=structuredClone(state),cache=new DecisionRuleCache();let used=0;
  withDecisionRuleCache(cache,()=>{
    assert.throws(()=>withEngineComputationGuard(expansion=>{if(expansion&&++used>2)throw new Error('limit');},()=>isContinuationCompletable(state)),/limit/);
    assert.equal(cache.stats.stores,0);assert.equal(isContinuationCompletable(state),true);
    assert.equal(isContinuationCompletable(state),true);assert.equal(cache.stats.hits,1);
  });
  assert.deepEqual(state,before);assert.equal(isContinuationCompletable(state),true);
});
