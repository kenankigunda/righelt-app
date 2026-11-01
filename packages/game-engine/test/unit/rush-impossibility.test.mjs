import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuationSuccessorState, canCloseContinuationNow, isContinuationCompletable, normalizeState } from '../../src/index.ts';
import { commander, makeState, unit } from '../helpers/state-builders.mjs';

// Independent tiny exhaustive search: no optimistic reachability or memoization.
// These positions contain at most two pieces that have not rushed yet.
const bruteComplete = state => {
  if (canCloseContinuationNow(state)) return true;
  for (const actor of state.pieces.filter(p => p.owner === state.sideToMove)) {
    const frozen = state.continuation.frozenPieceStatesById?.[actor.id] ?? actor;
    if (!frozen.supplied || !frozen.commanded || actor.pushed || actor.shifted || state.continuation.rushedPieceIds.includes(actor.id)) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const to = { row: actor.position.row + dr, col: actor.position.col + dc };
      if (to.row < 0 || to.row > 9 || to.col < 0 || to.col > 9 || state.pieces.some(p => p.position.row === to.row && p.position.col === to.col)) continue;
      const enemies = state.pieces.filter(p => p.owner !== actor.owner);
      if (dr && dc) {
        if (!enemies.some(p => p.position.row === actor.position.row + dr && p.position.col === actor.position.col || p.position.row === actor.position.row && p.position.col === actor.position.col + dc)) continue;
      } else if (!enemies.some(p => Math.max(Math.abs(p.position.row - to.row), Math.abs(p.position.col - to.col)) === 1)) continue;
      if (bruteComplete(buildContinuationSuccessorState(state, { type: 'rush', actorId: actor.id, from: actor.position, to }))) return true;
    }
  }
  return false;
};
const trapped = (moved = true, row = 9, col = 0) => {
  const pieces = [commander('C1','P1',0,9), commander('C2','P2',5,5), unit('A','P1',row,col),
    ...[[row-1,col],[row+1,col],[row,col-1],[row,col+1]].filter(([r,c]) => r >= 0 && r < 10 && c >= 0 && c < 10)
      .map(([r,c],i) => unit(`E${i}`,'P2',r,c))];
  return normalizeState(makeState({ pieces, continuation: { type: 'rush', owner: 'P1', frozenOwner: 'P1', chainLength: 1,
    rushedPieceIds: moved ? ['A'] : [], rushChainPieceIds: ['A'],
    frozenPieceStatesById: { A: { supplied: true, commanded: true }, C1: { supplied: true, commanded: true } } } }));
};
const mirror = state => normalizeState({ ...state, sideToMove: 'P2', pieces: state.pieces.map(p => ({ ...p, owner: p.owner === 'P1' ? 'P2' : 'P1', position: { row: 9-p.position.row, col: 9-p.position.col } })),
  continuation: { ...state.continuation, owner: 'P2', frozenOwner: 'P2' } });

for (const [row,col] of [[9,0],[4,4]]) for (const flip of [false,true]) {
  test(`permanently enclosed rushed obligation is impossible at ${row},${col}, mirrored=${flip}`, () => {
    const state = flip ? mirror(trapped(true,row,col)) : trapped(true,row,col);
    assert.equal(bruteComplete(state), false);
    assert.equal(isContinuationCompletable(state), false);
  });
}
test('an enclosed obligation that has not rushed can escape diagonally', () => {
  for (const state of [trapped(false), mirror(trapped(false))]) {
    assert.equal(canCloseContinuationNow(state), false);
    assert.equal(bruteComplete(state), true);
    assert.equal(isContinuationCompletable(state), true);
  }
});
test('a breakable enemy command edge cannot prove impossibility', () => {
  // A friendly blocker can break the enemy line and restore a previously rushed piece.
  const pieces = [commander('C1','P1',0,9), unit('A','P1',4,3), unit('B','P1',5,3),
    commander('C2','P2',4,2), unit('E1','P2',0,4), unit('E2','P2',9,4), unit('E3','P2',6,5)];
  const state = normalizeState(makeState({pieces, continuation:{type:'rush',owner:'P1',frozenOwner:'P1',chainLength:1,
    rushedPieceIds:['A'],rushChainPieceIds:['A'],frozenPieceStatesById:{A:{supplied:true,commanded:true},B:{supplied:true,commanded:true},C1:{supplied:true,commanded:true}}}}));
  assert.equal(canCloseContinuationNow(state), false);
  assert.equal(bruteComplete(state), true);
  assert.equal(isContinuationCompletable(state), true);
});

test('permanent-edge pruning agrees with independent exhaustive completion across small boards', () => {
  for (let index = 0; index < 128; index++) {
    const row = 2 + index % 5, col = 2 + Math.floor(index / 5) % 5;
    const coordinates = [[row, col], [row + 1, col], [row - 1, col - 1], [row - 1, col + 1], [row + 2, col - 1]];
    const pieces = [commander('C1', 'P1', 0, 9), commander('C2', 'P2', 9, 0),
      unit('A', 'P1', ...coordinates[0]), unit('B', 'P1', ...coordinates[1]),
      ...coordinates.slice(2).filter((_, bit) => index & 1 << bit).map(([r, c], bit) => unit(`E${bit}`, 'P2', r, c))];
    const state = normalizeState(makeState({ pieces, continuation: { type: 'rush', owner: 'P1', frozenOwner: 'P1', chainLength: 1,
      rushedPieceIds: index & 8 ? ['A'] : [], rushChainPieceIds: ['A', 'B'],
      frozenPieceStatesById: { A: { supplied: true, commanded: true }, B: { supplied: true, commanded: true }, C1: { supplied: true, commanded: false } } } }));
    for (const candidate of [state, mirror(state)]) assert.equal(isContinuationCompletable(candidate), bruteComplete(candidate), `small board ${index}`);
  }
});
test('small exhaustive continuations agree before and after additional rushes', () => {
  for (const moved of [false,true]) for (const [row,col] of [[9,0],[4,4],[3,3]]) {
    const root = trapped(moved,row,col);
    for (const state of [root,mirror(root)]) assert.equal(isContinuationCompletable(state), bruteComplete(state));
  }
});
