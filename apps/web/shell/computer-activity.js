import { COMPUTER_TIMING, computerProfileFor } from '../generated/packages/shared-types/src/computer-play.js';

const workingPhases = new Set(['preparing', 'initializing-verified-runtime', 'initializing', 'computing', 'checking', 'looking-ahead', 'saving']);

/** Local runner health is distinct from the computer opponent's identity. */
export function computerActivity({ game, identityId, deviceId, authenticated, visible, status = {}, projection = {}, now, resuming = false, waitingMs = 0, lastAcquisitionFailure = null, resumeSupported = true, controlAcknowledged = true }) {
  const control = game?.computer;
  if (!control) return null;
  const owner = control.ownerId === identityId && game.canControlComputer !== false;
  const ongoing = game.board?.state?.outcome?.status === 'ongoing';
  const turnIndex = game.currentTurn?.index ?? game.board?.state?.turnIndex ?? 0;
  const override = control.paused || control.manual || control.takeoverTurn === turnIndex;
  const liveLease = Boolean(control.lease && control.lease.expiresAt > now);
  const localLease = liveLease && control.lease.deviceId === deviceId;
  const uncertain = Boolean(projection.sharedMutationsBlocked || projection.pendingCommandCount > 0);
  const activeHere = Boolean(owner && authenticated && visible && ongoing && localLease && controlAcknowledged && !override && !uncertain && !resuming && !lastAcquisitionFailure && !['recovery', 'other-device'].includes(status.phase));
  let state = 'attention', label = 'Needs attention';
  if (resuming) { state = 'resuming'; label = 'Resuming'; }
  else if (override) { state = 'paused'; label = 'Paused'; }
  else if (activeHere) { state = 'here'; label = 'Active here'; }
  else if (liveLease && !localLease) { state = 'elsewhere'; label = 'Active in another tab'; }
  let disabledReason = null;
  if (!owner || !authenticated) disabledReason = 'Only the game owner can resume computer play.';
  else if (!ongoing) disabledReason = 'This game has finished.';
  else if (!resumeSupported) disabledReason = 'Refresh after the server update to resume computer play here.';
  else if (resuming) disabledReason = 'Resuming computer play…';
  const computerTurn = computerProfileFor(control, game.board?.state?.sideToMove, turnIndex);
  const showRecoveryNotice = Boolean(resumeSupported && owner && authenticated && visible && ongoing && computerTurn && !override && !uncertain && !resuming && !activeHere && !liveLease && !workingPhases.has(status.phase) && status.phase !== 'recovery' && waitingMs >= COMPUTER_TIMING.stalledAfterMs);
  return { state, label, activeHere, showResume: !activeHere, disabledReason, showRecoveryNotice, waitingMs, lastAcquisitionFailure };
}
