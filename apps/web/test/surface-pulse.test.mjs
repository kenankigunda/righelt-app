import test from "node:test";
import assert from "node:assert/strict";

import { mutationSurfacePresentation, SURFACE_PULSE_CYCLE_MS } from "../board/surface-pulse.js";

const recovering = (overrides = {}) => ({
  sharedMutationsBlocked: true,
  gameplayMutationsBlocked: true,
  recovering: true,
  syncStatus: "confirming",
  recoveryEpisodeId: "episode-7",
  ...overrides,
});

test("surface pulse observes the existing four-second foreground grace and incident phase", () => {
  assert.deepEqual(mutationSurfacePresentation(recovering(), { foregroundWaitMs: 3_999 }), {
    unavailable: true, pulsing: false, phaseMs: 0, episodeId: null,
  });
  assert.deepEqual(mutationSurfacePresentation(recovering(), { foregroundWaitMs: 4_000 }), {
    unavailable: true, pulsing: true, phaseMs: 0, episodeId: "episode-7",
  });
  assert.equal(mutationSurfacePresentation(recovering(), {
    foregroundWaitMs: 4_000 + SURFACE_PULSE_CYCLE_MS + 375,
  }).phaseMs, 375);
});

test("hidden/background time and non-processing fences never animate mutation surfaces", () => {
  for (const game of [
    recovering({ storageBlocked: true }),
    recovering({ upgradeRequired: true }),
    recovering({ connectionFailed: true }),
    recovering({ recoveryIssue: "invalid_response" }),
    recovering({ pendingComputerSaveStartedAt: 1 }),
    recovering({ inHistoryMode: true }),
    recovering({ recovering: false, syncStatus: "idle", confirmationOverdue: false }),
    recovering({ sharedMutationsBlocked: false, gameplayMutationsBlocked: true }),
  ]) {
    const result = mutationSurfacePresentation(game, { foregroundWaitMs: 60_000 });
    assert.equal(result.unavailable, true);
    assert.equal(result.pulsing, false);
  }
  assert.equal(mutationSurfacePresentation(recovering(), { foregroundWaitMs: 0 }).pulsing, false);
});

test("a safe renewal that leaves human play admitted does not decorate the Board", () => {
  assert.deepEqual(mutationSurfacePresentation(recovering({ gameplayMutationsBlocked: false }), { foregroundWaitMs: 9_000 }), {
    unavailable: false, pulsing: false, phaseMs: 0, episodeId: null,
  });
});
