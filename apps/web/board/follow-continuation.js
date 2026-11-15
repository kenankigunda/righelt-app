export function automaticFollowAction(state, actions = []) {
  if (state?.outcome?.status !== 'ongoing' || state.continuation?.type !== 'push' || state.continuation.phase !== 'follow') return null;
  const action = actions.length === 1 ? actions[0] : null;
  return action?.type === 'follow' && action.actorId && action.from && action.to ? action : null;
}
