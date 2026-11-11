// Presentation transition ownership, shared by the app and executed integration
// tests. Reads current collaborators for each explicit route transition.
export function createPanelTransitionPreparation(getDependencies) {
 let generation=0;
 return (previous,next)=>{
  const currentGeneration=++generation,d=getDependencies();
  if(d.pendingBoardContextReplay&&(next.name!=='game'||next.gameId!==d.pendingBoardContextReplay.descriptor.gameId||d.getGamePanel(next)!=='board'))d.cancelPendingBoardContextReplay();
  if(previous.name!==next.name||previous.gameId!==next.gameId)d.retireBoardContext();
  if(previous.name==='game'&&(next.name!=='game'||next.gameId!==previous.gameId))d.liveTurnOverview.leave();
  d.homeSectionReads.leaveHome(previous,next);
  if(previous.name==='game'&&(next.gameId!==previous.gameId||d.getGamePanel(previous)!==d.getGamePanel(next)))d.viewingIntent.saveScroll(previous.gameId,d.getGamePanel(previous),d.window.scrollY);
  if(next.name!=='game'){if(previous.gameId)d.viewingIntent.cancelUndo(previous.gameId);d.replayController?.stop('navigation');return;}
  const changedPanel=next.gameId!==previous.gameId||d.getGamePanel(previous)!==d.getGamePanel(next);
  if(changedPanel){d.replayRequests.cancel();d.replayController?.stop('navigation');}
  if(d.getShellLayoutModeForRoute(next)==='narrow'&&changedPanel){
   if(d.getGamePanel(next)==='board'&&d.transport.getGameViewModel(next.gameId)?.inHistoryMode)d.transport.returnToLive({gameId:next.gameId});
   if(!d.pendingRoutePosition){
    const owner=d.transport,scope=d.viewingScope(),navigation=d.mobileNavigation;
    d.window.requestAnimationFrame(()=>{
     const current=getDependencies(),route=current.getCurrentRoute();
     if(currentGeneration!==generation||current.transport!==owner||current.viewingScope()!==scope||current.mobileNavigation!==navigation||current.document?.hidden||route?.name!==next.name||route?.gameId!==next.gameId||current.getGamePanel(route)!==d.getGamePanel(next))return;
     navigation?.restoreScroll(current.viewingIntent.scrollTop(next.gameId,current.getGamePanel(next)));
    });
   }
  }
 };
}
