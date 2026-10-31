import {visibleRecordedMoves} from './recorded-narration.js';
import { getTurnOwnerSideForState } from '../generated/packages/shared-types/src/shell-live-turn.js';

const sameCoordinate = (left, right) => Boolean(left && right && left.row === right.row && left.col === right.col);

export const findRecordedActionStartPiece = (snapshot, action) => {
  if (!snapshot || !action) {
    return null;
  }
  if (typeof action.actorId === "string") {
    const pieceById = snapshot.pieces?.find((piece) => piece.id === action.actorId) ?? null;
    if (pieceById) {
      return pieceById;
    }
  }
  if (!action.from) {
    return null;
  }
  return snapshot.pieces?.find((piece) => sameCoordinate(piece.position, action.from)) ?? null;
};

export const buildDestroyedPieceOverlays = ({ destroyedPieceRecords, preActionSnapshot }) => {
  const records = Array.isArray(destroyedPieceRecords) ? destroyedPieceRecords : [];
  const preActionPieces = Array.isArray(preActionSnapshot?.pieces) ? preActionSnapshot.pieces : [];
  return records.map((record) => {
    const preActionPiece =
      record.piece ?? preActionPieces.find((piece) => record.pieceId ? piece.id === record.pieceId : sameCoordinate(piece?.position, record.position)) ?? null;
    return {
      row: record.position.row,
      col: record.position.col,
      ownerSeat:
        record.ownerSeat ??
        (preActionPiece?.owner === "P1" ? "p1" : preActionPiece?.owner === "P2" ? "p2" : null),
      kind:
        record.kind ?? preActionPiece?.kind ??
        (record.reason === "commander_unsupplied" ? "commander" : "unit"),
      supplied: preActionPiece ? preActionPiece.supplied !== false : record.supplied ?? true,
      commanded: preActionPiece ? preActionPiece.commanded !== false : record.commanded ?? true,
      piece: preActionPiece
        ? {
            id: preActionPiece.id ?? null,
            owner: preActionPiece.owner,
            kind: preActionPiece.kind,
            position: {
              row: record.position.row,
              col: record.position.col,
            },
            supplied: preActionPiece.supplied !== false,
            commanded: preActionPiece.commanded !== false,
            pushed: preActionPiece.pushed === true,
          }
        : null,
    };
  });
};


/** One presentation contract for desktop history, inline mobile history and replay summaries. */
export const buildMovePreview = (move) => ({
  snapshot: move?.snapshot ?? move?.selectionSnapshot ?? null,
  overlay: {
    mode: "recorded-action",
    recordedAction: move?.action ?? null,
    recordedActionStartPiece: findRecordedActionStartPiece(move?.selectionSnapshot, move?.action),
    destroyedPieces: buildDestroyedPieceOverlays({destroyedPieceRecords: move?.destroyedPieces, preActionSnapshot: move?.selectionSnapshot}),
  },
});

export const buildTurnPreview = (moves) => {
  const ordered = visibleRecordedMoves(moves).sort((a,b) => (a.turnMoveIndex ?? a.index) - (b.turnMoveIndex ?? b.index));
  const previews = ordered.map(buildMovePreview);
  const routes = new Set();
  const actions = previews.flatMap(({overlay}) => {
    const action = overlay.recordedAction;
    if (!action || action.type === 'end_turn' || action.type === 'pass') return [];
    const owner = overlay.recordedActionStartPiece?.owner;
    const key = JSON.stringify([owner, action.from?.row, action.from?.col, action.to?.row, action.to?.col]);
    // Push initiation and its follow describe one attacker route. Retreat and
    // projection have distinct semantics even if their coordinates coincide.
    if (['push','follow'].includes(action.type)) {
      if (routes.has(key)) return [];
      routes.add(key);
    }
    return [overlay];
  });
  return {
    snapshot: previews.at(-1)?.snapshot ?? null,
    overlay: {mode:'recorded-turn', recordedActions:actions, destroyedPieces:previews.flatMap(preview => preview.overlay.destroyedPieces)},
  };
};

export const historyTurnSide = (turn, moves) => {
  if (turn?.playerSeat === 'Player 1') return 'P1';
  if (turn?.playerSeat === 'Player 2') return 'P2';
  const ordered = [...(moves ?? [])].sort((a,b)=>(a.turnMoveIndex ?? a.index)-(b.turnMoveIndex ?? b.index));
  const first = ordered.find(move => !move.undone) ?? ordered[0];
  return (first?.selectionSnapshot ? getTurnOwnerSideForState(first.selectionSnapshot) : null) ?? first?.actorSide ?? 'P1';
};
