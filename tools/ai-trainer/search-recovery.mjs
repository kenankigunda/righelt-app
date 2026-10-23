/** Exhausted bounded work is an unfinished diagnostic, never a value target. */
export function searchRecovery(result, game) {
  if (result.status === 'ready') return null;
  if (result.stopped !== 'deadline' && result.stopped !== 'node-limit') {
    throw new Error(`Generation recovery: ${result.reason}`);
  }
  return { type: 'unfinished', id: game.id, reason: 'search-recovery', search: result,
    game: { ...game, termination: 'unfinished' } };
}
