/** Capture before mutation. Events are observations, never part of hashed state. */
export const reportRemoval = (piece, reason, collect) => {
    collect?.({ piece: structuredClone(piece), reason });
};
export const destructionRecords = (events, operationId) => events.map(({ piece, reason }) => ({
    ...(operationId ? { eventId: `${operationId}:${piece.id}` } : {}),
    pieceId: piece.id, kind: piece.kind, piece: structuredClone(piece),
    position: { ...piece.position }, ownerSeat: piece.owner === "P1" ? "p1" : "p2",
    supplied: piece.supplied, commanded: piece.commanded, reason,
}));
export const removalNotices = (events, operationId) => events.map(({ piece, reason }) => ({
    ...(operationId ? { eventId: `${operationId}:${piece.id}` } : {}),
    pieceId: piece.id, piece: structuredClone(piece), position: { ...piece.position }, reason,
    message: `Piece at (${piece.position.row}, ${piece.position.col}) destroyed ${reason === "no_retreat" ? "because it could not retreat" : "due to loss of supply"}`,
}));
/** Legacy snapshot adapter for saved previews. Live resolution uses observed events. */
export const collectDestroyedPieceRecords = (before, afterApply, afterStability, action) => {
    const afterApplyIds = new Set(afterApply.pieces.map((piece) => piece.id));
    const afterStableIds = new Set(afterStability.pieces.map((piece) => piece.id));
    const records = [];
    for (const piece of before.pieces) {
        if (!afterApplyIds.has(piece.id)) {
            const reason = piece.kind === "commander"
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
            const reason = piece.kind === "commander" ? "commander_unsupplied" : "loss_of_supply";
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
