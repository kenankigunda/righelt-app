export const MAX_HISTORY = 200;

export type DisplayNumberedHistoryEntry = {
  undone?: boolean;
  displayMoveNumber?: number;
};

/** Continue the stable user-visible sequence independently of durable indexes. */
export const getNextDisplayMoveNumber = (moves: readonly DisplayNumberedHistoryEntry[]) => {
  const activeMoves = moves.filter((move) => move.undone !== true);
  const latestActiveMove = activeMoves.at(-1);
  return typeof latestActiveMove?.displayMoveNumber === "number" && Number.isFinite(latestActiveMove.displayMoveNumber)
    ? latestActiveMove.displayMoveNumber + 1
    : activeMoves.length + 1;
};
