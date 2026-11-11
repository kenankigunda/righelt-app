// Presentation purposes belong to the producer. Neither channel names nor
// player-controlled prose determine where a message is displayed.
export const BOARD_CONTEXT_PURPOSE = Object.freeze({
  INCOMING: 'incoming-narration',
  HISTORY: 'selected-history',
  PIECE: 'piece-inspection',
  REQUIRED: 'required-continuation',
  REPLAY: 'replay-progress',
  SEQUENCE: 'local-sequence',
  BOARD: 'board-context',
});

const purposes = new Set(Object.values(BOARD_CONTEXT_PURPOSE));

export function acknowledgedContextPurpose({selectedHistory = false, recordedMove = null, message} = {}) {
  // A real selected History view wins. Confirmed playback uses a synthetic
  // historical frame but remains incoming narration in the live presentation.
  if (selectedHistory) return BOARD_CONTEXT_PURPOSE.HISTORY;
  if (recordedMove) return BOARD_CONTEXT_PURPOSE.INCOMING;
  return purposes.has(message?.purpose) ? message.purpose : BOARD_CONTEXT_PURPOSE.BOARD;
}

export function runtimeContextPurpose(context) {
  if (context?.mandatory) return BOARD_CONTEXT_PURPOSE.REQUIRED;
  if (context?.kind === 'replay-progress') return BOARD_CONTEXT_PURPOSE.REPLAY;
  if (context?.kind === 'history') return BOARD_CONTEXT_PURPOSE.HISTORY;
  if (['inspection', 'piece-explanation', 'rush-effect', 'rush-hints', 'rush-loading', 'no-moves', 'blocked-move'].includes(context?.kind)) return BOARD_CONTEXT_PURPOSE.PIECE;
  return BOARD_CONTEXT_PURPOSE.BOARD;
}
