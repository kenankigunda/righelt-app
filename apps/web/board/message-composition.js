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

// The complete prompt grammar, in both fonts, determines geometry. Live
// message changes cannot move the Board; viewport/font changes may resize it.
export function messageHeightTarget({primaryRoutine = 0, fallbackRoutine = 0} = {}) {
  return Math.max(0, primaryRoutine, fallbackRoutine);
}

// The owner supplies the currently interpolated rendered height on every
// retarget. A held native press defers geometric movement, never action state.
export function messageHeightTransition({from, to, initial = false, metricChange = false, reducedMotion = false, pressing = false} = {}) {
  if (pressing && from !== to) return {kind:'defer',height:from,target:to};
  return {kind:'snap',height:to};
}
