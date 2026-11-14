import { SYNC_TIMING } from "../generated/packages/shared-types/src/sync-protocol.js";

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
    && Number.isFinite(foregroundWaitMs)
    && foregroundWaitMs >= SYNC_TIMING.reconnectAlertMs;
  return Object.freeze({
    unavailable,
    pulsing,
    elapsedMs: pulsing ? foregroundWaitMs - SYNC_TIMING.reconnectAlertMs : 0,
    episodeId: pulsing ? game?.recoveryEpisodeId ?? null : null,
  });
}

export function normalizeMutationSurface(value, unavailable) {
  const pulsing = Boolean(unavailable && value?.pulsing);
  const elapsedMs = pulsing && Number.isFinite(value?.elapsedMs) && value.elapsedMs >= 0
    ? value.elapsedMs
    : 0;
  return {
    unavailable: Boolean(unavailable),
    pulsing,
    elapsedMs,
    episodeId: pulsing && typeof value?.episodeId === "string" ? value.episodeId : null,
  };
}
