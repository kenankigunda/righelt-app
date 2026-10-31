import {isCompletedGame} from './game-lifecycle.js';
import { COMPUTER_TIMING, computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';
import { SYNC_TIMING } from '../generated/packages/shared-types/src/sync-protocol.js';

const workingPhases = new Set(['preparing', 'initializing-verified-runtime', 'initializing', 'computing', 'checking', 'looking-ahead', 'saving']);

/** Local runner health is distinct from the computer opponent's identity. */
export function computerActivity({ game, identityId, deviceId, authenticated, visible, status = {}, projection = {}, now, resuming = false, waitingMs = 0, lastAcquisitionFailure = null, resumeSupported = true, controlAcknowledged = true, renewing = false }) {
  const control = game?.computer;
  if (!control) return null;
  if(isCompletedGame(game))return {state:'finished',label:'Game finished',activeHere:false,quietRenewal:false,showResume:false,disabledReason:null,showRecoveryNotice:false,waitingMs:0,lastAcquisitionFailure:null};
  const owner = control.ownerId === identityId && game.canControlComputer !== false;
  const ongoing = game.board?.state?.outcome?.status === 'ongoing';
  const turnIndex = game.currentTurn?.index ?? game.board?.state?.turnIndex ?? 0;
  const override = control.paused || control.manual || control.takeoverTurn === turnIndex;
  const liveLease = Boolean(control.lease && control.lease.expiresAt > now);
  const localLease = liveLease && control.lease.deviceId === deviceId;
  const uncertain = Boolean(projection.sharedMutationsBlocked || projection.pendingCommandCount > 0 || projection.upgradeRequired);
  const computerTurn = computerProfileFor(control, game.board?.state?.sideToMove, turnIndex);
  const request = projection.pendingComputerControlRequest;
  // A fresh renewal does not invalidate an already acknowledged live lease.
  // This exception affects display only, never the pending-command or authority gates.
  const quietRenewal = Boolean(renewing && owner && authenticated && visible && ongoing && localLease && controlAcknowledged
    && !computerTurn && !override && !resuming && !lastAcquisitionFailure && status.phase === 'idle'
    && !game.inHistoryMode && !projection.inHistoryMode && projection.pendingCommandCount === 1 && projection.pendingComputerControl
    && projection.syncStatus === 'applying-update' && !projection.confirmationOverdue && !projection.recoveryIssue
    && !projection.storageBlocked && !projection.upgradeRequired && !projection.unsavedCommand
    && request?.action === 'renew' && request.deviceId === deviceId && request.generation === control.generation
    && Number.isFinite(request.submittedAt) && request.submittedAt <= now && now - request.submittedAt < SYNC_TIMING.confirmationBudgetMs);
  const activeHere = Boolean(owner && authenticated && visible && ongoing && localLease && controlAcknowledged && !override && (!uncertain || quietRenewal) && !resuming && !lastAcquisitionFailure && !['recovery', 'other-device'].includes(status.phase));
  let state = 'attention', label = 'Needs attention';
  if (resuming) { state = 'resuming'; label = 'Resuming'; }
  else if (override) { state = 'paused'; label = 'Paused'; }
  else if (activeHere) { state = 'here'; label = 'Active here'; }
  else if (liveLease && !localLease) { state = 'elsewhere'; label = 'Active in another tab'; }
  else if (!uncertain && !lastAcquisitionFailure && status.phase !== 'recovery' && owner && authenticated && ongoing && (!visible || !computerTurn)) { state = 'idle'; label = visible ? 'Waiting for a turn' : 'Inactive in this tab'; }
  let disabledReason = null;
  if (!owner || !authenticated) disabledReason = 'Only the game owner can resume computer play.';
  else if (!ongoing) disabledReason = 'This game has finished.';
  else if (projection.upgradeRequired) disabledReason = 'Reload the game to resume computer play here.';
  else if (!resumeSupported) disabledReason = 'Refresh after the server update to resume computer play here.';
  else if (resuming) disabledReason = 'Resuming computer play…';
  const showRecoveryNotice = Boolean(resumeSupported && owner && authenticated && visible && ongoing && computerTurn && !override && !uncertain && !resuming && !activeHere && !liveLease && !workingPhases.has(status.phase) && status.phase !== 'recovery' && waitingMs >= COMPUTER_TIMING.stalledAfterMs);
  return { state, label, activeHere, quietRenewal, showResume: !activeHere, disabledReason, showRecoveryNotice, waitingMs, lastAcquisitionFailure };
}
