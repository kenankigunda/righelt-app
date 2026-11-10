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
  assert.notEqual(corpus.positions[0].gameId, 'eligible'); assert.equal(corpus.positions.find(p=>p.partition!=='train').gameId, corpus.heldOut[0]);
});

test('seeded selection is order-independent and fresh guards contain no held-out states', () => {
  const positions=Array.from({length:200},(_,i)=>({gameId:'game',decisionId:`d-${i}`,stateHash:`s-${i}`,encodingHash:`e-${i}`,state:{outcome:{status:'ongoing'}},partition:'train',category:'ordinary',revision:i}));
  positions.push({...positions[0],gameId:'held',partition:'validation',state:{privateFinal:'must-not-upload'}});
  const source={positions,heldOut:['held'],reports:[{gameId:'game',partition:'train',currentStateVerified:true,verifiedDecisions:200,excluded:[]}],sha256:'source'};
  const options={salt:'a'.repeat(64),seed:107,guardOnly:true};
  const a=minimizeCorpus(source,options), b=minimizeCorpus({...source,positions:[...positions].reverse()},options);
  assert.deepEqual(a,b); assert.equal(a.corpus.positions.filter(p=>p.partition==='train').length,20);
  assert(a.corpus.positions.some(p=>p.partition==='train'&&p.revision>100));
  assert(!JSON.stringify(a.corpus).includes('privateFinal')); assert(a.corpus.curation.inclusionMapSha256);
});
