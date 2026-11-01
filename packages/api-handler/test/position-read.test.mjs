import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialGame, withPositionViewModel } from '../src/shell-live-core.ts';
import { handleLiveGameRequest } from '../src/shell-live.ts';
import { sanitizeGameResponse } from '../src/auth-game.ts';
import { withEngineComputationGuard } from '../../game-engine/src/index.ts';

const saved = () => {
  const game = createInitialGame({ gameId: 'game-position', identityId: 'id-owner', selfPlayMode: true });
  game.board.state = JSON.parse(readFileSync('packages/game-engine/test/fixtures/game-loading-rush.json', 'utf8'));
  return game;
};

test('position projection and account sanitization never enumerate legal actions', () => {
  const game = saved();
  const before = structuredClone(game);
  const view = withEngineComputationGuard(expansion => { if (expansion) throw new Error('unexpected engine search'); }, () => {
    const position = withPositionViewModel(game, 'id-owner');
    return sanitizeGameResponse({ game: position }, null, true).game;
  });
  assert.equal(view.positionOnly, true);
  assert.equal(view.canRecordMove, false);
  assert.equal(view.canEndTurn, false);
  assert.equal(view.sharedMutationsBlocked, true);
  assert.deepEqual(game, before);
  assert.equal(view.inviteTokens, undefined);
});

test('account position projection ignores spoofed roles and strips private invitation authority', () => {
  const game = saved(); game.ownershipMode = 'account_v1';
  const position = { ...withPositionViewModel(game, 'id-owner'), myRole: 'Player 1', myRoles: ['Player 1'] };
  const view = withEngineComputationGuard(expansion => { if (expansion) throw new Error('unexpected search'); }, () =>
    sanitizeGameResponse({ game: position }, { accountId: 'id-other' }).game);
  assert.equal(view.myRole, 'Guest');
  assert.equal(view.canRecordMove, false);
  assert.equal(view.canControlComputer, false);
  assert.equal(view.inviteToken, null);
  assert.equal(view.inviteTokens, undefined);
});

test('compacted position reads mark history pending without decoding its payload', async () => {
  const game = saved(), queries = [];
  const env = { AUTH_ENABLED: 'false', DB: { prepare(sql) {
    queries.push(sql); assert.ok(!/game_payloads|live_game_archives/.test(sql));
    return { bind() { return this; }, async first() {
      return { game_id: game.id, created_at: game.createdAt, updated_at: game.updatedAt,
        state_json: JSON.stringify({ ...game, moves: [] }), event_seq: 12, gameplay_revision: 9, move_count: 1000 };
    } };
  } } };
  const response = await handleLiveGameRequest(new Request(`https://example.test/api/shell/games/${game.id}/position?identityId=id-owner`), env);
  assert.equal(response.status, 200);
  assert.equal(response.body.game.positionHistoryPending, true);
  assert.equal(response.body.game.historyProjection, 'summary-v1');
  assert.deepEqual(response.body.game.currentSnapshot.pieces, game.board.state.pieces);
  assert.equal(queries.length, 1);
});

test('position route reads durable data without invoking a room or writing', async () => {
  const game = saved(), reads = [];
  const env = { AUTH_ENABLED: 'false', DB: { prepare(sql) {
    assert.match(sql, /^SELECT /); reads.push(sql);
    return { bind(id) { assert.equal(id, game.id); return this; }, async first() {
      if (!sql.includes("FROM live_games")) return null;
      return { game_id: game.id, created_at: game.createdAt, updated_at: game.updatedAt,
        state_json: JSON.stringify(game), event_seq: 49, gameplay_revision: game.gameplayRevision };
    } };
  } }, GAME_ROOMS: { get() { throw new Error('room must not run'); } } };
  const response = await handleLiveGameRequest(new Request(`https://example.test/api/shell/games/${game.id}/position?identityId=id-owner`), env);
  assert.equal(response.status, 200);
  assert.equal(response.cacheControl, 'no-store');
  assert.equal(response.body.projection, 'position-v1');
  assert.equal(response.body.eventSeq, 49);
  assert.equal(response.body.game.positionOnly, true);
  assert.deepEqual(response.body.game.board.state.pieces, game.board.state.pieces);
  assert.equal(reads.length, 1);
  assert.match(reads[0], /json_remove\(value, '\$\.snapshot', '\$\.selectionSnapshot'\)/);
});
