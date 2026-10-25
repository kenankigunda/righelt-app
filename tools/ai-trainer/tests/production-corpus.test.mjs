import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,deterministicStateHash} from '../../../packages/game-engine/src/index.ts';
import {transition} from '../../../packages/computer-player/src/index.ts';
import {productionCorpus} from '../production-corpus.mjs';

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
