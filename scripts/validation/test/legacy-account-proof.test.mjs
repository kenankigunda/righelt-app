import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyMutationContract, proveLegacyMutationDenied, LEGACY_IDENTITY_KEY } from '../legacy-account-proof.mjs';
const persistedGame = {id:'old game',moves:[{moveId:'retained-move',action:{type:'MOVE'},selectionSnapshot:{turnIndex:1},snapshot:{turnIndex:2}}],turns:[{index:1}],board:{state:{turnIndex:2}}};
const legacy = { version:2,history:{version:1,gameId:persistedGame.id,moves:persistedGame.moves,turns:persistedGame.turns,board:persistedGame.board}, hash: '#/game/old%20game', storage: { origins: [{ origin: 'http://127.0.0.1:9888', localStorage: [{ name: LEGACY_IDENTITY_KEY, value: 'old-owner' }] }] } };
test('legacy identity comes from retained storage and ambiguous or absent identity fails', () => {
  assert.deepEqual(legacyMutationContract(legacy), { gameId: 'old game', identityId: 'old-owner', mode: 'player', protocolVersion: 2 });
  assert.throws(() => legacyMutationContract({ hash: legacy.hash, storage: {} }), /one original/);
  const ambiguous = structuredClone(legacy); ambiguous.storage.origins[0].localStorage.push({ name: LEGACY_IDENTITY_KEY, value: 'another-owner' });
  assert.throws(() => legacyMutationContract(ambiguous), /one original/);
});
function fixture({ mutate = false, wrongDenial = false } = {}) {
  let posts = 0, closed = false;
  const original = { eventSeq: 7, game: { ...structuredClone(persistedGame), ownershipMode: 'legacy_guest', player1: { identityId: 'old-owner' }, player2: null } };
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

test('legacy proof rejects missing pre-upgrade evidence before any mutation', async () => {
 const f=fixture();await assert.rejects(proveLegacyMutationDenied({browser:f.browser,legacy:{...legacy,history:undefined}}),/history snapshot/);assert.equal(f.closed,true);
});
test('same-length legacy history corruption across upgrade fails before mutation',async()=>{
 const f=fixture(),prior=structuredClone(legacy);prior.history.moves[0].action.type='DIFFERENT';
 await assert.rejects(proveLegacyMutationDenied({browser:f.browser,legacy:prior}),/changed across upgrade/);
 assert.equal(f.closed,true);
});
