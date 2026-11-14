import test from "node:test";
import assert from "node:assert/strict";

import { mutationSurfacePresentation, normalizeMutationSurface } from "../board/surface-pulse.js";

const recovering = (overrides = {}) => ({
  sharedMutationsBlocked: true,
  gameplayMutationsBlocked: true,
  recovering: true,
  syncStatus: "confirming",
  recoveryEpisodeId: "episode-7",
  ...overrides,
});

test("surface pulse observes the existing four-second foreground grace and incident onset", () => {
  assert.deepEqual(mutationSurfacePresentation(recovering(), { foregroundWaitMs: 3_999 }), {
    unavailable: true, pulsing: false, episodeId: null,
  });
  assert.deepEqual(mutationSurfacePresentation(recovering(), { foregroundWaitMs: 4_000 }), {
    unavailable: true, pulsing: true, episodeId: "episode-7",
  });
  assert.deepEqual(mutationSurfacePresentation(recovering(), { foregroundWaitMs: Number.MAX_SAFE_INTEGER }), {
    unavailable: true, pulsing: true, episodeId: "episode-7",
  });
  for (const foregroundWaitMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(mutationSurfacePresentation(recovering(), { foregroundWaitMs }).pulsing, false);
  }
});

test("surface normalization exposes no JavaScript phase or duration contract", () => {
  const normalized = normalizeMutationSurface({ pulsing: true, phaseMs: Number.MAX_VALUE, episodeId: "episode-7" }, true);
  assert.deepEqual(normalized, { unavailable: true, pulsing: true, episodeId: "episode-7" });
  assert.equal(Object.hasOwn(normalized, "phaseMs"), false);
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
    unavailable: false, pulsing: false, episodeId: null,
  });
});
