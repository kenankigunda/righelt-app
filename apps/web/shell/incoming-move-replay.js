import { buildRecordedMovePresentation } from "./history-preview.js";

export const INCOMING_MOVE_REPLAY_TIMING = Object.freeze({
  focusedDelayMs: 180,
  refocusDelayMs: 350,
  previewHoldMs: 320,
  settleHoldMs: 220,
  gapMs: 150,
});

const REPLAY_PHASE = Object.freeze({
  LEAD_IN: "lead-in",
  PREVIEW: "preview",
  SETTLE: "settle",
});

const PLAYER_SEAT_BY_SIDE = Object.freeze({
  P1: "Player 1",
  P2: "Player 2",
});

const cloneValue = (value) => (value == null ? value : structuredClone(value));

const emptyRecordedMovePresentation = () => ({
  recordedAction: null,
  recordedActionStartPiece: null,
  destroyedPieces: [],
});

const getMoveReplayKey = (move) =>
  JSON.stringify({
    actorSide: move?.actorSide ?? null,
    notation: typeof move?.notation === "string" ? move.notation : "",
    action: move?.action ?? null,
    selectionSnapshot: move?.selectionSnapshot ?? null,
    snapshot: move?.snapshot ?? null,
    destroyedPieces: move?.destroyedPieces ?? [],
  });

const getGameMoveReplayKeys = (game) => (Array.isArray(game?.moves) ? game.moves.map((move) => getMoveReplayKey(move)) : []);

const findFirstDivergenceIndex = (previousKeys, nextKeys) => {
  const previous = Array.isArray(previousKeys) ? previousKeys : [];
  const next = Array.isArray(nextKeys) ? nextKeys : [];
  const sharedLength = Math.min(previous.length, next.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (previous[index] !== next[index]) {
      return index;
    }
  }
  if (previous.length === next.length) {
    return -1;
  }
  return sharedLength;
};

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

const moveUsesVisibleSettle = (move) => move?.action?.type !== "project";

const getReplayFrameSnapshot = (move, phase) => {
  if (!move?.selectionSnapshot) {
    return null;
  }
  if (phase === REPLAY_PHASE.SETTLE) {
    return move.snapshot ?? move.selectionSnapshot;
  }
  if (phase === REPLAY_PHASE.PREVIEW && move.action?.type === "project") {
    return move.snapshot ?? move.selectionSnapshot;
  }
  return move.selectionSnapshot;
};

const buildReplayFrame = ({
  sequenceId,
  game,
  moveIndex,
  phase = REPLAY_PHASE.PREVIEW,
  stepIndex = 0,
  totalSteps = 1,
  timing,
  animated = true,
} = {}) => {
  const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
  if (!game?.id || !move?.selectionSnapshot || !move?.action) {
    return null;
  }
  const isPreviewPhase = phase === REPLAY_PHASE.PREVIEW;
  const replaySnapshot = getReplayFrameSnapshot(move, phase);
  const recordedMovePresentation = isPreviewPhase
    ? buildRecordedMovePresentation({
        action: move.action,
        preActionSnapshot: move.selectionSnapshot,
      })
    : phase === REPLAY_PHASE.SETTLE
      ? buildRecordedMovePresentation({
          preActionSnapshot: move.selectionSnapshot,
          destroyedPieceRecords: move.destroyedPieces ?? [],
        })
      : emptyRecordedMovePresentation();
  return {
    kind: "incoming-move",
    sequenceId,
    gameId: game.id,
    moveIndex,
    stepIndex,
    totalSteps,
    phase,
    actorSeat: getSeatForActorSide(move.actorSide),
    actorSide: move.actorSide ?? null,
    notation: typeof move.notation === "string" ? move.notation : "",
    overlayMode: isPreviewPhase ? "recorded-action" : "interactive",
    interactionLocked: true,
    showsReplayChrome: isPreviewPhase,
    animated: isPreviewPhase ? animated : false,
    durationMs:
      phase === REPLAY_PHASE.PREVIEW
        ? timing.previewHoldMs
        : phase === REPLAY_PHASE.SETTLE
          ? timing.settleHoldMs
          : 0,
    snapshot: cloneValue(replaySnapshot),
    recordedMovePresentation,
    moveKey: getMoveReplayKey(move),
  };
};

const buildReplayFramesForMove = ({ sequenceId, game, moveIndex, stepIndex, totalSteps, timing, animated }) => {
  const previewFrame = buildReplayFrame({
    sequenceId,
    game,
    moveIndex,
    phase: REPLAY_PHASE.PREVIEW,
    stepIndex,
    totalSteps,
    timing,
    animated,
  });
  if (!previewFrame) {
    return [];
  }
  const leadInFrame = buildReplayFrame({
    sequenceId,
    game,
    moveIndex,
    phase: REPLAY_PHASE.LEAD_IN,
    stepIndex,
    totalSteps,
    timing,
    animated: false,
  });
  const frames = leadInFrame ? [leadInFrame, previewFrame] : [previewFrame];
  const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
  if (!moveUsesVisibleSettle(move)) {
    return frames;
  }
  const settleFrame = buildReplayFrame({
    sequenceId,
    game,
    moveIndex,
    phase: REPLAY_PHASE.SETTLE,
    stepIndex,
    totalSteps,
    timing,
    animated: false,
  });
  if (settleFrame) {
    frames.push(settleFrame);
  }
  return frames;
};

const buildReplaySequence = ({ sequenceId, game, moveIndexes, timing, animated = true }) => {
  const indexes = Array.isArray(moveIndexes) ? moveIndexes : [];
  const totalSteps = indexes.length;
  const frames = [];
  const moveKeys = [];
  indexes.forEach((moveIndex, stepIndex) => {
    const move = Array.isArray(game?.moves) ? game.moves[moveIndex] : null;
    if (!move?.selectionSnapshot || !move?.action) {
      return;
    }
    moveKeys.push(getMoveReplayKey(move));
    frames.push(
      ...buildReplayFramesForMove({
        sequenceId,
        game,
        moveIndex,
        stepIndex,
        totalSteps,
        timing,
        animated,
      }),
    );
  });
  if (frames.length === 0) {
    return null;
  }
  return {
    sequenceId,
    gameId: game.id,
    moveIndexes: [...indexes],
    moveKeys,
    frames,
    currentFrameIndex: 0,
    currentFrame: frames[0],
    finalLandingSnapshot: cloneValue(game.currentSnapshot ?? null),
    status: "running",
  };
};

export const buildIncomingMoveReplayStep = ({
  game,
  moveIndex,
  phase = REPLAY_PHASE.PREVIEW,
  stepIndex = 0,
  totalSteps = 1,
  animated = true,
  timing = INCOMING_MOVE_REPLAY_TIMING,
} = {}) =>
  buildReplayFrame({
    sequenceId: "test-sequence",
    game,
    moveIndex,
    phase,
    stepIndex,
    totalSteps,
    timing,
    animated,
  });

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
  const seenMoveKeysByGameId = new Map();
  let routeGameId = null;
  let replayEnabled = false;
  let queuedMoveIndexes = [];
  let activeSequence = null;
  let phaseTimer = null;
  let needsResumeDelay = false;
  let sequenceCounter = 0;

  const emit = () => {
    onStateChanged();
  };

  const isBrowserReady = () => isDocumentVisible() && isWindowFocused();

  const clearPhaseTimer = () => {
    if (!phaseTimer) {
      return;
    }
    clearTimeoutFn(phaseTimer);
    phaseTimer = null;
  };

  const clearReplay = ({ notify = true } = {}) => {
    clearPhaseTimer();
    activeSequence = null;
    queuedMoveIndexes = [];
    needsResumeDelay = false;
    if (notify) {
      emit();
    }
  };

  const getSequenceFrame = () => activeSequence?.frames?.[activeSequence.currentFrameIndex] ?? null;

  const setCurrentFrameIndex = (nextIndex) => {
    if (!activeSequence) {
      return null;
    }
    activeSequence.currentFrameIndex = nextIndex;
    activeSequence.currentFrame = activeSequence.frames[nextIndex] ?? null;
    return activeSequence.currentFrame;
  };

  const schedule = (delayMs, fn) => {
    clearPhaseTimer();
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

  const cancelStaleReplayFromIndex = (moveIndex) => {
    const nextMoveIndex = Number.isInteger(moveIndex) ? moveIndex : 0;
    const activeTouchesStaleMove =
      activeSequence?.moveIndexes?.some((candidateMoveIndex) => candidateMoveIndex >= nextMoveIndex) === true;
    if (!activeTouchesStaleMove) {
      queuedMoveIndexes = queuedMoveIndexes.filter((candidateMoveIndex) => candidateMoveIndex < nextMoveIndex);
      return false;
    }
    clearPhaseTimer();
    activeSequence = null;
    queuedMoveIndexes = queuedMoveIndexes.filter((candidateMoveIndex) => candidateMoveIndex < nextMoveIndex);
    needsResumeDelay = false;
    emit();
    return true;
  };

  const finishCurrentSequence = () => {
    if (!activeSequence) {
      return;
    }
    if (queuedMoveIndexes.length === 0) {
      activeSequence = null;
      needsResumeDelay = false;
      emit();
      return;
    }
    const latestGame = getGame?.(routeGameId) ?? null;
    if (!latestGame) {
      activeSequence = null;
      queuedMoveIndexes = [];
      needsResumeDelay = false;
      emit();
      return;
    }
    const nextSequence = buildReplaySequence({
      sequenceId: `${latestGame.id}:${sequenceCounter + 1}`,
      game: latestGame,
      moveIndexes: [...queuedMoveIndexes],
      timing,
      animated: !prefersReducedMotion(),
    });
    queuedMoveIndexes = [];
    if (!nextSequence) {
      activeSequence = null;
      needsResumeDelay = false;
      emit();
      return;
    }
    sequenceCounter += 1;
    schedule(timing.gapMs, () => {
      activeSequence = nextSequence;
      emit();
      scheduleActiveFrame();
    });
  };

  const advanceSequence = () => {
    if (!activeSequence) {
      return;
    }
    const nextIndex = activeSequence.currentFrameIndex + 1;
    if (nextIndex >= activeSequence.frames.length) {
      finishCurrentSequence();
      return;
    }
    setCurrentFrameIndex(nextIndex);
    emit();
    scheduleActiveFrame();
  };

  function scheduleActiveFrame() {
    const currentFrame = getSequenceFrame();
    if (!currentFrame) {
      finishCurrentSequence();
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    if (currentFrame.phase === REPLAY_PHASE.LEAD_IN) {
      const leadInDelayMs = needsResumeDelay ? timing.refocusDelayMs : timing.focusedDelayMs;
      needsResumeDelay = false;
      schedule(leadInDelayMs, advanceSequence);
      return;
    }
    needsResumeDelay = false;
    schedule(currentFrame.durationMs, advanceSequence);
  }

  const startNextSequence = ({ useResumeDelay = false } = {}) => {
    if (!routeGameId || !replayEnabled || queuedMoveIndexes.length === 0) {
      return;
    }
    const game = getGame?.(routeGameId) ?? null;
    if (!game) {
      clearReplay();
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    const nextSequence = buildReplaySequence({
      sequenceId: `${game.id}:${sequenceCounter + 1}`,
      game,
      moveIndexes: [...queuedMoveIndexes],
      timing,
      animated: !prefersReducedMotion(),
    });
    queuedMoveIndexes = [];
    if (!nextSequence) {
      needsResumeDelay = false;
      return;
    }
    sequenceCounter += 1;
    activeSequence = nextSequence;
    needsResumeDelay = useResumeDelay;
    emit();
    scheduleActiveFrame();
  };

  const maybeResume = () => {
    if (!routeGameId || !replayEnabled) {
      return;
    }
    if (!isBrowserReady()) {
      needsResumeDelay = true;
      return;
    }
    if (phaseTimer) {
      return;
    }
    if (activeSequence) {
      scheduleActiveFrame();
      return;
    }
    startNextSequence({ useResumeDelay: needsResumeDelay });
  };

  const resetRouteScopedReplay = ({ keepSeenCounts = true, notify = true } = {}) => {
    clearPhaseTimer();
    activeSequence = null;
    queuedMoveIndexes = [];
    needsResumeDelay = false;
    sequenceCounter = 0;
    if (!keepSeenCounts) {
      seenMoveKeysByGameId.clear();
    }
    if (notify) {
      emit();
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
        clearPhaseTimer();
        needsResumeDelay = Boolean(activeSequence || queuedMoveIndexes.length > 0);
        return;
      }
      maybeResume();
    },
    primeGame(game) {
      if (!game?.id) {
        return;
      }
      const nextMoveKeys = getGameMoveReplayKeys(game);
      const knownMoveKeys = seenMoveKeysByGameId.get(game.id);
      if (!Array.isArray(knownMoveKeys) || nextMoveKeys.length < knownMoveKeys.length) {
        seenMoveKeysByGameId.set(game.id, nextMoveKeys);
      }
    },
    observeAuthoritativeGame(game) {
      if (!game?.id) {
        return [];
      }
      const nextMoveKeys = getGameMoveReplayKeys(game);
      const previousMoveKeys = seenMoveKeysByGameId.get(game.id);
      if (!Array.isArray(previousMoveKeys)) {
        seenMoveKeysByGameId.set(game.id, nextMoveKeys);
        return [];
      }

      const firstDivergenceIndex = findFirstDivergenceIndex(previousMoveKeys, nextMoveKeys);
      if (firstDivergenceIndex === -1) {
        seenMoveKeysByGameId.set(game.id, nextMoveKeys);
        return [];
      }

      const replayStartIndex =
        firstDivergenceIndex < previousMoveKeys.length ? firstDivergenceIndex : previousMoveKeys.length;
      seenMoveKeysByGameId.set(game.id, nextMoveKeys);

      const replayableMoveIndexes = [];
      for (let index = replayStartIndex; index < nextMoveKeys.length; index += 1) {
        if (game.id === routeGameId && isIncomingMoveReplayEligible({ game, move: game.moves[index] })) {
          replayableMoveIndexes.push(index);
        }
      }

      if (game.id !== routeGameId) {
        return replayableMoveIndexes;
      }

      if (firstDivergenceIndex < previousMoveKeys.length) {
        cancelStaleReplayFromIndex(firstDivergenceIndex);
      }

      if (replayableMoveIndexes.length === 0) {
        return [];
      }

      const dedupedQueuedIndexes = new Set(queuedMoveIndexes);
      replayableMoveIndexes.forEach((moveIndex) => dedupedQueuedIndexes.add(moveIndex));
      queuedMoveIndexes = [...dedupedQueuedIndexes].sort((left, right) => left - right);

      if (!activeSequence && isBrowserReady()) {
        startNextSequence({ useResumeDelay: needsResumeDelay });
      } else {
        maybeResume();
      }
      return replayableMoveIndexes;
    },
    setDocumentVisible(visible) {
      if (visible === false) {
        clearPhaseTimer();
        needsResumeDelay = Boolean(activeSequence || queuedMoveIndexes.length > 0);
        return;
      }
      maybeResume();
    },
    setWindowFocused(focused) {
      if (focused === false) {
        clearPhaseTimer();
        needsResumeDelay = Boolean(activeSequence || queuedMoveIndexes.length > 0);
        return;
      }
      maybeResume();
    },
    getActiveReplay(gameId) {
      const currentFrame = getSequenceFrame();
      if (!currentFrame || currentFrame.gameId !== gameId) {
        return null;
      }
      return cloneValue(currentFrame);
    },
    getReplaySequence(gameId) {
      if (!activeSequence || activeSequence.gameId !== gameId) {
        return null;
      }
      return cloneValue(activeSequence);
    },
    getReplayState(gameId) {
      return this.getActiveReplay(gameId);
    },
    isReplayActiveForGame(gameId) {
      return Boolean(activeSequence?.gameId === gameId);
    },
    getQueuedMoveIndexes(gameId) {
      if (!gameId || gameId !== routeGameId) {
        return [];
      }
      return [...queuedMoveIndexes];
    },
    destroy() {
      clearPhaseTimer();
      activeSequence = null;
      queuedMoveIndexes = [];
      routeGameId = null;
      replayEnabled = false;
      needsResumeDelay = false;
      sequenceCounter = 0;
    },
  };
};
