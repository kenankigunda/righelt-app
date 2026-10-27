import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRetreatScenario,readRetreatCapture,FOLLOW_ACTION} from '../../../e2e/support/retreat-completion-fixture.mjs';
import {asScenarioRecord,applyScenarioToGame,createInitialGame} from '../../../packages/api-handler/src/shell-live-core.ts';
import {deterministicStateHash,listLegalActions,applyAction,resolveToStability,serializeState} from '../../../packages/game-engine/src/index.ts';

for(const kind of ['human','computer','retained'])test(`native ${kind} fixture imports the exact captured history and board`,()=>{
 const scenario=makeRetreatScenario(kind),original=structuredClone(scenario),parsed=asScenarioRecord(scenario);
 assert.ok(parsed);const game=createInitialGame({gameId:`native-${kind}`,identityId:'owner',selfPlayMode:true});applyScenarioToGame(game,parsed);
 // Captured training states use minimal artifacts; the real importer supplies
 // full display paths. Preserve the original oracle and every non-artifact
 // field, then compare hashes in the capture's declared representation.
 assert.equal(deterministicStateHash(scenario.resultingState),scenario.expectedFinalStateHash);
 assert.equal(game.board.state.artifacts.mode,'full');
 assert.equal(deterministicStateHash(resolveToStability(game.board.state,{artifactMode:'minimal'})),scenario.expectedFinalStateHash);
 const actual=JSON.parse(serializeState(game.board.state)),expected=JSON.parse(serializeState(scenario.resultingState));
 delete actual.artifacts;delete expected.artifacts;assert.deepEqual(actual,expected);
 assert.deepEqual(game.moves.map(move=>move.action),scenario.moves.map(move=>move.action));
 assert.deepEqual(game.moves.map(move=>move.retreatSemantics),scenario.moves.map(move=>move.retreatSemantics));
 assert.equal(game.turns.at(-1).index,85);assert.equal(game.board.state.outcome.status,'ongoing');
 assert.deepEqual(scenario,original);
 if(kind==='human')assert.ok(listLegalActions(game.board.state).some(action=>JSON.stringify(action)===JSON.stringify(readRetreatCapture().push.action)));
 if(kind==='computer'){
  assert.deepEqual(listLegalActions(game.board.state),[FOLLOW_ACTION]);
  const completed=resolveToStability(applyAction(game.board.state,FOLLOW_ACTION).state);
  assert.equal(completed.continuation,null);
  for(const id of ['U2-11','U2-15'])assert.equal(completed.pieces.find(piece=>piece.id===id)?.supplied,true);
 }
 if(kind==='retained'){
  assert.equal(game.board.state.continuation.phase,'follow');assert.deepEqual(listLegalActions(game.board.state),[]);
  assert.ok(game.board.state.pieces.some(piece=>piece.id==='U1-28'));
 }
});

test('native fixture factories isolate their inputs and reject unknown variants',()=>{
 const one=makeRetreatScenario('retained');one.moves[0].action.type='pass';one.initialState.pieces=[];
 assert.equal(makeRetreatScenario('retained').moves[0].action.type,'push');assert.ok(readRetreatCapture().states.prePush.pieces.length);
 assert.throws(()=>makeRetreatScenario('unknown'),/Unknown native retreat fixture/);
});
