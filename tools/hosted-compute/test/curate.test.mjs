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

test('source purpose and actor survive curation, undo branches stay out and unresolved prefixes stay usable',()=>{
 const report={gameId:'probe',partition:'train',currentStateVerified:false,activeLineVerified:true,verifiedDecisions:2,excluded:[]};
 const position={gameId:'probe',decisionId:'active',revision:1,state:{outcome:{status:'ongoing'}},stateHash:'a',encodingHash:'a',partition:'train',category:'ordinary',historyStatus:'active',computerProof:{profile:'horus',account:'must-not-upload'}};
 const source={positions:[position,{...position,decisionId:'discarded',stateHash:'b',historyStatus:'undone'}],reports:[report],heldOut:[],sha256:'source'};
 const result=minimizeCorpus(source,{salt:'a'.repeat(64),sourceRegistry:{probe:{sourcePurpose:'exploratory',sourceFamily:'S08'}}});
 assert.equal(result.corpus.positions.length,1);const p=result.corpus.positions[0];
 assert.equal(p.sourcePurpose,'exploratory');assert.deepEqual(p.actorProvenance,{kind:'computer',profile:'horus'});
 assert.equal(p.terminalBoundary,'quarantined');assert.equal(p.learnerEligibility.historicalPolicy,false);assert.equal(p.learnerEligibility.historicalOptimalNonterminalValue,false);
 assert.equal(result.corpus.excludedBranches.length,1);assert(!JSON.stringify(result.corpus).includes('must-not-upload'));
 assert.throws(()=>minimizeCorpus(source,{salt:'a'.repeat(64),sourceRegistry:{probe:{sourceFamily:'S08',decisions:{active:{sourceFamily:'unrelated'}}}}}),/whole game/);
});
test('related source families cannot cross held-out boundaries even with different states',()=>{
 const rows=['train','held','unrelated'].map(id=>({gameId:id,decisionId:id,revision:1,state:{outcome:{status:'ongoing'}},stateHash:id,encodingHash:id,partition:id==='held'?'validation':'train',category:'ordinary',historyStatus:'active'}));
 const reports=rows.map(p=>({gameId:p.gameId,partition:p.partition,currentStateVerified:true,verifiedDecisions:1,excluded:[]}));
 const result=minimizeCorpus({positions:rows,reports,heldOut:['held'],sha256:'source'},{salt:'a'.repeat(64),sourceRegistry:{train:{sourceFamily:'same'},held:{sourceFamily:'same'}}});
 assert.equal(result.corpus.positions.filter(p=>p.partition==='train').length,1);
 assert.equal(result.inclusion.excluded.find(r=>r.sourceGameId==='train').reason,'held-out-related-family');
});
