import { validateAction } from '../../src/index.ts';

// Reference the former complete-board enumeration, independently of optimized
// candidate geometry. Keep historical continuation ordering as a public contract.
export function bruteLegalActions(state) {
  if (state.outcome.status !== 'ongoing') return [];
  const candidates = [], continuation = state.continuation;
  const own = state.pieces.filter(piece => piece.owner === state.sideToMove);
  if (continuation?.type === 'push') {
    if (continuation.phase === 'retreat') {
      const piece = state.pieces.find(piece => piece.id === continuation.pushedPieceId);
      if (!piece) return [];
      for (const to of [
        {row:piece.position.row-1,col:piece.position.col}, {row:piece.position.row+1,col:piece.position.col},
        {row:piece.position.row,col:piece.position.col-1}, {row:piece.position.row,col:piece.position.col+1},
      ]) candidates.push({type:'retreat',actorId:piece.id,from:piece.position,to});
    } else if (continuation.followPoint) {
      const allowed = new Set(continuation.followGroupPieceIds ?? []);
      for (const piece of own) if (!allowed.size || allowed.has(piece.id)) {
        candidates.push({type:'follow',actorId:piece.id,from:piece.position,to:continuation.followPoint});
      }
    }
  } else if (continuation?.type === 'rush') {
    for (const piece of own) for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (dr || dc) candidates.push({type:'rush',actorId:piece.id,from:piece.position,
        to:{row:piece.position.row+dr,col:piece.position.col+dc}});
    }
    candidates.push({type:'pass'});
  } else {
    candidates.push({type:'pass'});
    for (const piece of own) for (const type of ['move','project','rush','push']) {
      for (let row=0;row<10;row++) for (let col=0;col<10;col++) {
        candidates.push({type,actorId:piece.id,from:{...piece.position},to:{row,col}});
      }
    }
  }
  return candidates.filter(action => validateAction(state, action).ok);
}
