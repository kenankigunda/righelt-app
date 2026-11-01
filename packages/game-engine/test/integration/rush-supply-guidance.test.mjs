import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeRushSupplyGuidance, applyAction, canCloseContinuationNow, listLegalActions, resolveToStability, validateAction } from '../../src/index.ts';

const catalog = JSON.parse(readFileSync(new URL('../../../../apps/web/scenarios/catalog.json', import.meta.url)));
const scenario = catalog.scenarios.find(s => s.id === 'bc6fb68f-7b20-4be5-a717-086ff15ec15f');
test('reported production position singles out the supply-restoring rush without changing legality', () => {
  assert.ok(scenario);
  const state = scenario.initialState;
  const legal = listLegalActions(state), before = structuredClone(state);
  assert.equal(legal.length, 13);
  const guidance = analyzeRushSupplyGuidance(state);
  const action = {type:'rush', actorId:'U1-7', from:{row:6,col:4}, to:{row:7,col:5}};
  assert.deepEqual(guidance, {obligationPieceIds:['U1-3'], actions:[{action, immediate:true}]});
  assert.deepEqual(listLegalActions(state), legal);
  assert.deepEqual(state, before);
  const next = resolveToStability(applyAction(state, action).state, {artifactMode:'full'});
  assert.equal(canCloseContinuationNow(next), true);
  assert.equal(validateAction(next, {type:'end_turn'}).ok, true);
  const ended = resolveToStability(applyAction(next, {type:'end_turn'}).state, {artifactMode:'full'});
  const piece = ended.pieces.find(p => p.id === 'U1-3');
  assert.equal(piece.supplied, true);
  assert.equal(piece.commanded, false, 'supply guidance does not promise command');
  assert.equal(ended.sideToMove, 'P2');
});
