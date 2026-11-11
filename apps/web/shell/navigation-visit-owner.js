// Own one deferred visit restoration with live account and destination authority.
export const createNavigationVisitOwner = getDependencies => {
const restore = () => {
  const {state,account,window,appEl,CSS,navigationHistory}=getDependencies();
  const position = state.pendingRoutePosition;
  if (!position) return;
  if (position.generation !== account.snapshot().generation) { state.pendingRoutePosition = null; return; }
  if (!state.routeHydrated || position.hash !== window.location.hash) return;
  const doc=appEl.ownerDocument,active=doc?.activeElement;
  if(position.focusOrigin && active?.isConnected && active!==doc?.body && active!==position.focusOrigin){state.pendingRoutePosition=null;return;}
  state.pendingRoutePosition = null;
  window.scrollTo({ top: position.y ?? 0, behavior: 'instant' });
  const target = state.currentRoute.name === 'home'
    ? (position.focusGameId ? appEl.querySelector(`.mini-board-card-link-surface[data-game-id="${CSS.escape(position.focusGameId)}"]`) : null) ?? appEl.querySelector('.shell-header-title-link')
    : appEl.querySelector('[data-shell-panel="board"] .board-heading, .board-heading');
  if (target) { if (!target.matches('a, button, [tabindex]')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  navigationHistory.save();
};
  const pop = event => {
    const {state,navigationHistory,account,advanceHomeReadVisit,clearAccountContinuation,window,appEl,applyHomeVisitPages,startRouteSync,render}=getDependencies();

  // Replacing a utility URL can leave adjacent visits with identical hashes.
  // Those traversals dispatch popstate without a subsequent hashchange.
  if (!navigationHistory.observePop(event.state)) return;
  const visit = navigationHistory.arrive();
  const saved = visit.restore?.generation === account.snapshot().generation ? visit.restore : null;
  if (!saved) return;
  // A distinct visit can share this URL after a utility was dismissed. There
  // will be no hashchange to retire its old Home owner or retained play choice.
  if (state.currentRoute.name === 'home') advanceHomeReadVisit();
  clearAccountContinuation();
  state.pendingRoutePosition = { ...saved, hash: window.location.hash, focusOrigin:appEl.ownerDocument?.activeElement };
  if (state.currentRoute.name === 'home') applyHomeVisitPages(saved.pages);
  if (state.currentRoute.name === 'home' && !state.homeSectionsHydrated) {
    startRouteSync();
  } else {
    render({ animatePanels: false, includeBoard: false });
    restore();
  }
  };
  return {restore,pop};
};
