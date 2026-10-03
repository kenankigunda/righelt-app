import assert from 'node:assert/strict';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validate({gameId,moves,turns,board}) {
  assert.ok(typeof gameId === 'string' && gameId.length, 'History requires a game ID');
  assert.ok(Array.isArray(moves), 'History requires ordered moves');
  for (const move of moves) {
    assert.ok(record(move) && typeof move.moveId === 'string' && move.moveId.length, 'History requires complete move IDs');
    for (const key of ['action','selectionSnapshot','snapshot']) assert.ok(record(move[key]), `History move requires ${key}`);
  }
  assert.ok(Array.isArray(turns) && turns.every(record), 'History requires ordered turns');
  assert.ok(record(board) && record(board.state), 'History requires authoritative board state');
}
export function assertHistorySnapshot(snapshot) {
  assert.ok(record(snapshot) && snapshot.version === 1, 'Missing or unsupported history snapshot; regenerate pre-upgrade evidence');
  assert.deepEqual(Object.keys(snapshot).sort(), ['version','gameId','moves','turns','board'].sort(), 'Malformed history snapshot');
  validate(snapshot);
}
// Preserve the complete persisted move/turn entries and live board, including
// unknown fields. Presence, read permissions and the reader's history cursor
// are deliberately outside this projection. API responses are JSON values.
export function historySnapshot(game) {
  assert.ok(record(game), 'Authoritative game is required');
  const snapshot = {version:1,gameId:game.id,moves:game.moves,turns:game.turns,board:game.board};
  validate(snapshot);
  return structuredClone(snapshot);
}
export function assertHistoryPreserved(game, snapshot) {
  assertHistorySnapshot(snapshot);
  assert.deepEqual(historySnapshot(game), snapshot, 'Retained authoritative history or board changed across upgrade');
}
