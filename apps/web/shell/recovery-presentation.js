/** Presentation uses the current foreground/owner scope, never a durable deadline.
 * The transport alone owns incident identity, sanitization and episode capture. */
export function createRecoveryPresentation(getDependencies) {
const options = game => {
  const {foregroundRecoveryWait,viewingScope,currentRoute,document,getCurrentViewedGameId,computerSession,quietComputerRenewal,transport}=getDependencies();
  return ({
  foregroundWaitMs: foregroundRecoveryWait.update({
    scope: `${viewingScope()}:${currentRoute.name === 'game' ? currentRoute.gameId : ''}:${game?.recoveryEpisodeId ?? ''}`,
    active: !document.hidden && currentRoute.name === 'game' && currentRoute.gameId === game?.id && !game?.inHistoryMode,
    blocked: Boolean(game?.sharedMutationsBlocked && (game.recovering || game.syncStatus === 'confirming' || game.confirmationOverdue)),
  }),
  computerSaveActive: game?.id === getCurrentViewedGameId() && computerSession?.snapshot().phase === 'saving',
  quietComputerRenewal: quietComputerRenewal(game),
});
};
  const incidentId=(game,required)=>required?getDependencies().transport.ensureRecoveryIncident(game.id):null;
  return {options,incidentId};
}
