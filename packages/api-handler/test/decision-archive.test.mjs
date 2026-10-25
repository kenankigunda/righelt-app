import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveStatements, readDecisionPage, readDecision, readDecisionNotes, noteStatement } from '../src/decision-archive.ts';
import { createInitialGame, applyRevertToMove, withViewModel, reconcileGameToScenarioResultingState } from '../src/shell-live-core.ts';
import { persistGameState } from '../src/shell-live-db.ts';
import { createFakeD1 } from './support/fake-d1.mjs';

test('archive outlives the live projection and appends restoration without overwriting decisions', async () => {
  const env = { DB: createFakeD1() };
  let game = createInitialGame({ gameId: 'g', identityId: 'owner', selfPlayMode: true }), seq = 0;
  const commit = async (before, next) => {
    const statements = archiveStatements(env, before, next, seq + 1);
    await persistGameState(env, next, seq + 1, null, { baseEventSeq: seq, statements }); seq++;
  };
  await commit(null, game);
  for (let index = 1; index <= 205; index++) {
    const before = structuredClone(game);
    game.gameplayRevision++;
    game.moves.push({ moveId: `move-${index}`, index: index - 1, at: game.createdAt, selectionSnapshot: game.board.state, snapshot: game.board.state, action: { type: 'end_turn' } });
    game.moves = game.moves.slice(-200);
    await commit(before, game);
  }
  let cursor = null, items = [];
  do { const page = await readDecisionPage(env, 'g', cursor); assert.ok(page.items.length <= 100); items.push(...page.items); cursor = page.nextCursor; } while (cursor);
  assert.equal(items.length, 206);
  assert.equal(new Set(items.map(item => item.id)).size, 206);
  assert.equal((await readDecision(env, 'g', 'move-1')).move.moveId, 'move-1');
  const before = structuredClone(game);
  game.moves.at(-1).undone = true; game.gameplayRevision++;
  await commit(before, game);
  assert.equal((await readDecision(env, 'g', 'move-205')).move.undone, undefined);
  assert.deepEqual((await readDecision(env, 'g', `restore-${seq}`)).restoredIds, ['move-205']);
  assert.equal(env.DB.getWrites().filter(item => item.query.startsWith('INSERT INTO live_position_checkpoints')).length, 5);
});
test('notes are scoped to account and decision, can be edited and removed, and bound text length', async () => {
  const env = { DB: createFakeD1() };
  await env.DB.batch([noteStatement(env, 'g', 'alice', 'one', { text: 'Look here', flagged: true }), noteStatement(env, 'g', 'bob', 'one', { text: 'Private', flagged: false })]);
  assert.equal((await readDecisionNotes(env, 'g', 'alice'))[0].text, 'Look here');
  await env.DB.batch([noteStatement(env, 'g', 'alice', 'one', { text: 'Edited', flagged: false })]);
  assert.equal((await readDecisionNotes(env, 'g', 'alice'))[0].text, 'Edited');
  assert.throws(() => noteStatement(env, 'g', 'alice', 'one', { text: 'x'.repeat(2001), flagged: false }), /invalid/);
  await env.DB.batch([noteStatement(env, 'g', 'alice', 'one', null)]);
  assert.equal((await readDecisionNotes(env, 'g', 'alice')).length, 0);
  assert.equal((await readDecisionNotes(env, 'g', 'bob'))[0].text, 'Private');
});

test('same-event imported and backfilled decisions paginate in chronology, not random ID order', async () => {
  for (const legacy of [false, true]) {
    const env = { DB: createFakeD1() };
    const game = createInitialGame({ gameId: 'ordered', identityId: 'owner', selfPlayMode: true });
    game.moves = Array.from({ length: 105 }, (_, i) => ({ moveId: `move-${String(200 - i).padStart(3,'0')}`, index: i, at: game.createdAt, selectionSnapshot: game.board.state, snapshot: game.board.state, action: { type: 'end_turn' } }));
    const expected = ['initial', ...game.moves.map(move => move.moveId)];
    await env.DB.batch(archiveStatements(env, legacy ? structuredClone(game) : null, game, 12));
    const first = await readDecisionPage(env, game.id, null), second = await readDecisionPage(env, game.id, first.nextCursor);
    assert.equal(first.items.length, 100); assert.equal(second.nextCursor, null);
    assert.deepEqual([...first.items, ...second.items].map(item => item.id), expected);
  }
});
test('restoring and branching into a retreat preserves the nominal turn owner', () => {
  for (const evicted of [false, true]) {
    const game = createInitialGame({ gameId: 'retreat', identityId: 'owner', selfPlayMode: true });
    const state = { ...game.board.state, sideToMove: 'P2', continuation: { type: 'push', phase: 'retreat', owner: 'P1', chainLength: 1 } };
    const move = { moveId: 'retreat-choice', index: 0, turnIndex: 0, actorSide: 'P2', at: game.createdAt, selectionSnapshot: state, snapshot: state, action: { type: 'retreat' } };
    game.moves = evicted ? [] : [move];
    assert.equal(applyRevertToMove(game, move.moveId, 'owner', evicted ? move : undefined).ok, true);
    const view = withViewModel(game, 'owner');
    assert.equal(view.turnOwnerSeat, 'Player 1'); assert.equal(view.controlSeat, 'Player 2');
    reconcileGameToScenarioResultingState(game, { resultingState: state });
    assert.equal(game.turns.at(-1).playerSeat, 'Player 1');
  }
});

test('legacy commander destruction snapshots retain exact stored outcome reasons through archive and projection',async()=>{
 const env={DB:createFakeD1()},game=createInitialGame({gameId:'legacy-commander',identityId:'owner',selfPlayMode:true});
 game.board.state.pieces=game.board.state.pieces.filter(piece=>piece.id!=='C2');
 game.board.state.outcome={status:'p1_win',reason:'p2_commander_unsupplied'};
 game.moves=[{moveId:'legacy-push',index:0,at:game.createdAt,selectionSnapshot:structuredClone(game.board.state),snapshot:structuredClone(game.board.state),action:{type:'push'},destroyedPieces:[{pieceId:'C2',reason:'no_retreat'}]}];
 const original=structuredClone(game);
 await env.DB.batch(archiveStatements(env,null,game,1));
 const decision=await readDecision(env,game.id,'legacy-push');assert.deepEqual(decision.move,original.moves[0]);
 const page=await readDecisionPage(env,game.id,null);assert.deepEqual(page.items.find(entry=>entry.id==='legacy-push').move.snapshot.outcome,original.board.state.outcome);
 assert.deepEqual(withViewModel(game,'owner').board.state.outcome,original.board.state.outcome);
 assert.deepEqual(game.moves,original.moves);
});
