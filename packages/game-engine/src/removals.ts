import type { Piece, GameState, Action } from "./types";

export type RemovalEvent = { piece: Piece; reason: "no_retreat" | "loss_of_supply" };
export type RemovalCollector = (event: RemovalEvent) => void;

/** Capture before mutation. Events are observations, never part of hashed state. */
export const reportRemoval = (piece: Piece, reason: RemovalEvent["reason"], collect?: RemovalCollector) => {
  collect?.({ piece: structuredClone(piece), reason });
};

export const destructionRecords = (events: RemovalEvent[], operationId?: string) => events.map(({ piece, reason }) => ({
  ...(operationId ? { eventId: `${operationId}:${piece.id}` } : {}),
  pieceId: piece.id, kind: piece.kind, piece: structuredClone(piece),
  position: { ...piece.position }, ownerSeat: piece.owner === "P1" ? "p1" as const : "p2" as const,
  supplied: piece.supplied, commanded: piece.commanded, reason,
}));

export const removalNotices = (events: RemovalEvent[], operationId?: string) => events.map(({ piece, reason }) => ({
  ...(operationId ? { eventId: `${operationId}:${piece.id}` } : {}),
  pieceId: piece.id, piece: structuredClone(piece), position: { ...piece.position }, reason,
  message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed ${reason === "no_retreat" ? "because it could not retreat" : "due to loss of supply"}`,
}));

/** Legacy snapshot adapter for saved previews. Live resolution uses observed events. */
export const collectDestroyedPieceRecords = (
  before: GameState,
  afterApply: GameState,
  afterStability: GameState,
  action: Action,
) => {
  const afterApplyIds = new Set(afterApply.pieces.map((piece) => piece.id));
  const afterStableIds = new Set(afterStability.pieces.map((piece) => piece.id));
  const records: Array<{position: {row: number; col: number}; ownerSeat: "p1" | "p2"; supplied: boolean; commanded: boolean; reason: "no_retreat" | "loss_of_supply" | "commander_unsupplied"}> = [];

  for (const piece of before.pieces) {
    if (!afterApplyIds.has(piece.id)) {
      const reason: "no_retreat" | "loss_of_supply" | "commander_unsupplied" =
        piece.kind === "commander"
          ? "commander_unsupplied"
          : piece.pushed || action.type === "push" || action.type === "retreat"
            ? "no_retreat"
            : "loss_of_supply";
      records.push({
        position: { ...piece.position },
        ownerSeat: piece.owner === "P1" ? "p1" : "p2",
        supplied: piece.supplied !== false,
        commanded: piece.commanded !== false,
        reason,
      });
    }
  }

  for (const piece of afterApply.pieces) {
    if (!afterStableIds.has(piece.id)) {
      const reason: "no_retreat" | "loss_of_supply" | "commander_unsupplied" =
        piece.kind === "commander" ? "commander_unsupplied" : "loss_of_supply";
      records.push({
        position: { ...piece.position },
        ownerSeat: piece.owner === "P1" ? "p1" : "p2",
        supplied: piece.supplied !== false,
        commanded: piece.commanded !== false,
        reason,
      });
    }
  }

  return records;
};

