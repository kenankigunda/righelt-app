import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../report.mjs';
const base = { sourceRevision: 'source', checkpointSha256: 'model', corpusSha256: 'data', recipeSha256: 'recipe', executionRecipeSha256:'execution', workloadSha256: 'work', seed: 107, elapsedSeconds: 100, totalCents: 10, policyUsablePositions: 100, terminalValuePositions:100, distinctOutcomeTrajectories:2, distinctFamilies:2,sampledPositions:100, workload:{workIds:['a','b'],minimum:{policyUsablePositions:100,terminalValuePositions:100,distinctOutcomeTrajectories:2,distinctFamilies:2,sampledPositions:100}},attemptedWorkIds:['a','b'],completedWorkIds:['a','b'],verifiedWorkIds:['a','b'],failedWorkIds:[],unfinishedWorkIds:[], operatorSteps: 1, correctnessPassed: true, recoveryPassed: true, cleanupVerified: true };
test('host choice uses useful yield and does not claim stronger play', () => {
  const result = recommend([{ ...base, provider: 'hetzner' }, { ...base, provider: 'runpod', policyUsablePositions: 200 }]);
  assert.equal(result.winner, 'runpod'); assert.equal(result.strengthEstablished, false);
});
test('close yield favors simpler operation and incomplete recovery disqualifies hardware', () => {
  const a = { ...base, provider: 'hetzner' }, b = { ...base, provider: 'runpod', policyUsablePositions: 109, operatorSteps: 2 };
  assert.equal(recommend([a, b]).winner, 'hetzner');
  assert.equal(recommend([{ ...a, recoveryPassed: false }, b]).winner, 'runpod');
  assert.throws(() => recommend([a, { ...b, seed: 108 }]), /seed/);
});

test('zero yield and selectively completed workloads cannot win', () => {
  const a={...base,provider:'hetzner',policyUsablePositions:0}, b={...base,provider:'runpod',verifiedWorkIds:['a']};
  assert.equal(recommend([a,b]).outcome,'insufficient-evidence');
  assert.equal(recommend([a,b]).winner,null);
  assert.equal(recommend([{...a,correctnessPassed:false},{...b,recoveryPassed:false}]).outcome,'repair-required');
});
