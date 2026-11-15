const moveKey = (move) => move.clientCommandId || move.moveId || null;
export const inspectionStateForMove = (move) => move.inspectionSnapshot ?? move.snapshot ?? null;
const displayedSupply = (piece) => {
    if (!piece)
        return null;
    return typeof piece.displaySupplied === "boolean" ? piece.displaySupplied : piece.supplied !== false;
};
/** Find the first move in the final uninterrupted unsupplied suffix. */
export const finalSupplyLossMoveId = (moves, pieceId, actualMoveId) => {
    const actualIndex = actualMoveId ? moves.findIndex(move => moveKey(move) === actualMoveId || move.moveId === actualMoveId) : moves.length - 1;
    if (actualIndex < 0)
        return null;
    let candidate = null;
    for (let index = 0; index <= actualIndex; index += 1) {
        const move = moves[index];
        const piece = inspectionStateForMove(move)?.pieces?.find(entry => entry.id === pieceId);
        const supplied = displayedSupply(piece);
        const key = moveKey(move);
        if (supplied === false && key)
            candidate = candidate ?? key;
        else
            candidate = null;
    }
    return candidate;
};
export const attributeDestructions = (records, moves, actualMoveId) => records.map(record => {
    const removalPhase = record.reason === "no_retreat" ? "immediate" : "turn_settlement";
    const causalMoveId = removalPhase === "immediate"
        ? actualMoveId
        : typeof record.pieceId === "string" && record.pieceId
            ? finalSupplyLossMoveId(moves, record.pieceId, actualMoveId)
            : null;
    return { ...record, removalPhase, ...(causalMoveId ? { causalMoveId } : {}) };
});
