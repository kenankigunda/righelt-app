import { SYNC_TIMING } from "../generated/packages/shared-types/src/sync-protocol.js";

export const SURFACE_PULSE_CYCLE_MS = 2_400;

const isRecoveryProcessing = (game) => Boolean(
  game?.sharedMutationsBlocked
  && !game?.storageBlocked
  && !game?.upgradeRequired
  && !game?.connectionFailed
  && !game?.recoveryIssue
  && game?.pendingComputerSaveStartedAt == null
  && !game?.inHistoryMode
  && (game?.recovering || game?.syncStatus === "confirming" || game?.confirmationOverdue)
);

// Presentation only. Command admission remains owned by the transport and host.
export function mutationSurfacePresentation(game, { foregroundWaitMs = 0 } = {}) {
  const unavailable = Boolean(game?.gameplayMutationsBlocked ?? game?.sharedMutationsBlocked);
  const pulsing = unavailable
    && isRecoveryProcessing(game)
    && foregroundWaitMs >= SYNC_TIMING.reconnectAlertMs;
  const phaseMs = pulsing
    ? (foregroundWaitMs - SYNC_TIMING.reconnectAlertMs) % SURFACE_PULSE_CYCLE_MS
    : 0;
  return Object.freeze({
    unavailable,
    pulsing,
    phaseMs,
    episodeId: pulsing ? game?.recoveryEpisodeId ?? null : null,
  });
}

export function normalizeMutationSurface(value, unavailable) {
  const pulsing = Boolean(unavailable && value?.pulsing);
  const phaseMs = pulsing && Number.isFinite(value?.phaseMs)
    ? Math.max(0, value.phaseMs % SURFACE_PULSE_CYCLE_MS)
    : 0;
  return {
    unavailable: Boolean(unavailable),
    pulsing,
    phaseMs,
    episodeId: pulsing && typeof value?.episodeId === "string" ? value.episodeId : null,
  };
}
