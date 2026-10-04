import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectMove, transition } from '../src/index.ts';
import { createInitialState, deterministicStateHash } from '../../game-engine/src/index.ts';
const retained=JSON.parse(readFileSync(new URL('./fixtures/partial-root-legality.json',import.meta.url)));
const evaluate=async()=>({policyLogits:new Float32Array(2801),value:.125});

test('decision cache stays opt-in and preserves exact choices, legality and replay on frozen workloads',async()=>{
  for(const state of [createInitialState(),retained]){
    const request={state,seed:107,simulations:8};
    const disabled=await selectMove(request,evaluate);
    const enabled=await selectMove({...request,decisionCache:true},evaluate);
    assert.equal(disabled.decisionCache,undefined);assert.equal(enabled.status,disabled.status);
    assert.equal(enabled.actionIndex,disabled.actionIndex);assert.deepEqual(enabled.legality,disabled.legality);
    assert.deepEqual(enabled.policy,disabled.policy);assert.deepEqual(enabled.fallback,disabled.fallback);
    assert.deepEqual(enabled.actions,disabled.actions);
    assert.equal(deterministicStateHash(enabled.nextState),deterministicStateHash(transition(state,enabled.action)));
    assert.ok(enabled.decisionCache.hits>0);assert.ok(enabled.decisionCache.entries<=512);
    assert.ok(enabled.decisionCache.estimatedBytes<=4*1024*1024);
    const repeated=await selectMove({...request,decisionCache:true},evaluate);
    assert.deepEqual(repeated.decisionCache,enabled.decisionCache); // New cache every decision.
  }
});
