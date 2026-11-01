import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidanceDiagnostics} from '../board/guidance-diagnostics.js';
import {createGuidanceIncidentSink} from '../shell/guidance-diagnostics.js';
import {RUSH_GUIDANCE_TIMEOUT_MS} from '../board/rush-supply-guidance.js';

test('current guidance failures retain only normalized code, monotonic timing and the unchanged deadline',()=>{
 for(const code of ['rules_timeout','rules_cancelled','rules_budget_exceeded','empty_rush_guidance','unavailable']){
  const events=[];let now=10;const owner=createGuidanceDiagnostics(event=>events.push(event),{now:()=>now});
  const episode=owner.start();now=37;owner.failed(episode,{code,secret:'never-copy',state:{}});
  assert.deepEqual(events[1],{phase:'failed',episode:events[0].episode,code,stage:'request',elapsedMs:27,deadlineMs:RUSH_GUIDANCE_TIMEOUT_MS});
 }
 assert.equal(RUSH_GUIDANCE_TIMEOUT_MS,2000);
});
test('old success and cancellation cannot resolve a newer failure and every episode identity is unique',()=>{
 const events=[],owner=createGuidanceDiagnostics(event=>events.push(event));
 const first=owner.start();owner.resolved(first);const second=owner.start();owner.failed(second,{code:'rules_timeout'});
 owner.resolved(first);owner.failed(first,{code:'rules_cancelled'});
 assert.notEqual(first.id,second.id);assert.equal(events.at(-1).phase,'failed');
 owner.retire();assert.equal(events.at(-1).episode,second.id);assert.equal(events.at(-1).phase,'retired');
});
test('diagnostic sink exceptions never escape observation lifecycle',()=>{
 const owner=createGuidanceDiagnostics(()=>{throw Error('broken sink');});
 const episode=owner.start();assert.doesNotThrow(()=>owner.failed(episode,{code:'rules_timeout'}));
 assert.doesNotThrow(()=>owner.resolved(episode));assert.doesNotThrow(()=>owner.retire());
});
test('local incident sink deduplicates current failures and resolves only the exact episode',()=>{
 const captured=[],resolved=[];const sink=createGuidanceIncidentSink({gameId:'g',diagnostics:{capture:(key,data)=>captured.push({key,data}),resolve:key=>resolved.push(key)}});
 sink({phase:'started',episode:'first'});sink({phase:'failed',episode:'first',code:'rules_timeout',elapsedMs:21,deadlineMs:2000});
 sink({phase:'failed',episode:'first',code:'rules_timeout'});assert.equal(captured.length,1);
 sink({phase:'retired',episode:'first'});sink({phase:'started',episode:'second'});sink({phase:'failed',episode:'second',code:'unavailable'});
 sink({phase:'resolved',episode:'first'});assert.deepEqual(resolved,['guidance:g:first']);
 assert.equal(captured[0].data.operation,'rush_guidance');assert.equal('state' in captured[0].data,false);
 sink({phase:'resolved',episode:'second'});assert.deepEqual(resolved,['guidance:g:first','guidance:g:second']);
});
