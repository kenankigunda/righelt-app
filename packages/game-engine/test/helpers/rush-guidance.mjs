import { commander, makeState, unit } from './state-builders.mjs';

// Two independent supply barriers. The crossing has both a one-rush opening
// at their intersection and two-rush alternatives opening each separately.
export function supplyBarriers({ crossing = false, extraBlocker = false } = {}) {
  const pieces = crossing ? [
    commander('C1', 'P1', 2, 8), commander('C2', 'P2', 9, 0), unit('X', 'P1', 7, 1),
    unit('A', 'P1', 4, 5), unit('B', 'P1', 3, 5), unit('C', 'P1', 4, 7),
    ...[[0,4], [9,4], [5,0], [5,9], [4,4], [5,8]].map(([row,col], i) => unit(`E${i}`, 'P2', row, col)),
  ] : [
    commander('C1', 'P1', 3, 8), commander('C2', 'P2', 9, 0), unit('X', 'P1', 4, 1),
    unit('B', 'P1', 5, 5), unit('D', 'P1', 5, 7),
    ...[[0,4], [9,4], [0,6], [9,6], [6,3], [6,5]].map(([row,col], i) => unit(`E${i}`, 'P2', row, col)),
  ];
  if (extraBlocker) pieces.push(unit('Y', 'P1', 8, 2));
  return makeState({ pieces, continuation: {
    type: 'rush', owner: 'P1', chainLength: 1, frozenOwner: 'P1',
    rushedPieceIds: ['X'], rushChainPieceIds: extraBlocker ? ['X', 'Y'] : ['X'],
    frozenPieceStatesById: Object.fromEntries(pieces.filter(p => p.owner === 'P1').map(p => [p.id, { supplied: true, commanded: p.id !== 'C1' }])),
  } });
}
