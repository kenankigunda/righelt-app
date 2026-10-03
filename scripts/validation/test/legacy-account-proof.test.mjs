import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyMutationContract, proveLegacyMutationDenied, LEGACY_IDENTITY_KEY } from '../legacy-account-proof.mjs';
const legacy = { hash: '#/game/old%20game', storage: { origins: [{ origin: 'http://127.0.0.1:9888', localStorage: [{ name: LEGACY_IDENTITY_KEY, value: 'old-owner' }] }] } };
test('legacy identity comes from retained storage and ambiguous or absent identity fails', () => {
  assert.deepEqual(legacyMutationContract(legacy), { gameId: 'old game', identityId: 'old-owner', mode: 'player', protocolVersion: 2 });
  assert.throws(() => legacyMutationContract({ hash: legacy.hash, storage: {} }), /one original/);
  const ambiguous = structuredClone(legacy); ambiguous.storage.origins[0].localStorage.push({ name: LEGACY_IDENTITY_KEY, value: 'another-owner' });
  assert.throws(() => legacyMutationContract(ambiguous), /one original/);
});
function fixture({ mutate = false, wrongDenial = false } = {}) {
  let posts = 0, closed = false;
  const original = { eventSeq: 7, game: { ownershipMode: 'legacy_guest', moves: [{ id: 'retained-move' }], board: { state: 'retained' }, player1: { identityId: 'old-owner' }, player2: null } };
  const browser = { async newContext(options) {
    assert.deepEqual(options.storageState, { cookies: [], origins: [] });
    return { cookies: async () => [], close: async () => { closed = true; }, request: {
      get: async url => { assert.match(url, /identityId=old-owner/); return { status: () => 200, json: async () => ({ ...original, eventSeq: mutate && posts ? 8 : 7 }) }; },
      post: async (url, options) => {
        posts++; assert.equal(url, '/api/shell/games/old%20game/join');
        assert.equal(options.data.identityId, 'old-owner'); assert.equal(options.data.protocolVersion, 2);
        assert.equal(options.headers.Origin, 'https://127.0.0.1:9988');
        assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers['X-Righelt-Session'], undefined);
        return { status: () => wrongDenial ? 400 : posts === 1 ? 426 : 401, json: async () => ({ error: posts === 1 ? 'upgrade_required' : 'invalid_credentials' }) };
      },
    } };
  } };
  return { browser, get closed() { return closed; }, original };
}
test('unauthenticated legacy attempts preserve authoritative state and use exact denial contracts', async () => {
  const f = fixture(); const result = await proveLegacyMutationDenied({ browser: f.browser, legacy, oldGame: f.original.game });
  assert.equal(result.eventSeq, 7); assert.equal(f.closed, true);
});
test('wrong authority denial or changed authoritative state fails and still closes context', async () => {
  for (const options of [{ mutate: true }, { wrongDenial: true }]) {
    const f = fixture(options); await assert.rejects(proveLegacyMutationDenied({ browser: f.browser, legacy })); assert.equal(f.closed, true);
  }
});
