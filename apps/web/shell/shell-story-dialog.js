import { createOpponentStoryDialog } from './opponent-stories.js';

// The shell owns the current account, route and transport; read them at the
// action boundary so a dialog cannot retain a replaced session.
export function createShellStoryDialog({createModal,document,getHomeReadRecovery,getComputerReadiness,
 getAccount,getTransport,getCurrentRoute,opponentSession,prepareOpponent,preparation,gameSound,
 startGameEntryRouteTransition,navigateTo,buildGameHash,getCurrentFlyoutState,openFriendInvite,
 resumePendingResult,presentGameResult,createMiniBoardPreview,createInitialBoardSnapshot,createEngineBoardAdapter}) {
 let dialog;
 dialog = createOpponentStoryDialog({ createModal, document, getReadiness: (opponent,modelId) => getHomeReadRecovery() ? {state:'preparing',message:'Your games are still reconnecting.'} : opponent === 'friend' ? {state:'ready'} : getComputerReadiness("intro",modelId),
  onViewResult: presentGameResult,
  onPlay: intent => {
    if(getHomeReadRecovery())return {state:'error',message:'Reconnect your games before starting.'};
    if(intent.opponent !== 'friend') return opponentSession.play(intent);
    if(!getAccount().canPlay()) return {state:'error',message:'Sign in to start your game.'};
    dialog.close('play');
    const handle=getTransport().createGame({selfPlayMode:false});
    startGameEntryRouteTransition(handle.result.id,getCurrentRoute().name);
    navigateTo(buildGameHash(handle.result.id,null,getCurrentFlyoutState()));
    openFriendInvite(handle.result.id);
    return {state:'started'};
  }, onRetry:(opponent,modelId)=>prepareOpponent('intro',opponent,modelId), onModelChange:(opponent,modelId)=>prepareOpponent('intro',opponent,modelId), onClose:reason=>{preparation.cancel('intro');opponentSession.cancel();if(reason === 'dismiss')gameSound.play('intro-back');resumePendingResult();},
  onPresentation: () => { const root=document.createElement('div');root.className='story-presentation-board';root.setAttribute('aria-hidden','true');document.body.append(root);const preview=createMiniBoardPreview({rootEl:root,preview:{snapshot:createInitialBoardSnapshot(),previewKey:'intro'},createAdapter:createEngineBoardAdapter});return ()=>{preview.destroy();root.remove();}; },
});
 return dialog;
}
