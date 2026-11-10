import test from 'node:test';
import assert from 'node:assert/strict';
import { minimizeCorpus } from '../curate.mjs';
test('curation preserves held-out guards, excludes replay failures and removes historical labels and source identities', () => {
  const report = (id, extra = {}) => ({ gameId: id, partition: 'train', currentStateVerified: true, verifiedDecisions: 2, excluded: [], ...extra });
  const position = (id, partition = 'train') => ({ gameId: id, decisionId: `decision-${id}`, state: { outcome: { status: 'ongoing' } }, partition, revision: 1, category: 'ordinary', stateHash: id, encodingHash: id, historicalAction: 'not-an-optimal-target', computerProof: { account: 'private' } });
  const source = { reports: [report('eligible'), report('broken', { excluded: ['bad move'] }), report('held', { partition: 'validation' })],
    positions: [position('eligible'), position('broken'), position('held', 'validation')], heldOut: ['held'], sha256: 'source-hash' };
  const { corpus, inclusion } = minimizeCorpus(source, { salt: 'a'.repeat(64) });
  assert.equal(corpus.positions.length, 2); assert.equal(inclusion.included.length, 1);
  assert.equal(inclusion.excluded.length, 2); assert.equal(corpus.rawHistoricalPolicyTargets, false);
  assert(!JSON.stringify(corpus).includes('private')); assert(!('historicalAction' in corpus.positions[0]));
  assert.notEqual(corpus.positions[0].gameId, 'eligible'); assert.equal(corpus.positions[1].gameId, corpus.heldOut[0]);
});
