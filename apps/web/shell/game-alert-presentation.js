import {icon} from './ui.js';
import {renderGameAlertCard} from './game-alert.js';
import {renderBoardContext} from './board-context.js';
import {patchNotificationTree,patchNotificationHtml,replaceMainPreservingHeader} from './notification-dom.js';

/** Native recovery choices retain their existing authority and timing decisions. */
export const renderRecoveryActions=({game,dismissed,recoveryNeedsAction,escapeHtml})=>!recoveryNeedsAction ? "" : game.storageBlocked
          ? `<button class="secondary mini-button" data-action="retry-saving" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Retry saving</button>${dismissed ? "" : `<button class="secondary mini-button" data-action="dismiss-recovery-notice" data-game-id="${escapeHtml(game.id)}">${icon('close')}Dismiss</button>`}`
          : game.upgradeRequired ? `<button class="secondary mini-button" data-action="refresh-game">${icon('rematch')}Reload game</button><a class="secondary mini-button button-link" href="#/">${icon('home')}Home</a>`
          : ["session_changed", "invalid_credentials"].includes(game.recoveryIssue) ? `<button class="secondary mini-button" data-action="account-open">${icon('account')}Sign in</button>`
          : `<button class="secondary mini-button" data-action="reconnect-safely" data-game-id="${escapeHtml(game.id)}">${icon('rematch')}Reload game</button><a class="secondary mini-button button-link" href="#/">${icon('home')}Home</a>`;

/** Reads live application dependencies on every render; it never owns gameplay. */
export function createGameAlertItems(getDependencies) {
 return (game) => {
  const {transport,maybeUpdateUndoRequestOutcomeFeedback,presentedRecoveryMessage,needsRecoveryAction,recoveryPresentationOptions,issueDiagnostics,isDiagnosticOpen,dismissedRecoveryNotices,escapeHtml,recoveryActivity,activityActorSide,playbackRecoveryWait,viewingScope,liveBoardVisible,SYNC_TIMING,renderComputerProgress,computerSession,getActiveRevertRequest,getActivePendingRevertRequest,undoApprovalActorSide,boardContextScope,boardContexts,contextReplayEnabled}=getDependencies();
  const failedOperations = transport.getFailedOperations?.(game.id) ?? [];
  maybeUpdateUndoRequestOutcomeFeedback(game);

  const items = failedOperations.map((operation) => ({
    key: `failed:${operation.id}`, priority: "urgent",
    html: renderGameAlertCard({
      tone: "danger",
      body: escapeHtml(operation.error?.message || "The operation could not be completed."),
      action: `<button class="secondary mini-button" data-action="dismiss-failed-operation" data-operation-id="${escapeHtml(operation.id)}">${icon('close')}Dismiss</button>`,
      testId: "sync-failure-banner", incidentId: (issueDiagnostics.list().find(r => r.key === `operation:${operation.id}`)?.id ?? issueDiagnostics.capture(`operation:${operation.id}`, { operation: operation.kind ?? "game_operation", code: operation.error?.code, gameId: game.id, stage: "operation_failed" })),
    }),
  }));

  const message = presentedRecoveryMessage(game);
  const recoveryNeedsAction = needsRecoveryAction(game, Date.now(), recoveryPresentationOptions(game));
  for (const report of issueDiagnostics.list().filter(r => r.initial.gameId === game.id && r.key.startsWith("operation:"))) if (!failedOperations.some(op => `operation:${op.id}` === report.key)) issueDiagnostics.resolve(report.key);
  const retained = issueDiagnostics.list().filter(r => r.initial.gameId === game.id && r.resolvedAt && isDiagnosticOpen(r.id));
  for (const report of retained) items.push({ key: `resolved:${report.id}`, html: renderGameAlertCard({ body: "Resolved", incidentId: report.id, action: `<button class="secondary mini-button" data-action="dismiss-diagnostic" data-incident-id="${report.id}">${icon('close')}Dismiss</button>` }) });
  if (!message) dismissedRecoveryNotices.delete(game.id);
  const dismissed = dismissedRecoveryNotices.get(game.id) === message;
  if (message && (!dismissed || game.storageBlocked)) {
    items.unshift({
      key: `live-sync:${game.id}:${game.recoveryEpisodeId ?? "current"}`, priority: recoveryNeedsAction ? "urgent" : "normal",
      html: renderGameAlertCard({ tone: recoveryNeedsAction ? "warn" : "neutral", activity: recoveryActivity(game), actorSide: activityActorSide(game), body: dismissed ? "Saving is paused." : escapeHtml(message), testId: "sync-recovery-banner", incidentId: recoveryNeedsAction ? game.incidentId : null,
        action: renderRecoveryActions({game,dismissed,recoveryNeedsAction,escapeHtml}),
      }),
    });
  }
  if (game.historyNotice) items.push({ key: `history-change:${game.id}`, paperKind:'history-change', html: renderGameAlertCard({ body: escapeHtml(game.historyNotice) }) });

  const playbackWait=playbackRecoveryWait.update({scope:`${viewingScope()}:${game.id}`,active:liveBoardVisible(),blocked:Boolean(game.confirmedPlayback?.retrying)});
  if(playbackWait>=SYNC_TIMING.reconnectAlertMs)items.push({key:`confirmed-playback-recovery:${game.id}`,priority:playbackWait>=SYNC_TIMING.confirmationBudgetMs?'urgent':'normal',html:renderGameAlertCard({
    body:playbackWait>=SYNC_TIMING.confirmationBudgetMs?'Still loading the move. Retrying in the background.':'Loading the move.',
    testId:'confirmed-playback-recovery',action:playbackWait>=SYNC_TIMING.confirmationBudgetMs?`<button class="secondary mini-button" data-action="retry-confirmed-playback" ${game.confirmedPlayback.canRetry?'':'disabled'}>Retry</button>`:''})});
  const computerNotice=renderComputerProgress(game,computerSession?.snapshot());
  if(computerNotice) items.push({key:`computer:${game.id}`,priority:computerSession?.snapshot().phase==='recovery'?'urgent':'normal',html:computerNotice});
  const approval = getActiveRevertRequest(game), waiting = getActivePendingRevertRequest(game);
  const request = approval ?? waiting;
  if (request) {
    const move = game.moves?.find(entry => entry.moveId === request.targetMoveId);
    const attrs = `data-game-id="${escapeHtml(game.id)}" data-request-id="${escapeHtml(request.requestId)}"`;
    items.push({key:`undo-request:${request.requestId}`, priority:items.some(item=>item.priority==='urgent')?'normal':'urgent', html:renderGameAlertCard({activity:'waiting', actorSide:undoApprovalActorSide(game,request), testId:approval?'undo-approval-notice':'undo-waiting-notice',
      body:approval ? `Undo requested before ${escapeHtml(move?.notation ?? 'this move')}` : 'Waiting for undo approval',
      action:approval ? `<button data-action="accept-revert-request" ${attrs}>${icon('check')}Accept</button><button class="secondary" data-action="reject-revert-request" ${attrs}>${icon('close')}Reject</button>` : `<button class="secondary" data-action="rescind-revert-request" ${attrs}>${icon('close')}Cancel request</button>`})});
  }

  const {undoRequestFeedback,undoRequestFeedbackGameId}=getDependencies();
  if (undoRequestFeedback && undoRequestFeedbackGameId === game.id) {
    items.push({
      key: `undo:${game.id}`, paperKind:'undo-outcome',
      html: renderGameAlertCard({
        body: escapeHtml(undoRequestFeedback),
      }),
    });
  }

  boardContextScope();
  for(const context of boardContexts.items(game.id))items.push({key:`board-context:${context.key}`,priority:'normal',html:renderBoardContext(context,{replayEnabled:contextReplayEnabled(context.replay)})});
  return items;
};

}

export const renderGameAlertStackCard = ({ gameId, item, stackIndex, totalAlerts }, escapeHtml) => {
  const isActive = stackIndex === 0;
  const interactive = totalAlerts > 1 && stackIndex === 0;
  const ariaLabel = interactive
    ? `Show next notification. ${stackIndex + 1} of ${totalAlerts} is active.`
    : `Notification ${stackIndex + 1} of ${totalAlerts}.`;
  return `<div
      class="shell-game-alert-stack-card${isActive ? " is-active" : ""}${interactive ? " is-interactive" : ""}"
      data-alert-stack-card
      data-key="${escapeHtml(item.key)}"
      data-notification-id="${escapeHtml(item.key)}"
      data-paper-kind="${['history-change','undo-outcome'].includes(item.paperKind)?item.paperKind:''}"
      data-paper-priority="${item.priority==='urgent'?'urgent':'normal'}"
      data-stack-index="${stackIndex}"
      data-stack-count="${totalAlerts}"
      ${interactive
        ? `data-action="cycle-game-alert-stack" data-game-id="${escapeHtml(gameId)}" tabindex="0"`
        : isActive
          ? 'tabindex="-1"'
          : 'aria-hidden="true" tabindex="-1" inert'}
      aria-label="${escapeHtml(ariaLabel)}"
    >
      ${item.html}
    </div>`;
};


/** Capture geometry before any owned DOM mutation, then reconcile paper state. */
export function createNotificationPatchLifecycle(paper,{patchTree=patchNotificationTree,patchHtml=patchNotificationHtml,replaceMain=replaceMainPreservingHeader}={}) {
 return {
  patchTree(current,next){paper.captureBeforePatch();patchTree(current,next);paper.sync();},
  patchHtml(current,html){paper.captureBeforePatch();patchHtml(current,html);paper.sync();},
  patchMainMarkup({appEl,nextMarkup,lastRenderedMarkup,routeName,patchHomeAroundCreateControl,createMarkupRoot,updateMountedFlyouts}){
   paper.captureBeforePatch();
   if(nextMarkup===lastRenderedMarkup)return false;
   if(routeName!=='home'||!patchHomeAroundCreateControl(nextMarkup)){
    const currentMain=appEl.querySelector('.shell-main-content');
    const nextMain=createMarkupRoot(nextMarkup)?.querySelector('.shell-main-content');
    if(currentMain&&nextMain){if(!replaceMain(currentMain,nextMain))currentMain.replaceWith(nextMain);updateMountedFlyouts();}
    else appEl.innerHTML=nextMarkup;
   }
   return true;
  },
 };
}
