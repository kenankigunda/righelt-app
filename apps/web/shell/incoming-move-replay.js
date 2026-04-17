import { buildDestroyedPieceOverlays, findRecordedActionStartPiece } from "./history-preview.js";

export const INCOMING_MOVE_REPLAY_TIMING = Object.freeze({
  focusedDelayMs: 180,
  refocusDelayMs: 350,
  holdMs: 900,
  gapMs: 150,
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
  stepIndex = 0,
  totalSteps = 1,
  animated = true,
} = {}) => {
  const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
  if (!game?.id || !move?.selectionSnapshot || !move?.action) {
    return null;
  }
  return {
    kind: "incoming-move",
    gameId: game.id,
    moveIndex,
    stepIndex,
    totalSteps,
    animated,
    actorSeat: getSeatForActorSide(move.actorSide),
    actorSide: move.actorSide ?? null,
    notation: typeof move.notation === "string" ? move.notation : "",
    snapshot: cloneValue(move.selectionSnapshot),
    recordedAction: cloneValue(move.action),
    recordedActionStartPiece: findRecordedActionStartPiece(move.selectionSnapshot, move.action),
    destroyedPieces: buildDestroyedPieceOverlays({
      destroyedPieceRecords: move.destroyedPieces ?? [],
      preActionSnapshot: move.selectionSnapshot,
    }),
  };
};

export const createIncomingMoveReplayController = ({
  getGame,
  onStateChanged = () => {},
  prefersReducedMotion = () => false,
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
  let activeStep = null;
  let delayedStartTimer = null;
  let holdTimer = null;
  let needsResumeDelay = false;
  let stepCounter = 0;

  const clearDelayedStartTimer = () => {
    if (!delayedStartTimer) {
      return;
    }
    clearTimeoutFn(delayedStartTimer);
    delayedStartTimer = null;
  };

  const clearHoldTimer = () => {
    if (!holdTimer) {
      return;
    }
    clearTimeoutFn(holdTimer);
    holdTimer = null;
  };

  const clearTimers = () => {
    clearDelayedStartTimer();
    clearHoldTimer();
  };

  const emit = () => {
    onStateChanged();
  };

  const isBrowserReady = () => browserVisible && browserFocused;

  const pauseReplay = ({ preserveResumeDelay = true } = {}) => {
    clearTimers();
    if (preserveResumeDelay && (activeStep || queuedMoveIndexes.length > 0)) {
      needsResumeDelay = true;
    }
  };

  const scheduleProgress = (delayMs) => {
    clearDelayedStartTimer();
    if (!routeGameId || !replayEnabled) {
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    delayedStartTimer = setTimeoutFn(() => {
      delayedStartTimer = null;
      if (!routeGameId || !replayEnabled) {
        return;
      }
      if (!isBrowserReady()) {
        needsResumeDelay = true;
        return;
      }
      if (activeStep) {
        clearHoldTimer();
        holdTimer = setTimeoutFn(() => {
          holdTimer = null;
          if (!isBrowserReady()) {
            needsResumeDelay = true;
            return;
          }
          activeStep = null;
          emit();
          if (queuedMoveIndexes.length > 0) {
            scheduleProgress(timing.gapMs);
            return;
          }
          needsResumeDelay = false;
          stepCounter = 0;
        }, timing.holdMs);
        return;
      }
      const game = getGame?.(routeGameId) ?? null;
      if (!game || !Array.isArray(game.moves)) {
        queuedMoveIndexes = [];
        needsResumeDelay = false;
        stepCounter = 0;
        return;
      }
      while (queuedMoveIndexes.length > 0) {
        const moveIndex = queuedMoveIndexes.shift();
        const step = buildIncomingMoveReplayStep({
          game,
          moveIndex,
          stepIndex: stepCounter,
          totalSteps: stepCounter + queuedMoveIndexes.length + 1,
          animated: !prefersReducedMotion(),
        });
        if (!step) {
          continue;
        }
        stepCounter += 1;
        activeStep = step;
        emit();
        scheduleProgress(0);
        return;
      }
      needsResumeDelay = false;
      stepCounter = 0;
    }, delayMs);
  };

  const maybeResume = () => {
    if (!routeGameId || !replayEnabled || (!activeStep && queuedMoveIndexes.length === 0)) {
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    if (delayedStartTimer || holdTimer) {
      return;
    }
    const delayMs = needsResumeDelay ? timing.refocusDelayMs : activeStep ? timing.gapMs : timing.focusedDelayMs;
    needsResumeDelay = false;
    scheduleProgress(delayMs);
  };

  const resetRouteScopedReplay = ({ keepSeenCounts = true, notify = true } = {}) => {
    clearTimers();
    queuedMoveIndexes = [];
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
      activeStep = null;
      clearHoldTimer();
      emit();
    }
    if (!activeStep && queuedMoveIndexes.length === 0) {
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
      maybeResume();
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
    isReplayActiveForGame(gameId) {
      return Boolean(activeStep && activeStep.gameId === gameId);
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
      activeStep = null;
      routeGameId = null;
      replayEnabled = false;
      needsResumeDelay = false;
      stepCounter = 0;
    },
  };
};
