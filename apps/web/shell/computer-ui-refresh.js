/** Refresh current computer presentation without changing gameplay ownership. */
export function refreshComputerUi({boardRuntime,getCurrentViewedGameId,transport,appEl,
 updateReconnectPresentation,updateRecoveryAnnouncement,updateParticipantCards,
 storyDialog,syncRevisitedStory,renderGameAlertsHtml,patchNotificationHtml,patchToolHtml,renderDebugContent}) {
 boardRuntime?.refreshStatus?.();
 const gameId=getCurrentViewedGameId(),game=gameId?transport.getGameViewModel(gameId):null;
 const mountedGameId=appEl.querySelector('[data-testid="game-shell"]')?.getAttribute('data-game-id');
 if(game&&mountedGameId===game.id){updateReconnectPresentation(game);updateRecoveryAnnouncement(game);}
 updateParticipantCards(game);
 if(game&&storyDialog?.gameId()===game.id){storyDialog.refresh();syncRevisitedStory(game);}
 const alerts=appEl.querySelector('#shell-game-alerts');
 if(alerts&&game){
  const html=renderGameAlertsHtml(game);patchNotificationHtml(alerts,html);
  alerts.closest('[data-shell-alert-zone]')?.setAttribute('data-shell-alert-zone',html?'active':'idle');
 }
 const debug=appEl.querySelector('[data-flyout="debug"] .shell-flyout-scroll');
 if(debug)patchToolHtml(debug,renderDebugContent());
}
