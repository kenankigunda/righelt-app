// Browser callback. Both explicit false and absent aria-busy mean idle.
// Recovery and loading still require their affirmative settled markers.
export function readPlayableBoardAdmission() {
  const app = document.querySelector('#app');
  const board = document.querySelector('[data-testid="game-board-wrap"]');
  const busy = board?.getAttribute('aria-busy');
  return app?.getAttribute('data-shell-transition-phase') === 'idle'
    && board?.getAttribute('data-reconnecting') === 'false'
    && board?.getAttribute('data-loading-state') === 'idle'
    && !board.hasAttribute('data-board-pending')
    && (busy === null || busy === 'false');
}
