import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInitialGame, applyServerAction, endServerTurn } from '../src/shell-live-core.ts';
import { applyAction, resolveToStability } from '../../game-engine/src/index.ts';
import { projectOptimisticGame } from '../../../apps/web/shell/optimistic-live.js';

const fixture = JSON.parse(fs.readFileSync(new URL('../../game-engine/test/fixtures/destruction-turn-end.json', import.meta.url)));
const setup = () => {
  const game = createInitialGame({ gameId: 'destruction-regression', identityId: 'test-player', selfPlayMode: true });
  game.board.state = structuredClone(fixture.initialState);
  game.turns[0].index = fixture.initialState.turnIndex;
  game.turns[0].playerSeat = 'Player 2';
  game.myRole = 'Player 2';
  return game;
};
const positions = (records) => records.map((r) => r.position).sort((a,b) => a.row-b.row || a.col-b.col);

test('observed explicit turn-end losses persist on the final move and match optimistic pending history', () => {
  const base = setup();
  const optimistic = projectOptimisticGame({ authoritativeGame: base, identityId: 'test-player', queue: [
    {kind:'apply',clientCommandId:'rush',action:fixture.action,queuedAt:'2026-01-01T00:00:00Z'},
    {kind:'end-turn',clientCommandId:'end',queuedAt:'2026-01-01T00:00:01Z'},
  ] });
  assert.equal(optimistic.ok,true);
  const game = structuredClone(base);
  const move = applyServerAction(game, fixture.action, undefined, 'rush');
  assert.equal(move.ok,true);
  assert.deepEqual(move.destroyedPieces,[]);
  const beforeEnd = structuredClone(game);
  const ended = endServerTurn(game, 'end');
  assert.equal(ended.ok,true);
  assert.deepEqual(positions(ended.destroyedPieces),[{row:6,col:4},{row:7,col:4}]);
  assert.deepEqual(ended.destroyedPieces, optimistic.commandResults.get('end').destroyedPieces);
  assert.deepEqual(game.moves[0].destroyedPieces, optimistic.game.pendingMoves[0].destroyedPieces);
  assert.deepEqual(game.moves[0].snapshot, game.board.state);
  assert.deepEqual(optimistic.game.pendingMoves[0].snapshot, game.board.state);
  assert.equal(beforeEnd.moves[0].snapshot.pieces.length-game.moves[0].snapshot.pieces.length,2);
  assert.equal(base.moves.length,0,'optimistic projection does not mutate its source');
  const committedProjection = projectOptimisticGame({authoritativeGame:beforeEnd, identityId:'test-player',queue:[{kind:'end-turn',clientCommandId:'end',queuedAt:'2026-01-01T00:00:01Z'}]});
  assert.deepEqual(committedProjection.game.moves[0].destroyedPieces,ended.destroyedPieces);
  assert.deepEqual(committedProjection.game.moves[0].snapshot,game.board.state);
});

test('engine reports removal at the actual resolution boundary without aliasing source pieces', () => {
  const initial = structuredClone(fixture.initialState);
  const events = [];
  const applied = applyAction(initial, fixture.action, {onRemoval:e=>events.push(e)});
  resolveToStability(applied.state,{onRemoval:e=>events.push(e)});
  assert.deepEqual(events,[],'rush freezes removal until continuation ends');
  const raw = structuredClone(applied.state);
  raw.continuation = null;
  resolveToStability(raw,{onRemoval:e=>events.push(e)});
  assert.equal(events.length,2);
  assert.deepEqual(events.map(e=>e.reason),['loss_of_supply','loss_of_supply']);
  assert.deepEqual(events.map(e=>e.piece.position),[{row:6,col:4},{row:7,col:4}]);
  events[0].piece.position.row = 99;
  assert.equal(applied.state.pieces.find(p=>p.id===events[0].piece.id).position.row,6);
});

test('pass closes the same rush continuation, recording removals once on the pass', () => {
  const game=setup();
  applyServerAction(game,fixture.action,undefined,'rush');
  const base=structuredClone(game);
  const optimistic=projectOptimisticGame({authoritativeGame:base,identityId:'test-player',queue:[{kind:'apply',action:{type:'pass'},clientCommandId:'pass',queuedAt:'2026-01-01T00:00:00Z'}]});
  const pass=applyServerAction(game,{type:'pass'},undefined,'pass');
  assert.equal(pass.ok,true);
  assert.equal(pass.destroyedPieces.length,2);
  assert.deepEqual(pass.destroyedPieces,optimistic.commandResults.get('pass').destroyedPieces);
  assert.deepEqual(pass.removedPieces.map(e=>e.eventId),['pass:U1-2','pass:U1-3']);
  assert.deepEqual(game.moves[0].destroyedPieces,[]);
  const duplicate=applyServerAction(game,{type:'pass'},undefined,'pass');
  assert.equal(duplicate.duplicate,true);
  assert.deepEqual(duplicate.removedPieces,[]);
  assert.equal(game.moves.length,2);
});

const projectFixture = JSON.parse(fs.readFileSync(new URL('../../game-engine/test/fixtures/destruction-project.json',import.meta.url)));
test('screenshot project removes exactly five units with identical authoritative and optimistic events',()=>{
 const game=createInitialGame({gameId:'project-regression',identityId:'test-player',selfPlayMode:true});
 game.board.state=structuredClone(projectFixture.initialState);
 const base=structuredClone(game);
 const optimistic=projectOptimisticGame({authoritativeGame:base,identityId:'test-player',queue:[{kind:'apply',clientCommandId:'project',action:projectFixture.action,queuedAt:'2026-01-01T00:00:00Z'}]});
 const result=applyServerAction(game,projectFixture.action,undefined,'project');
 assert.equal(result.ok,true);
 assert.deepEqual(positions(result.destroyedPieces),[{row:6,col:1},{row:6,col:3},{row:6,col:6},{row:7,col:5},{row:8,col:5}]);
 assert.deepEqual(result.destroyedPieces,optimistic.commandResults.get('project').destroyedPieces);
 assert.deepEqual(result.destroyedPieces,optimistic.game.pendingMoves[0].destroyedPieces);
 assert.ok(result.removedPieces.every(e=>e.reason==='loss_of_supply'&&e.piece.id===e.pieceId));
 assert.deepEqual(game.moves[0].snapshot,game.board.state);
});

test('no-retreat events identify the defender without classifying nearby supply losses as retreat failures',()=>{
 const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
 const state={boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[piece('C1','P1','commander',0,9),piece('C2','P2','commander',9,0),piece('A1','P1','unit',7,9),piece('A2','P1','unit',8,9),piece('A3','P1','unit',8,8),piece('D1','P2','unit',9,8),piece('D2','P2','unit',9,9)]};
 resolveToStability(state);
 const events=[];
 const next=applyAction(state,{type:'push',actorId:'A2',from:{row:8,col:9},to:{row:9,col:9}},{onRemoval:e=>events.push(e)}).state;
 resolveToStability(next,{onRemoval:e=>events.push(e)});
 assert.equal(events.length,1);assert.equal(events[0].reason,'no_retreat');assert.equal(events[0].piece.id,'D2');assert.deepEqual(events[0].piece.position,{row:9,col:9});
});
