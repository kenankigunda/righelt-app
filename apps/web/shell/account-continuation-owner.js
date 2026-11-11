import {sameHomeReadScope,createHomeReadReplacement,sameRouteRead,bindHomeContinuationAfterRender,bindHomeContinuationAfterSettlement,resultForHomeContinuation} from './home-section-reads.js';

// Resolve live dependencies only when the original account action is resumed.
export const createAccountContinuationOwner = getDependencies => {
  const retry = async ({expectedPending,settlement} = {}) => {
  const {state,homeSectionReads,captureRouteRead,routeReadIsCurrent,render,syncRouteDataAndLiveChannels,queueResponsiveHomeSectionPageSizes,issueDiagnostics,account,getGameResult,rematchDialog,appEl,CSS,window}=getDependencies();
  let pending = state.accountContinuation;
  if (!pending || expectedPending && pending!==expectedPending || pending.running || !routeReadIsCurrent(pending)) return;
  const settled=settlement ? homeSectionReads.takeContinuationSettlement(pending,settlement) : null;
  if (settlement && !settled) return;
  let borrowedFailure=null,borrowedResult;
  if (settled) { try { borrowedResult=resultForHomeContinuation(settled); } catch (error) { borrowedFailure=error; } }
  if (borrowedResult?.recovered) pending.recoveryEpisode=true;
  pending.running = true;
  state.accountContinuationError = false;
  render({ animatePanels: false, includeBoard: false });
  const read=captureRouteRead();
  const bound=bindHomeContinuationAfterRender(pending,state.accountContinuation,read);
  if (!bound) { if (state.accountContinuation===pending) state.accountContinuation=null;return; }
  if (bound!==pending) { state.accountContinuation=bound;pending=bound;pending.running=true; }
  let result;
  try {
    if (borrowedFailure) throw borrowedFailure;
    if (settled && sameRouteRead(settled.read,read)) {
      result=borrowedResult;
    } else result = await syncRouteDataAndLiveChannels(read);
    if (result?.recovered) pending.recoveryEpisode = true;
  } catch (error) {
    if (pending.route.name === "home") pending.recoveryEpisode = true;
    if (state.accountContinuation === pending && routeReadIsCurrent(pending)) {
      pending.running = false;
      state.accountContinuationError = true;
      state.accountContinuationIncidentId = issueDiagnostics.capture("account-continuation", { ...error?.diagnosticEvidence, operation: "account_continuation", stage: "route_read_failed", code: error?.code ?? "unavailable", status: error?.status ?? null, gameId: pending.route?.gameId });
      render({ animatePanels: false, includeBoard: false });
    }
    return;
  }
  if (state.accountContinuation !== pending) return;
  const completedRead=captureRouteRead();
  if (!sameRouteRead(pending,completedRead)) {
    const terminal=bindHomeContinuationAfterSettlement({pending,currentPending:state.accountContinuation,read:completedRead,settledRead:read,result,job:state.homeReadJob,replacement:state.pendingResponsiveHomeRead});
    if (!terminal) return;
    state.accountContinuation=terminal.continuation;pending=terminal.continuation;
    if (terminal.requiresRead) {
      state.pendingResponsiveHomeRead={job:null,read:completedRead,continuation:pending,fulfilledByNewer:false};
      queueResponsiveHomeSectionPageSizes();
      return;
    }
  }
  // Claim before invoking the original action. A failed write is never replayed.
  state.accountContinuation = null;
  state.accountContinuationError = false;
  issueDiagnostics.resolve("account-continuation");
  state.routeHydrated = true;
  render({ animatePanels: false });
  // Recovery restores the retained choice. Only a new explicit Start may write.
  if (pending.recoveryEpisode) {
    if (pending.route.name === "home" && ["create-game", "create-self-play"].includes(pending.intent?.action)) {
      state.homeReadChoice = { read: pending, action: pending.intent.action };
      render({ animatePanels: false, includeBoard: false });
    }
    return;
  }
  const intent = pending.intent;
  if (!intent || !account.canPlay() || intent.hash !== window.location.hash) return;
  if (intent.action === "rematch") {
    const result = getGameResult(state.transport.getAuthoritativeGame(intent.gameId), state.transport.getIdentityId());
    if (result) rematchDialog.open(result, appEl.querySelector('[data-action="view-result"]'));
    return;
  }
  const selector = `[data-action="${CSS.escape(intent.action)}"]${intent.gameId ? `[data-game-id="${CSS.escape(intent.gameId)}"]` : ""}${intent.moveIndex ? `[data-move-index="${CSS.escape(intent.moveIndex)}"]` : ""}`;
  appEl.querySelector(selector)?.click();
};
  const observeRead = read => {
    const {state,queueResponsiveHomeSectionPageSizes,window}=getDependencies();
  if (state.homeReadJob && !sameRouteRead(state.homeReadJob.read, read)) {
    const previousJob = state.homeReadJob;
    // Bind any compatible continuation before retirement settles its old caller.
    const replacement = previousJob.read.inputs !== read.inputs && sameHomeReadScope(previousJob.read, read)
      ? createHomeReadReplacement({job:previousJob,activeJob:state.homeReadJob,read,pending:state.accountContinuation,recovery:state.homeReadRecovery}) : null;
    if (replacement?.continuation) state.accountContinuation=replacement.continuation;
    else if (replacement?.retiredContinuation && replacement.retiredContinuation===state.accountContinuation) state.accountContinuation=null;
    previousJob.retire();
    // Any caller can observe an input change, including an in-flight batch's
    // current-owner predicate. Only this same Home authority owes a replacement.
    if (replacement) {
      state.pendingResponsiveHomeRead = replacement;
      queueResponsiveHomeSectionPageSizes();
    }
  }
  if (state.pendingResponsiveHomeRead) {
    const pending = state.pendingResponsiveHomeRead;
    if (!sameHomeReadScope(pending.read, read)) {
      if (pending.continuation && pending.continuation===state.accountContinuation) state.accountContinuation=null;
      state.pendingResponsiveHomeRead = null;
      window.cancelAnimationFrame(state.homeSectionResizeFrame);state.homeSectionResizeFrame = 0;
    }
    else if (pending.read.inputs !== read.inputs) {
      const replacement=createHomeReadReplacement({job:pending.job,previous:pending,currentReplacement:state.pendingResponsiveHomeRead,read,pending:state.accountContinuation,recovery:state.homeReadRecovery});
      if (replacement.continuation) state.accountContinuation=replacement.continuation;
      else if (replacement.retiredContinuation && replacement.retiredContinuation===state.accountContinuation) state.accountContinuation=null;
      state.pendingResponsiveHomeRead = replacement;
      queueResponsiveHomeSectionPageSizes();
    }
  }
  if (state.homeReadRecovery && !sameRouteRead(state.homeReadRecovery.read, read)) state.homeReadRecovery = null;
  if (state.homeReadChoice && !sameRouteRead(state.homeReadChoice.read, read)) state.homeReadChoice = null;
  };
  return {retry,observeRead};
};
