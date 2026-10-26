// Confirmed records carry operationId:pieceId identities across receipts and sockets.
export const createDestructionSoundTracker = () => {
  const games = new Map();
  return {
    update(game, { commandId, sequence, baseline = false } = {}) {
      const previous = games.get(game?.id);
      const seen = previous?.seen ?? new Set(), causes = previous?.causes ?? new Set();
      const pieces = new Set((game?.board?.state?.pieces ?? []).map(piece => piece.id).filter(Boolean));
      const records = (game?.moves ?? []).filter(move => !move.undone).flatMap(move => (move.destroyedPieces ?? []).map(record => {
        const pieceId = record.pieceId ?? record.piece?.id;
        const fallback = move.clientCommandId ?? move.moveId ?? move.index;
        const key = record.eventId ?? `${fallback}:${pieceId ?? JSON.stringify(record.position)}`;
        const cause = record.eventId && pieceId && record.eventId.endsWith(`:${pieceId}`) ? record.eventId.slice(0, -(pieceId.length + 1)) : fallback;
        return { key, cause, pieceId };
      }));
      const newCauses = new Set();
      for (const {key,cause} of records) {
        if (!seen.has(key) && !causes.has(cause)) newCauses.add(cause);
        seen.add(key);causes.add(cause);
      }
      // Legacy projections may lack records. Compare identities, never net count:
      // projecting a new piece and destroying another can leave the count intact.
      const removed = previous ? [...previous.pieces].filter(id => !pieces.has(id)) : [];
      const unrecorded = removed.filter(id => !records.some(record => record.pieceId === id));
      const fallbackCause = commandId ?? game?.moves?.findLast(move => !move.undone)?.clientCommandId ?? `event-${sequence}`;
      if (unrecorded.length && !newCauses.size && !causes.has(fallbackCause)) newCauses.add(fallbackCause);
      if (unrecorded.length) causes.add(fallbackCause);
      games.set(game?.id, { pieces, seen, causes });
      while (games.size > 32) games.delete(games.keys().next().value);
      // Retained history can be bounded; forgetting an old event must not replay it.
      // Keep per-game identities for this visit rather than pruning by move count.
      return baseline || !previous ? 0 : newCauses.size;
    },
  };
};

// A short, unpitched stone fracture: sharp attack with a granular, dry decay.
export const playStoneCrack = audio => {
  const duration = .13, t = audio.currentTime;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x51a7;
  for (let i=0;i<samples.length;i++) {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    const time=i/audio.sampleRate;
    samples[i] = ((seed/4294967296)*2-1) * Math.exp(-time/ .022) * (1 + .35*Math.cos(time*740));
  }
  const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
  source.buffer=buffer;filter.type='highpass';filter.frequency.value=650;filter.Q.value=.6;gain.gain.value=.16;
  source.connect(filter);filter.connect(gain);gain.connect(audio.destination);
  source.start(t);source.stop(t+duration);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
};
