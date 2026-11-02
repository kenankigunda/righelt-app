// Semantic actions stay associated with their message. Only grammatical turn
// actions participate in its sentence; replay and status pills follow below.
const sentenceActionIds = new Set(['pass', 'end-turn']);
export function partitionMessageActions(actions = []) {
  return {
    inline: actions.filter(action => sentenceActionIds.has(action.id)),
    detached: actions.filter(action => !sentenceActionIds.has(action.id)),
  };
}

// Message precedence observes actual selection, including automatic selection.
// A hover coordinate alone is deliberately not a selected destination.
export function rushMessageContext({selectedPieceId = null, selectedTarget = null, requiredPieceIds = []} = {}) {
  if (selectedPieceId) return selectedTarget ? 'destination' : 'piece';
  return requiredPieceIds.length ? 'obligation' : 'routine';
}

// Only routine prompts establish the floor. Opponent/replay/extended copy is
// measured as current content, so a long historical message cannot become a
// permanent blank wall after the player returns to a short prompt.
export function messageHeightTarget({primaryRoutine = 0, fallbackRoutine = 0, current = 0} = {}) {
  return Math.max(0, primaryRoutine, fallbackRoutine, current);
}

// The owner supplies the currently interpolated rendered height on every
// retarget. A held native press defers geometric movement, never action state.
export function messageHeightTransition({from, to, initial = false, metricChange = false, reducedMotion = false, pressing = false} = {}) {
  if (pressing && from !== to) return {kind:'defer',height:from,target:to};
  if (initial || metricChange || reducedMotion || from === to) return {kind:'snap',height:to};
  return {kind:'animate',from,to,duration:to > from ? 450 : 280,easing:'cubic-bezier(.22,.72,.2,1)'};
}
