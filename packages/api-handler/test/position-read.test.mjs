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
  assert.equal(reads.length, 3);
});
