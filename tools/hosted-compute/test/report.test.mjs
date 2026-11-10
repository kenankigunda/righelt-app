import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../report.mjs';
const base = { sourceRevision: 'source', checkpointSha256: 'model', corpusSha256: 'data', recipeSha256: 'recipe', workloadSha256: 'work', seed: 107, elapsedSeconds: 100, totalCents: 10, usefulTargets: 100, terminalGames: 2, operatorSteps: 1, correctnessPassed: true, recoveryPassed: true, cleanupVerified: true };
test('host choice uses useful yield and does not claim stronger play', () => {
  const result = recommend([{ ...base, provider: 'hetzner' }, { ...base, provider: 'runpod', usefulTargets: 200 }]);
  assert.equal(result.winner, 'runpod'); assert.equal(result.strengthEstablished, false);
});
test('close yield favors simpler operation and incomplete recovery disqualifies hardware', () => {
  const a = { ...base, provider: 'hetzner' }, b = { ...base, provider: 'runpod', usefulTargets: 109, operatorSteps: 2 };
  assert.equal(recommend([a, b]).winner, 'hetzner');
  assert.equal(recommend([{ ...a, recoveryPassed: false }, b]).winner, 'runpod');
  assert.throws(() => recommend([a, { ...b, seed: 108 }]), /seed/);
});
