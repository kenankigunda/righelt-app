import {visibleRecordedMoves} from './recorded-narration.js';
import { getTurnOwnerSideForState } from '../generated/packages/shared-types/src/shell-live-turn.js';
import { immediateRemovalRecords, moveInspectionSnapshot, settlementRemovalRecords, turnInspectionRemovalRecords } from './destruction-presentation.js';
import {pendingSupplyLossPieces} from '../board/recorded-pending-pieces.js';

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

// Causal records explain which move cut supply. Static pending treatment belongs
// to the selected frame, including later moves and temporarily cut survivors.
const moveStaticDestructionRecords = move => {
  const frame = moveInspectionSnapshot(move);
  const pieces = Array.isArray(frame?.pieces) ? frame.pieces : [];
  const byId = new Map(pieces.filter(piece => typeof piece?.id === 'string').map(piece => [piece.id, piece]));
  const validPosition = piece => Number.isSafeInteger(piece?.position?.row)
    && Number.isSafeInteger(piece?.position?.col) && piece.position.row >= 0 && piece.position.col >= 0;
  const supplied = piece => piece?.displaySupplied ?? piece?.supplied;
  const records = new Map();
  for (const record of settlementRemovalRecords(move)) {
    const id = record.pieceId ?? record.piece?.id;
    const current = byId.get(id);
    // Explicit restoration wins over old causal evidence. Unknown legacy
    // frames retain their recorded treatment instead of inventing status.
    if (current?.kind === 'commander' || supplied(current) === true) continue;
    const piece = current && validPosition(current) ? current : record.piece;
    records.set(id ?? record.eventId ?? record, {
      ...record, ...(piece ? {piece, position:piece.position} : {}),
    });
  }
  for (const piece of pendingSupplyLossPieces(frame)) {
    records.set(piece.id, {pieceId:piece.id, piece, position:piece.position,
      ownerSeat:piece.owner === 'P1' ? 'p1' : piece.owner === 'P2' ? 'p2' : null,
      kind:piece.kind, removalPhase:'turn_settlement', reason:'loss_of_supply'});
  }
  return [...records.values()].map(record => record.piece ? {...record,
    piece:{...record.piece, supplied:supplied(record.piece),
      commanded:record.piece.displayCommanded ?? record.piece.commanded},
  } : record);
};


/** One presentation contract for desktop history, inline mobile history and replay summaries. */
const historyRoleOverlay = (actions, context) => {
  if (context !== 'history') return {};
  const cells = new Map();
  for (const action of actions) {
    if (!action || ['end_turn','pass'].includes(action.type)) continue;
    for (const [role, coordinate] of [['source', action?.from], ['target', action?.to]]) {
      if (!coordinate || !Number.isInteger(coordinate.row) || !Number.isInteger(coordinate.col)) continue;
      const key = `${coordinate.row},${coordinate.col}`;
      const cell = cells.get(key) ?? {row:coordinate.row,col:coordinate.col,source:false,target:false};
      cell[role] = true;
      cells.set(key, cell);
    }
  }
  return {presentationContext:'history', endpointRoles:[...cells.values()]};
};

export const buildMovePreview = (move, {context} = {}) => {
  const animatedDestroyedPieces = buildDestroyedPieceOverlays({destroyedPieceRecords: immediateRemovalRecords(move), preActionSnapshot: move?.selectionSnapshot});
  const staticDestroyedPieces = buildDestroyedPieceOverlays({destroyedPieceRecords: moveStaticDestructionRecords(move), preActionSnapshot: moveInspectionSnapshot(move)});
  return {
    snapshot: moveInspectionSnapshot(move),
    overlay: {
    mode: "recorded-action",
    ...historyRoleOverlay([move?.action], context),
    recordedAction: move?.action ?? null,
    recordedActionStartPiece: findRecordedActionStartPiece(move?.selectionSnapshot, move?.action),
    destroyedPieces: [...animatedDestroyedPieces, ...staticDestroyedPieces],
    animatedDestroyedPieces,
    staticDestroyedPieces,
    },
  };
};

export const shouldAnimateHistoryDestruction = (game, episode) => {
  if (!game?.inHistoryMode || typeof episode?.scope !== 'string' || episode.scope.length === 0) return false;
  if (Number.isSafeInteger(game.historyTurnIndex)) return episode.scope === `${game.id}:turn:${game.historyTurnIndex}`;
  const move = game.inspectedDecision ?? game.moves?.find(record => record.index === game.historyIndex);
  const identities = [move?.moveId, move?.clientCommandId, game.historyIndex].filter(value => value !== null && value !== undefined);
  return identities.some(identity => episode.scope === `${game.id}:move:${identity}` || episode.scope === `${game.id}:archive:${identity}`);
};

export const createHistoryDestructionAnimationOwner = () => {
  let consumedEpisodeKey = null;
  return {
    claim(game, episode, hasEffects = true) {
      if (!hasEffects || typeof episode?.key !== 'string' || consumedEpisodeKey === episode.key || !shouldAnimateHistoryDestruction(game, episode)) return false;
      consumedEpisodeKey = episode.key;
      return true;
    },
  };
};

export const buildTurnPreview = (moves, {context} = {}) => {
  const ordered = visibleRecordedMoves(moves).sort((a,b) => (a.turnMoveIndex ?? a.index) - (b.turnMoveIndex ?? b.index));
  const previews = ordered.map(move => buildMovePreview(move));
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
  const animatedDestroyedPieces=buildDestroyedPieceOverlays({destroyedPieceRecords:ordered.flatMap(turnInspectionRemovalRecords),preActionSnapshot:ordered[0]?.selectionSnapshot});
  return {
    snapshot: ordered.at(-1)?.snapshot ?? previews.at(-1)?.snapshot ?? null,
    overlay: {mode:'recorded-turn', ...historyRoleOverlay(ordered.map(move => move.action), context), recordedActions:actions,
      destroyedPieces:animatedDestroyedPieces,animatedDestroyedPieces,staticDestroyedPieces:[]},
  };
};

export const historyTurnSide = (turn, moves) => {
  if (turn?.playerSeat === 'Player 1') return 'P1';
  if (turn?.playerSeat === 'Player 2') return 'P2';
  const ordered = [...(moves ?? [])].sort((a,b)=>(a.turnMoveIndex ?? a.index)-(b.turnMoveIndex ?? b.index));
  const first = ordered.find(move => !move.undone) ?? ordered[0];
  return (first?.selectionSnapshot ? getTurnOwnerSideForState(first.selectionSnapshot) : null) ?? first?.actorSide ?? 'P1';
};
