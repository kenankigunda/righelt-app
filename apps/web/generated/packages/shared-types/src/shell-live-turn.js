export const getNextSeat = (seat) => (seat === "Player 1" ? "Player 2" : "Player 1");

export const getSideForSeat = (seat) => (seat === "Player 1" ? "P1" : "P2");

// Retreat temporarily hands control to the defender; the attacker still owns the turn.
export const getTurnOwnerSideForState = (state) => {
  const continuation = state?.continuation;
  if (continuation?.type === "push") {
    if (continuation.attackerOwner === "P1" || continuation.attackerOwner === "P2") {
      return continuation.attackerOwner;
    }
    if (continuation.phase === "retreat") {
      return state.sideToMove === "P1" ? "P2" : "P1";
    }
  }
  return state.sideToMove;
};

export const getControlSeatForTurn = (state, turnOwnerSeat) => {
  const continuation = state?.continuation;
  if (!continuation) {
    return turnOwnerSeat;
  }
  if (continuation.type === "push" && continuation.phase === "retreat") {
    return getNextSeat(turnOwnerSeat);
  }
  return turnOwnerSeat;
};

export const clearTransientTurnFlags = (pieces) =>
  (Array.isArray(pieces) ? pieces : []).map((piece) => ({
    ...piece,
    shifted: false,
    pushed: false,
  }));

export const buildNextTurn = (activeTurn, endedAt) => {
  const nextSeat = getNextSeat(activeTurn.playerSeat);
  return {
    index: activeTurn.index + 1,
    startedAt: endedAt,
    endedAt: null,
    playerSeat: nextSeat,
    status: "active",
    moveIndexes: [],
    lastMoveAt: null,
  };
};

export const finalizeResolvedTurn = ({ state, activeTurn, endedAt, resolveToStability }) => {
  const nextTurn = buildNextTurn(activeTurn, endedAt);
  const nextState = resolveToStability(
    {
      ...state,
      sideToMove: getSideForSeat(nextTurn.playerSeat),
      turnIndex: nextTurn.index,
      continuation: null,
      pieces: clearTransientTurnFlags(state?.pieces),
    },
    { artifactMode: "full" },
  );
  return { nextState, nextTurn };
};
