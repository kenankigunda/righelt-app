import { buildDestroyedPieceOverlays, findRecordedActionStartPiece } from "./history-preview.js";

export const INCOMING_MOVE_REPLAY_TIMING = Object.freeze({
  focusedDelayMs: 180,
  refocusDelayMs: 350,
  previewHoldMs: 450,
  settleHoldMs: 450,
  gapMs: 150,
});

const REPLAY_PHASE = Object.freeze({
  ARMED: "armed",
  BASELINE: "baseline",
  PREVIEW: "preview",
  SETTLE: "settle",
});

const PLAYER_SEAT_BY_SIDE = Object.freeze({
  P1: "Player 1",
  P2: "Player 2",
});

const cloneValue = (value) => (value == null ? value : structuredClone(value));

export const getSeatForActorSide = (actorSide) => PLAYER_SEAT_BY_SIDE[actorSide] ?? null;

export const getControlledSeats = (game) => {
  if (Array.isArray(game?.myRoles)) {
    return game.myRoles.filter((role) => role === "Player 1" || role === "Player 2");
  }
  if (game?.myRole === "Player 1" || game?.myRole === "Player 2") {
    return [game.myRole];
  }
  return [];
};

export const isIncomingMoveReplayEligible = ({ game, move }) => {
  const actorSeat = getSeatForActorSide(move?.actorSide);
  if (!game || !actorSeat) {
    return false;
  }
  return !getControlledSeats(game).includes(actorSeat);
};

export const buildIncomingMoveReplayStep = ({
  game,
  moveIndex,
  phase = REPLAY_PHASE.PREVIEW,
  stepIndex = 0,
  totalSteps = 1,
  animated = true,
} = {}) => {
  const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
  if (!game?.id || !move?.selectionSnapshot || !move?.action) {
    return null;
  }
  const isPreviewPhase = phase === REPLAY_PHASE.PREVIEW;
  const isSettlePhase = phase === REPLAY_PHASE.SETTLE;
  const snapshotSource = isSettlePhase ? move.snapshot ?? move.selectionSnapshot : move.selectionSnapshot;
  return {
    kind: "incoming-move",
    phase,
    gameId: game.id,
    moveIndex,
    stepIndex,
    totalSteps,
    animated: isPreviewPhase ? animated : false,
    actorSeat: getSeatForActorSide(move.actorSide),
    actorSide: move.actorSide ?? null,
    notation: typeof move.notation === "string" ? move.notation : "",
    snapshot: cloneValue(snapshotSource),
    recordedAction: isPreviewPhase ? cloneValue(move.action) : null,
    recordedActionStartPiece: isPreviewPhase ? findRecordedActionStartPiece(move.selectionSnapshot, move.action) : null,
    destroyedPieces: isSettlePhase
      ? buildDestroyedPieceOverlays({
          destroyedPieceRecords: move.destroyedPieces ?? [],
          preActionSnapshot: move.selectionSnapshot,
        })
      : [],
  };
};

export const createIncomingMoveReplayController = ({
  getGame,
  onStateChanged = () => {},
  prefersReducedMotion = () => false,
  isBaselinePresentationSatisfied = () => false,
  setTimeoutFn = globalThis.setTimeout?.bind(globalThis) ?? setTimeout,
  clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis) ?? clearTimeout,
  isDocumentVisible = () =>
    typeof document === "undefined" ? true : !(document.hidden === true || document.visibilityState === "hidden"),
  isWindowFocused = () => (typeof document?.hasFocus === "function" ? document.hasFocus() : true),
  timing = INCOMING_MOVE_REPLAY_TIMING,
} = {}) => {
  const seenMoveCountByGameId = new Map();
  let routeGameId = null;
  let replayEnabled = false;
  let browserVisible = isDocumentVisible();
  let browserFocused = isWindowFocused();
  let queuedMoveIndexes = [];
  let armedStep = null;
  let activeStep = null;
  let phaseTimer = null;
  let needsResumeDelay = false;
  let stepCounter = 0;

  const clearPhaseTimer = () => {
    if (!phaseTimer) {
      return;
    }
    clearTimeoutFn(phaseTimer);
    phaseTimer = null;
  };

  const clearTimers = () => {
    clearPhaseTimer();
  };

  const emit = () => {
    onStateChanged();
  };

  const isBrowserReady = () => browserVisible && browserFocused;

  const pauseReplay = ({ preserveResumeDelay = true } = {}) => {
    clearTimers();
    if (preserveResumeDelay && (armedStep || activeStep || queuedMoveIndexes.length > 0)) {
      needsResumeDelay = true;
    }
  };

  const buildReplayMetadata = ({ game, moveIndex, phase, stepIndex = 0, totalSteps = 1 }) => {
    const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
    if (!game?.id || !move?.selectionSnapshot || !move?.action) {
      return null;
    }
    return {
      kind: "incoming-move",
      phase,
      gameId: game.id,
      moveIndex,
      stepIndex,
      totalSteps,
      actorSeat: getSeatForActorSide(move.actorSide),
      actorSide: move.actorSide ?? null,
      notation: typeof move.notation === "string" ? move.notation : "",
      snapshot: cloneValue(move.selectionSnapshot),
    };
  };

  const armReplay = ({ game, moveIndex, stepIndex = 0, totalSteps = 1 }) => {
    const step = buildReplayMetadata({
      game,
      moveIndex,
      phase: REPLAY_PHASE.ARMED,
      stepIndex,
      totalSteps,
    });
    if (!step) {
      return null;
    }
    armedStep = step;
    return step;
  };

  const clearArmedReplay = () => {
    armedStep = null;
  };

  const activateStep = ({ game, moveIndex, phase, stepIndex = 0, totalSteps = 1 }) => {
    const step = buildIncomingMoveReplayStep({
      game,
      moveIndex,
      phase,
      stepIndex,
      totalSteps,
      animated: !prefersReducedMotion(),
    });
    if (!step) {
      return null;
    }
    activeStep = step;
    emit();
    return step;
  };

  const clearActiveReplay = () => {
    activeStep = null;
    emit();
  };

  const scheduleNextPhase = (delayMs, fn) => {
    clearPhaseTimer();
    if (!routeGameId || !replayEnabled) {
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    phaseTimer = setTimeoutFn(() => {
      phaseTimer = null;
      if (!routeGameId || !replayEnabled) {
        return;
      }
      if (!isBrowserReady()) {
        needsResumeDelay = true;
        return;
      }
      fn();
    }, delayMs);
  };

  const finishReplayMove = () => {
    if (queuedMoveIndexes.length > 0) {
      scheduleNextPhase(timing.gapMs, () => {
        clearActiveReplay();
        startNextQueuedReplay();
      });
      return;
    }
    clearActiveReplay();
    needsResumeDelay = false;
    stepCounter = 0;
  };

  const scheduleSettlePhase = (moveIndex) => {
    const sequence = activeStep ?? armedStep;
    scheduleNextPhase(timing.previewHoldMs, () => {
      const settleGame = getGame?.(routeGameId) ?? null;
      if (!settleGame) {
        clearActiveReplay();
        return;
      }
      const settle = activateStep({
        game: settleGame,
        moveIndex,
        phase: REPLAY_PHASE.SETTLE,
        stepIndex: sequence?.stepIndex ?? 0,
        totalSteps: sequence?.totalSteps ?? 1,
      });
      if (!settle) {
        clearActiveReplay();
        startNextQueuedReplay();
        return;
      }
      scheduleNextPhase(timing.settleHoldMs, finishReplayMove);
    });
  };

  const schedulePreviewPhase = (moveIndex, delayMs) => {
    const sequence = armedStep ?? activeStep;
    scheduleNextPhase(delayMs, () => {
      clearArmedReplay();
      const latestGame = getGame?.(routeGameId) ?? null;
      if (!latestGame) {
        clearActiveReplay();
        return;
      }
      const preview = activateStep({
        game: latestGame,
        moveIndex,
        phase: REPLAY_PHASE.PREVIEW,
        stepIndex: sequence?.stepIndex ?? 0,
        totalSteps: sequence?.totalSteps ?? 1,
      });
      if (!preview) {
        clearActiveReplay();
        startNextQueuedReplay();
        return;
      }
      scheduleSettlePhase(moveIndex);
    });
  };

  const startVisibleBaselineReplay = ({ game, moveIndex, delayMs, stepIndex = 0, totalSteps = 1 }) => {
    const baseline = activateStep({
      game,
      moveIndex,
      phase: REPLAY_PHASE.BASELINE,
      stepIndex,
      totalSteps,
    });
    if (!baseline) {
      return false;
    }
    schedulePreviewPhase(moveIndex, delayMs);
    return true;
  };

  const startNextQueuedReplay = ({ useResumeDelay = false } = {}) => {
    const game = getGame?.(routeGameId) ?? null;
    if (!game || !Array.isArray(game.moves)) {
      queuedMoveIndexes = [];
      needsResumeDelay = false;
      stepCounter = 0;
      clearArmedReplay();
      return;
    }
    while (queuedMoveIndexes.length > 0) {
      const moveIndex = queuedMoveIndexes.shift();
      const move = game.moves[moveIndex] ?? null;
      const stepIndex = stepCounter;
      const totalSteps = stepIndex + queuedMoveIndexes.length + 1;
      const shouldHideBaseline =
        !useResumeDelay &&
        isBrowserReady() &&
        Boolean(move?.selectionSnapshot) &&
        isBaselinePresentationSatisfied({
          gameId: game.id,
          moveIndex,
          selectionSnapshot: move.selectionSnapshot,
        });
      if (shouldHideBaseline) {
        const armed = armReplay({
          game,
          moveIndex,
          stepIndex,
          totalSteps,
        });
        if (!armed) {
          continue;
        }
        schedulePreviewPhase(moveIndex, timing.focusedDelayMs);
        stepCounter += 1;
        return;
      }
      const started = startVisibleBaselineReplay({
        game,
        moveIndex,
        delayMs: useResumeDelay ? timing.refocusDelayMs : timing.focusedDelayMs,
        stepIndex,
        totalSteps,
      });
      if (!started) {
        continue;
      }
      stepCounter += 1;
      return;
    }
    needsResumeDelay = false;
    stepCounter = 0;
  };

  const maybeResume = () => {
    if (!routeGameId || !replayEnabled || (!armedStep && !activeStep && queuedMoveIndexes.length === 0)) {
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    if (phaseTimer) {
      return;
    }
    if (!armedStep && !activeStep) {
      const useResumeDelay = needsResumeDelay;
      needsResumeDelay = false;
      startNextQueuedReplay({ useResumeDelay });
      return;
    }
    if (armedStep) {
      const latestGame = getGame?.(routeGameId) ?? null;
      if (!latestGame) {
        clearArmedReplay();
        return;
      }
      const armedMoveIndex = armedStep.moveIndex;
      const armedStepIndex = armedStep.stepIndex;
      const armedTotalSteps = armedStep.totalSteps;
      if (needsResumeDelay) {
        clearArmedReplay();
        needsResumeDelay = false;
        startVisibleBaselineReplay({
          game: latestGame,
          moveIndex: armedMoveIndex,
          delayMs: timing.refocusDelayMs,
          stepIndex: armedStepIndex,
          totalSteps: armedTotalSteps,
        });
        return;
      }
      schedulePreviewPhase(armedMoveIndex, timing.focusedDelayMs);
      return;
    }
    const delayMs = needsResumeDelay ? timing.refocusDelayMs : 0;
    needsResumeDelay = false;
    if (activeStep.phase === REPLAY_PHASE.BASELINE) {
      schedulePreviewPhase(activeStep.moveIndex, delayMs || timing.focusedDelayMs);
      return;
    }
    if (activeStep.phase === REPLAY_PHASE.PREVIEW) {
      scheduleSettlePhase(activeStep.moveIndex);
      return;
    }
    scheduleNextPhase(delayMs || timing.settleHoldMs, finishReplayMove);
  };

  const resetRouteScopedReplay = ({ keepSeenCounts = true, notify = true } = {}) => {
    clearTimers();
    queuedMoveIndexes = [];
    clearArmedReplay();
    activeStep = null;
    needsResumeDelay = false;
    stepCounter = 0;
    if (!keepSeenCounts) {
      seenMoveCountByGameId.clear();
    }
    if (notify) {
      emit();
    }
  };

  const clampSeenCount = (game) => {
    const moveCount = Array.isArray(game?.moves) ? game.moves.length : 0;
    const knownMoveCount = seenMoveCountByGameId.get(game?.id) ?? null;
    if (knownMoveCount === null) {
      seenMoveCountByGameId.set(game.id, moveCount);
      return;
    }
    if (moveCount >= knownMoveCount) {
      return;
    }
    seenMoveCountByGameId.set(game.id, moveCount);
    if (game.id !== routeGameId) {
      return;
    }
    const previousActiveMoveIndex = activeStep?.moveIndex ?? null;
    queuedMoveIndexes = queuedMoveIndexes.filter((moveIndex) => moveIndex < moveCount);
    if (previousActiveMoveIndex !== null && previousActiveMoveIndex >= moveCount) {
      clearActiveReplay();
      clearPhaseTimer();
    }
    const previousArmedMoveIndex = armedStep?.moveIndex ?? null;
    if (previousArmedMoveIndex !== null && previousArmedMoveIndex >= moveCount) {
      clearArmedReplay();
      clearPhaseTimer();
    }
    if (!armedStep && !activeStep && queuedMoveIndexes.length === 0) {
      stepCounter = 0;
      needsResumeDelay = false;
    }
  };

  return {
    setRouteState({ gameId = null, replayEnabled: nextReplayEnabled = false } = {}) {
      const nextGameId = typeof gameId === "string" && gameId ? gameId : null;
      const routeChanged = nextGameId !== routeGameId;
      routeGameId = nextGameId;
      replayEnabled = nextReplayEnabled === true && Boolean(routeGameId);
      if (routeChanged) {
        resetRouteScopedReplay({ notify: false });
      }
      if (!replayEnabled) {
        pauseReplay({ preserveResumeDelay: true });
        return;
      }
      maybeResume();
    },
    primeGame(game) {
      if (!game?.id) {
        return;
      }
      clampSeenCount(game);
    },
    observeAuthoritativeGame(game) {
      if (!game?.id) {
        return [];
      }
      clampSeenCount(game);
      const moveCount = Array.isArray(game.moves) ? game.moves.length : 0;
      const knownMoveCount = seenMoveCountByGameId.get(game.id);
      if (typeof knownMoveCount !== "number") {
        seenMoveCountByGameId.set(game.id, moveCount);
        return [];
      }
      if (moveCount <= knownMoveCount) {
        seenMoveCountByGameId.set(game.id, moveCount);
        return [];
      }
      const replayableMoveIndexes = [];
      for (let index = knownMoveCount; index < moveCount; index += 1) {
        if (game.id === routeGameId && isIncomingMoveReplayEligible({ game, move: game.moves[index] })) {
          replayableMoveIndexes.push(index);
        }
      }
      seenMoveCountByGameId.set(game.id, moveCount);
      if (game.id !== routeGameId || replayableMoveIndexes.length === 0) {
        return replayableMoveIndexes;
      }
      queuedMoveIndexes = [...queuedMoveIndexes, ...replayableMoveIndexes];
      if (!activeStep && isBrowserReady()) {
        const useResumeDelay = needsResumeDelay;
        needsResumeDelay = false;
        startNextQueuedReplay({ useResumeDelay });
      } else {
        maybeResume();
      }
      return replayableMoveIndexes;
    },
    setDocumentVisible(visible) {
      browserVisible = visible !== false;
      if (!browserVisible) {
        pauseReplay({ preserveResumeDelay: true });
        return;
      }
      maybeResume();
    },
    setWindowFocused(focused) {
      browserFocused = focused !== false;
      if (!browserFocused) {
        pauseReplay({ preserveResumeDelay: true });
        return;
      }
      maybeResume();
    },
    getActiveReplay(gameId) {
      if (!activeStep || activeStep.gameId !== gameId) {
        return null;
      }
      return cloneValue(activeStep);
    },
    getReplayState(gameId) {
      if (activeStep?.gameId === gameId) {
        return cloneValue(activeStep);
      }
      if (armedStep?.gameId === gameId) {
        return cloneValue(armedStep);
      }
      return null;
    },
    isReplayActiveForGame(gameId) {
      return Boolean(
        (activeStep && activeStep.gameId === gameId) ||
          (armedStep && armedStep.gameId === gameId),
      );
    },
    getQueuedMoveIndexes(gameId) {
      if (!gameId || gameId !== routeGameId) {
        return [];
      }
      return [...queuedMoveIndexes];
    },
    destroy() {
      clearTimers();
      queuedMoveIndexes = [];
      clearArmedReplay();
      activeStep = null;
      routeGameId = null;
      replayEnabled = false;
      needsResumeDelay = false;
      stepCounter = 0;
      queuedStartDelayMs = null;
    },
  };
};
