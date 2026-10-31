const terminal = new Set(['p1_win', 'p2_win', 'draw']);
export const isTerminalOutcome = status => terminal.has(status);

// History can display an earlier position while the authoritative game is over.
const outcome = game => (game?.liveCurrentSnapshot ?? game?.board?.state)?.outcome?.status;
export const isCompletedGame = game => isTerminalOutcome(outcome(game)) || (!outcome(game) && game?.status === 'finished');
export const isOngoingGame = game => !isCompletedGame(game) && outcome(game) === 'ongoing';
