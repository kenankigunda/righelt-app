/** Track newly observed records, including records appended when a turn ends. */
export const createDestructionTransitions = () => {
  let previous = null;
  const recordsFor = (game) => [...(game?.moves ?? []), ...(game?.pendingMoves ?? [])]
    .filter((move) => !move.undone)
    .flatMap((move) => (move.destroyedPieces ?? []).map((record) => ({
      ...record,
      eventId: record.eventId ?? `${move.clientCommandId ?? move.moveId ?? move.index}:${record.pieceId ?? `${record.position.row},${record.position.col}`}`,
    })));
  return {
    update(game, { reset = false } = {}) {
      const records = recordsFor(game);
      const ids = new Set(records.map((record) => record.eventId));
      const baseline = reset || !previous || previous.id !== game?.id || game?.inHistoryMode || previous.history || game?.recovering || game?.syncStatus === 'confirming';
      const cancelled = !baseline && [...previous.ids].some((id) => !ids.has(id));
      const effects = baseline || cancelled ? [] : records.filter((record) => !previous.ids.has(record.eventId)).map((record) => ({
        ...record,
        message: `Piece at (${record.position.row}, ${record.position.col}) destroyed ${record.reason === 'no_retreat' ? 'because it could not retreat' : 'due to loss of supply'}`,
      }));
      const clear = reset || cancelled || Boolean(game?.inHistoryMode && !previous?.history) || Boolean(game?.recovering && !previous?.recovering);
      previous = { id: game?.id, ids, history: Boolean(game?.inHistoryMode), recovering: Boolean(game?.recovering) };
      return { effects, clear };
    },
  };
};
