import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceOutcome} from '../resource-outcome.mjs';
import {fixture} from './helpers.mjs';
import {CLOUD_REPAIR} from '../cloud-repair-policy.mjs';

test('bound native telemetry/pressure failures remain resource interruptions and never restart',async()=>{
 for(const reason of ['telemetry-failed','resource-interrupted','resource-pressure-stop']){
  const manifest={exploratory:{schema:2,episodeId:CLOUD_REPAIR.id,canonicalPlanSha256:'a'.repeat(64)}};
  const outcome=resourceOutcome(manifest,{planSha256:'a'.repeat(64),reason});assert.deepEqual(outcome,{kind:'resource-interrupted',resourceReason:reason});
  assert.equal(resourceOutcome(manifest,{planSha256:'b'.repeat(64),reason}),null);
  const f=await fixture();await f.launch();const db=await f.core.load();
  db.campaigns.pilot.manifest.exploratory={schema:2,episodeId:CLOUD_REPAIR.id};await f.core.save(db);
  await f.core.finish('pilot',1,outcome);const failed=await f.state();
  assert.equal(failed.failure,'resource-interrupted');assert.equal(failed.resourceInterruption.reason,reason);assert.equal(failed.nextStatus,'failed');assert.equal(f.providers.creates,1);
 }
 assert.equal(resourceOutcome({exploratory:{canonicalPlanSha256:'a'.repeat(64)}},{planSha256:'a'.repeat(64),reason:'unplanned-correctness'}),null);
 assert.equal(resourceOutcome({exploratory:{schema:1,canonicalPlanSha256:'a'.repeat(64)}},{planSha256:'a'.repeat(64),reason:'telemetry-failed'}),null);
});
