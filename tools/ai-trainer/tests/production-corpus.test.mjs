import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,deterministicStateHash,resolveToStability} from '../../../packages/game-engine/src/index.ts';
import {spawnSync} from 'node:child_process';
import {transition} from '../../../packages/computer-player/src/index.ts';
import {productionCorpus,encodingHash,sharedOpening} from '../production-corpus.mjs';

function fixture(id='training-game') {
  const initial=createInitialState(),next=transition(initial,{type:'pass'});
  const records=[{id:'initial',kind:'initial',state:initial},
    {id:'move1',kind:'decision',revision:1,move:{displayMoveNumber:1,
      selectionSnapshot:initial,snapshot:next,action:{type:'pass'}}}];
  return {games:[{game_id:id,state_json:JSON.stringify({board:{state:next}})}],
    decisions:records.map((r,i)=>({game_id:id,event_seq:i,event_ordinal:0,payload_json:JSON.stringify(r)}))};
}

test('production starts are independently replayed; historical Pass is evidence, not a label',()=>{
  const f=fixture(),r=productionCorpus(f.games,f.decisions,{heldOut:[]});
  assert.equal(r.positions.length,1);assert.equal(r.reports[0].currentStateVerified,true);
  assert.equal(r.positions[0].stateHash,deterministicStateHash(createInitialState()));
  assert.equal(r.rawHistoricalPolicyTargets,false);
  assert.equal(r.positions[0].policy,undefined);
  assert.equal(r.positions[0].sharedOpening,true);
  assert.match(r.positions[0].encodingHash,/^[a-f0-9]{64}$/);
});
test('tampered transition and all dependent lineage are excluded',()=>{
  const f=fixture();const m=JSON.parse(f.decisions[1].payload_json);m.move.snapshot.turnIndex+=1;
  f.decisions[1].payload_json=JSON.stringify(m);
  const r=productionCorpus(f.games,f.decisions,{heldOut:[]});
  assert.equal(r.positions.length,0);assert.equal(r.reports[0].excluded.length,1);
  assert.equal(r.reports[0].currentStateVerified,false);
});
test('identical positions in withheld games cannot leak through another game',()=>{
  const a=fixture('train'),b=fixture('held');
  const r=productionCorpus([...a.games,...b.games],[...a.decisions,...b.decisions],{heldOut:['held']});
  assert.equal(r.positions.length,1);assert.equal(r.positions[0].partition,'validation');
});
test('unknown event invalidates lineage and deadline remains bounded',()=>{
  const f=fixture();f.decisions[0].payload_json=JSON.stringify({id:'bad',kind:'unknown'});
  assert.equal(productionCorpus(f.games,f.decisions).positions.length,0);
  assert.throws(()=>productionCorpus(f.games,f.decisions,{seconds:0}),/deadline/);
});
test('ordinary generation cannot request inference on a protected evaluation start',()=>{
  const root=resolveToStability(createInitialState());
  const job={command:'generate',id:'protected-normal',seed:107,partition:'train',kind:'normal',
    familyId:'normal-test',modelVersion:'test',budgetMs:3000,protectedEncodingHashes:[encodingHash(root)]};
  const result=spawnSync(process.execPath,['--import','tsx','tools/ai-trainer/engine-worker.mjs'],
    {input:JSON.stringify(job)+'\n',encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  const messages=result.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(messages.length,1);assert.equal(messages[0].type,'unavailable-start');
  assert.equal(messages[0].reason,'protected-evaluation-position');
});
test('shared prefixes require exact canonical encodings, not matching commander coordinates',()=>{
  const initial=resolveToStability(createInitialState());
  assert.equal(sharedOpening(initial),true);
  assert.equal(sharedOpening(transition(initial,{type:'pass'})),true);
  const pushed=structuredClone(initial);pushed.pieces[0].pushed=true;
  assert.equal(sharedOpening(pushed),false);
  const shifted=structuredClone(initial);shifted.pieces[1].shifted=true;
  assert.equal(sharedOpening(shifted),false);
});
