import assert from 'node:assert/strict';
import {assertHistoryPreserved} from './history-continuity.mjs';

export const LEGACY_IDENTITY_KEY = 'righelt.identity.id.v1';
export function legacyMutationContract(legacy) {
  const identities = new Set((legacy.storage?.origins || []).flatMap(origin => (origin.localStorage || []).filter(item => item.name === LEGACY_IDENTITY_KEY).map(item => item.value)).filter(Boolean));
  assert.equal(identities.size, 1, 'Expected one original retained guest identity');
  const match = legacy.hash?.match(/^#\/game\/([^?]+)/);
  assert.ok(match, 'Expected retained guest game route');
  return { gameId: decodeURIComponent(match[1]), identityId: [...identities][0], mode: 'player', protocolVersion: 2 };
}
const durableProjection = body => {
  assert.equal(body.game?.ownershipMode, 'legacy_guest');
  assert.ok(Number.isSafeInteger(body.eventSeq), 'Authoritative event sequence is required');
  assert.ok(Array.isArray(body.game.moves), 'Authoritative history is required');
  return { eventSeq: body.eventSeq, moves: body.game.moves, board: body.game.board, player1: body.game.player1, player2: body.game.player2 };
};
// An empty browser context deliberately excludes the authenticated caller's
// cookies. Both the old protocol and a header-only protocol upgrade must fail.
export async function proveLegacyMutationDenied({ browser, legacy, baseURL = 'https://127.0.0.1:9988', oldGame, authProtocol = 1 }) {
  const { gameId, ...body } = legacyMutationContract(legacy);
  const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  const url = `/api/shell/games/${encodeURIComponent(gameId)}`;
  try {
    assert.deepEqual(await context.cookies(), [], 'Legacy proof must not carry account cookies');
    const read = async () => {
      const response = await context.request.get(`${url}?identityId=${encodeURIComponent(body.identityId)}`);
      assert.equal(response.status(), 200); return response.json();
    };
    assert.equal(legacy.version, 2, 'Regenerate pre-upgrade guest evidence');
    const original = await read();
    assertHistoryPreserved(original.game, legacy.history);
    const before = durableProjection(original);
    if (oldGame) assert.deepEqual(before.moves, oldGame.moves, 'Authenticated and guest public history agree');
    for (const [headers, status, error] of [
      [{}, 426, 'upgrade_required'],
      [{ 'X-Righelt-Auth': '1', 'X-Righelt-Auth-Version': String(authProtocol) }, 401, 'invalid_credentials'],
    ]) {
      const response = await context.request.post(`${url}/join`, { headers: { Origin: baseURL, 'Content-Type': 'application/json', ...headers }, data: body });
      assert.equal(response.status(), status, 'Old guest mutation must fail at the expected authority gate');
      assert.equal((await response.json()).error, error);
      assert.deepEqual(durableProjection(await read()), before, 'Denied guest mutation changed authoritative game or history');
    }
    return { gameId, eventSeq: before.eventSeq, historyCount: before.moves.length, denied: ['upgrade_required', 'invalid_credentials'] };
  } finally { await context.close(); }
}
