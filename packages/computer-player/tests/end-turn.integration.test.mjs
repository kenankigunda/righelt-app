import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../../game-engine/src/index.ts';
import { encodeAction, encodeState, legalActionMap, selectMove, transition, experimentConfig } from '../src/index.ts';
import { commander, makeState, unit } from '../../game-engine/test/helpers/state-builders.mjs';
import { createInitialGame, applyServerAction, applyServerActionWithExpectedState } from '../../api-handler/src/shell-live-core.ts';
const root = () => makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),unit('L','P1',3,3),
  unit('A','P1',4,4),unit('B','P1',5,3),unit('E','P2',4,2)]});

test('unchanged model slot decodes as Pass at root and End Turn in a sequence', () => {
  const state=root(), started=transition(state,{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  assert.equal(encodeAction({type:'pass'}),2800); assert.equal(encodeAction({type:'end_turn'}),2800);
  assert.deepEqual(legalActionMap(createInitialState()).get(2800),{type:'pass'});
  assert.deepEqual(legalActionMap(started).get(2800),{type:'end_turn'});
  assert.equal(encodeState(started).length,4600); assert.equal(experimentConfig.actionCount,2801);
});

test('search directly selects semantic End Turn without a submission shim', async () => {
  const state=transition(root(),{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
  const evaluator=async()=>({policyLogits:Float32Array.from({length:2801},(_,i)=>i===2800?20:0),value:0});
  const result=await selectMove({state,seed:107,simulations:2,temperature:0,maxNodes:512},evaluator);
  assert.equal(result.status,'ready'); assert.deepEqual(result.action,{type:'end_turn'});
  assert.equal(transition(state,result.action).continuation,null);
});

test('server and search agree on explicit End Turn without adding a history move', () => {
  const game=createInitialGame({gameId:'g',identityId:'owner',selfPlayMode:true});
  game.board.state=root();
  const rush={type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}};
  assert.equal(applyServerAction(game,rush).ok,true);
  const before=structuredClone(game.board.state), count=game.moves.length;
  const result=applyServerActionWithExpectedState(game,{type:'end_turn'},before);
  assert.equal(result.ok,true); assert.equal(game.moves.length,count);
  assert.equal(game.turns.at(-1).index,1);
  assert.deepEqual(encodeState(result.state),encodeState(transition(before,{type:'end_turn'})));
});

test('shipped trained weights complete a rush using current semantics without retraining', async () => {
  const {readFile}=await import('node:fs/promises'), {createHash}=await import('node:crypto');
  const ort=await import('onnxruntime-web');
  const {CURRENT_COMPUTER_MODEL}=await import('../../shared-types/src/computer-play.ts');
  const bytes=await readFile(new URL('../../../apps/web/computer/models/initial-1554.onnx',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),CURRENT_COMPUTER_MODEL.sha256);
  const configBytes=await readFile(new URL('../config/experiment-v1.json',import.meta.url));
  assert.equal(createHash('sha256').update(configBytes).digest('hex'),'f433dd71f410c451fd6523946b224df710919be5008abe507cbc80aca97a374d');
  ort.env.wasm.numThreads=1;
  const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm']});
  let calls=0;
  try {
    const evaluator=async encoded=>{
      const outputs=await session.run({state:new ort.Tensor('float32',encoded,[1,46,10,10])});calls++;
      assert.deepEqual(outputs.policy.dims,[1,2801]);assert.deepEqual(outputs.value.dims,[1]);
      return {policyLogits:outputs.policy.data,value:outputs.value.data[0]};
    };
    let state=transition(root(),{type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}});
    for(let step=0;state.continuation&&step<8;step++) {
      const result=await selectMove({state,seed:107,simulations:4,temperature:0,maxNodes:512},evaluator);
      assert.equal(result.status,'ready');assert.notEqual(result.action.type,'pass');
      assert.ok(['rush','end_turn'].includes(result.action.type));state=transition(state,result.action);
    }
    assert.ok(calls>0);assert.equal(state.continuation,null);assert.equal(state.turnIndex,1);
  } finally {await session.release();}
});
