/** Track newly observed records, including records appended when a turn ends. */
export const createDestructionTransitions = () => {
  let previous = null;
  const moveKey = (move) => move.clientCommandId ?? move.moveId ?? move.index;
  const recordsFor = (game) => [...(game?.moves ?? [])]
    .filter((move) => !move.undone)
    .flatMap((move) => (move.destroyedPieces ?? []).map((record) => ({
      ...record,
      transitionMoveKey: moveKey(move),
      eventId: record.eventId ?? `${move.clientCommandId ?? move.moveId ?? move.index}:${record.pieceId ?? `${record.position.row},${record.position.col}`}`,
    })));
  return {
    update(game, { reset = false, frozen = false, sequence } = {}) {
      const records = recordsFor(game);
      const ids = new Set(records.map((record) => record.eventId));
      const baseline = frozen || previous?.frozen || reset || !previous || previous.id !== game?.id || game?.inHistoryMode || previous.history || game?.recovering || game?.syncStatus === 'confirming';
      const retainedMoves = new Set([...(game?.moves ?? [])].map(moveKey));
      // Evicting old history is not an undo. A rollback is also explicitly reset by the subscriber.
      const cancelled = !baseline && previous.records.some((record) => !ids.has(record.eventId) && retainedMoves.has(record.transitionMoveKey));
      const effects = baseline || cancelled ? [] : records.filter((record) => !previous.ids.has(record.eventId)).map(({ transitionMoveKey, ...record }) => ({
        ...record,
        message: `Destruction for piece at (${record.position.row}, ${record.position.col}) ${record.reason === 'no_retreat' ? 'because it could not retreat' : 'due to loss of supply'}`,
      }));
      // Legacy confirmed projections can omit destruction records. Only the
      // authoritative before/after identities may supply this fallback.
      if(!baseline&&!cancelled){
        const currentPieces=new Set((game?.board?.state?.pieces??[]).map(piece=>piece.id));
        for(const piece of previous.pieces??[])if(piece.position&&!currentPieces.has(piece.id)&&!records.some(record=>record.pieceId===piece.id||!record.pieceId&&record.position?.row===piece.position.row&&record.position?.col===piece.position.col&&(!record.ownerSeat||String(record.ownerSeat).toLowerCase()===piece.owner?.toLowerCase())))effects.push({eventId:`legacy:${game.id}:${sequence??game.gameplayRevision}:${piece.id}`,pieceId:piece.id,piece,position:piece.position,reason:'unavailable',message:`Destruction for piece at (${piece.position.row}, ${piece.position.col})`});
      }
      // History loadSnapshot owns replay cancellation and marker settlement.
      const clear = frozen || Boolean(previous?.frozen) || !game?.inHistoryMode && (reset || cancelled || Boolean(game?.recovering && !previous?.recovering));
      previous = { pieces:game?.board?.state?.pieces??[], frozen, id: game?.id, ids, records, history: Boolean(game?.inHistoryMode), recovering: Boolean(game?.recovering) };
      return { effects, clear };
    },
  };
};
