import {shouldLiveSyncRoute} from './routes.js';
export const destinationReadScope = read => `${read.generation}:${read.epoch}:${read.routeKey}:${read.homeVisit ?? 0}`;
export const terminalColdDestination = ({route,game,presentation}) => route.name==='game' && !game && Boolean(presentation?.kind && presentation.kind!=='retry');
export const destinationHidesGameBody = (game,presentation) => !game && Boolean(presentation?.kind && presentation.kind!=='retry');

// Safe read lifecycle only. Actual gameplay admission remains with its existing owners.
export const createDestinationRouteOwner = getDependencies => {
const start = ({ renderStart = true } = {}) => {
  const {state,captureRouteRead,routeReadIsCurrent,canHydrateRouteFromLocalState,destinationRecovery,syncDestinationNotice,syncLiveChannels,render,syncRouteDataAndLiveChannels,issueDiagnostics,cancelPendingBoardContextReplay,window,invitationLoadFailureKind,maybeRevealRouteTransition}=getDependencies();
  const requestId = ++state.routeSyncRequestId;
  const read = captureRouteRead();
  const destinationRead=['game','home'].includes(read.route.name);
  const usableDestination=read.route.name==='game'?canHydrateRouteFromLocalState(read.route):read.route.name==='home' && state.homeSectionsHydrated;
  if(destinationRead)destinationRecovery.begin(destinationReadScope(read),{blocked:!usableDestination});else destinationRecovery.reset();
  const retrying = read.route.name === "invite" && state.inviteLoadState?.status === "error" && routeReadIsCurrent(state.inviteLoadState.read);
  state.inviteLoadState = read.route.name === "invite" ? { read, requestId, status: "loading", retrying, kind: "retry" } : null;
  state.resolvedInvite = null;
  state.routeHydrated = Boolean(usableDestination);
  syncDestinationNotice();
  syncLiveChannels();
  if (renderStart) {
    render({ animatePanels: false, includeBoard: false });
  }
  void (async () => {
    let succeeded=false;
    try {
      await syncRouteDataAndLiveChannels(read);
      succeeded=true;
      if (requestId === state.routeSyncRequestId && routeReadIsCurrent(read)) {
        state.inviteLoadState = null;
        issueDiagnostics.resolve("invite-load");
      }
    } catch (error) {
      if (requestId !== state.routeSyncRequestId || !routeReadIsCurrent(read)) return;
      cancelPendingBoardContextReplay();
      window.__righeltLastError = error instanceof Error ? error.message : String(error);
      if(destinationRead)destinationRecovery.fail(destinationReadScope(read),error);
      if (read.route.name === "invite" && error?.code !== "upgrade_required") {
        state.resolvedInvite = null;
        state.inviteLoadState = { read, requestId, status: "error", retrying: false, kind: invitationLoadFailureKind(error) };
        issueDiagnostics.capture("invite-load", { ...error?.diagnosticEvidence, operation: "invitation_lookup", stage: "route_read_failed", code: error?.code ?? "unavailable", status: error?.status ?? null });
      } else state.inviteLoadState = null;
    } finally {
      if (requestId !== state.routeSyncRequestId || !routeReadIsCurrent(read)) return;
      state.routeHydrated = !destinationRead || succeeded || Boolean(usableDestination);
      if(destinationRead && succeeded)destinationRecovery.reset();
      render({ animatePanels: false, includeBoard: false });
      if(destinationRead && !succeeded && !usableDestination){
        syncLiveChannels();
        if(read.route.name==='game' && state.destinationLoadPresentation?.kind && state.destinationLoadPresentation.kind!=='retry')read.owner?.setConnectionRecovering?.(read.route.gameId,false);
      }
      maybeRevealRouteTransition();
    }
  })();
};

const passive = async () => {
  const {state,captureRouteRead,routeReadIsCurrent,destinationRecovery,syncRouteDataAndLiveChannels,render,window,maybeRevealRouteTransition}=getDependencies();
  const read=captureRouteRead();
  try {
    await syncRouteDataAndLiveChannels(read);
    if(!routeReadIsCurrent(read))return;
    destinationRecovery.reset();
    state.routeHydrated = true;
    render({ animatePanels: false, includeBoard: false });
    maybeRevealRouteTransition();
  } catch (error) {
    window.__righeltLastError = error instanceof Error ? error.message : String(error);
  }
};

  return {start,passive};
};

// Read only the existing destination view and upgrade fence before rendering.
export const readGameDestination = ({gameId,transport,presentation,icon}) => {
  const game=transport.getGameViewModel(gameId);
  if(destinationHidesGameBody(game,presentation))return {game,markup:''};
  if(!game&&transport.isUpgradeRequired?.(gameId))return {game,markup:`<section class="panel" data-testid="sync-recovery-banner" role="status"><p>Righelt has an update. Refresh to keep playing.</p><button class="secondary" data-action="refresh-game">${icon('rematch')}Reload game</button><a class="secondary mini-button button-link" href="#/">${icon('home')}Home</a></section>`};
  return {game,markup:null};
};

export const destinationLiveGameId = ({route,transport,presentation,resolvedInvite}) => {
  const game=route.name==='game'?transport.getGameViewModel(route.gameId):null;
  if(terminalColdDestination({route,game,presentation})||!shouldLiveSyncRoute(route))return null;
  return route.name==='game'?route.gameId:route.name==='invite'?resolvedInvite?.gameId||null:null;
};
