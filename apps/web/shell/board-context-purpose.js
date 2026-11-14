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

// Only a producer's final outer purpose can move a mixed-channel message.
// Unknown legacy contexts stay in their existing notice owner until classified.
export function boardContextPlacement(context) {
  if (context?.purpose === BOARD_CONTEXT_PURPOSE.INCOMING) return 'incoming';
  return purposes.has(context?.purpose) ? 'board' : 'notice';
}

const boardPriority=context=>({
 [BOARD_CONTEXT_PURPOSE.REQUIRED]:5,
 [BOARD_CONTEXT_PURPOSE.REPLAY]:4,
 [BOARD_CONTEXT_PURPOSE.HISTORY]:3,
 [BOARD_CONTEXT_PURPOSE.PIECE]:2,
 [BOARD_CONTEXT_PURPOSE.SEQUENCE]:1,
 [BOARD_CONTEXT_PURPOSE.BOARD]:1,
}[context?.purpose]??0);

// Board channels publish independently, but only one may own the visible
// message region. Incoming narration and legacy notice hosts remain separate.
export function arbitrateBoardContexts(contexts){
 const board=contexts.filter(context=>boardContextPlacement(context)==='board');
 if(board.length<2)return contexts;
 const winner=[...board].sort((left,right)=>boardPriority(right)-boardPriority(left)||Number(right.channel==='acknowledged')-Number(left.channel==='acknowledged'))[0];
 return contexts.filter(context=>boardContextPlacement(context)!=='board'||context===winner);
}
