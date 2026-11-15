import type { GameState } from "./types";

export type RemovalPhase = "immediate" | "turn_settlement";

export type DestructionAttributionMove = {
  moveId?: string | null;
  clientCommandId?: string | null;
  turnIndex?: number;
  snapshot?: GameState | null;
  inspectionSnapshot?: GameState | null;
};
const moveKey = (move: DestructionAttributionMove) => move.clientCommandId || move.moveId || null;

export type AttributableDestruction = {
  pieceId?: string;
  reason?: string;
  removalPhase?: RemovalPhase;
  causalMoveId?: string;
};

export const inspectionStateForMove = (move: DestructionAttributionMove) =>
  move.inspectionSnapshot ?? move.snapshot ?? null;

const displayedSupply = (piece: GameState["pieces"][number] | undefined) => {
  if (!piece) return null;
  return typeof piece.displaySupplied === "boolean" ? piece.displaySupplied : piece.supplied !== false;
};

/** Find the first move in the final uninterrupted unsupplied suffix. */
export const finalSupplyLossMoveId = (
  moves: DestructionAttributionMove[],
  pieceId: string,
  actualMoveId: string | null,
) => {
  const actualIndex = actualMoveId ? moves.findIndex(move => moveKey(move) === actualMoveId || move.moveId === actualMoveId) : moves.length - 1;
  if (actualIndex < 0) return null;
  let candidate: string | null = null;
  for (let index = 0; index <= actualIndex; index += 1) {
    const move = moves[index];
    const piece = inspectionStateForMove(move)?.pieces?.find(entry => entry.id === pieceId);
    const supplied = displayedSupply(piece);
    const key = moveKey(move);
    if (supplied === false && key) candidate = candidate ?? key;
    else candidate = null;
  }
  return candidate;
};

export const attributeDestructions = <T extends AttributableDestruction>(
  records: T[],
  moves: DestructionAttributionMove[],
  actualMoveId: string | null,
): Array<T & { removalPhase: RemovalPhase; causalMoveId?: string }> => records.map(record => {
  const removalPhase: RemovalPhase = record.reason === "no_retreat" ? "immediate" : "turn_settlement";
  const causalMoveId = removalPhase === "immediate"
    ? actualMoveId
    : typeof record.pieceId === "string" && record.pieceId
      ? finalSupplyLossMoveId(moves, record.pieceId, actualMoveId)
      : null;
  return { ...record, removalPhase, ...(causalMoveId ? { causalMoveId } : {}) };
});
