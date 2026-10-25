// Capture owns its position independently of history navigation and catalog selection.
export function beginScenarioCapture(game, identityId, historyContext = null) {
  if (!game?.currentSnapshot) throw new Error('Open a position before capturing it.');
  if (game.historyLoading) throw new Error('Wait for the selected history position to finish loading.');
  const solelyOwned = [game.player1, game.player2].every(player => !player || player.identityId === identityId);
  const live = !game.inHistoryMode && solelyOwned && game.selfPlayMode && (!game.computer || game.computer.manual);
  return { gameId: game.id, mode: live ? 'live' : 'frozen', snapshot: structuredClone(historyContext?.currentSnapshot ?? game.currentSnapshot), selection: structuredClone(historyContext?.savedSelection ?? null) };
}
export function scenarioCapturePosition(capture, authoritativeGame) {
  if (!capture) return null;
  return capture.mode === 'live' && authoritativeGame?.id === capture.gameId ? authoritativeGame.board.state : capture.snapshot;
}
export function canLoadScenarioInPlace(game, identityId) {
  return Boolean(game && !game.computer && game.moves?.length === 0 && [game.player1, game.player2].some(player => player?.identityId === identityId) && [game.player1, game.player2].every(player => !player || player.identityId === identityId));
}
