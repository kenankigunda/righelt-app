export const TERMINAL_OUTCOME_STATUSES = ['p1_win', 'p2_win', 'draw'];
export const isTerminalOutcome = (status) => TERMINAL_OUTCOME_STATUSES.some(value => value === status);
