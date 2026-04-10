const clone = (value) => (value == null ? value : structuredClone(value));

const normalizeParticipant = (participant) =>
  participant && typeof participant.identityId === "string"
    ? {
        identityId: participant.identityId,
        connected: participant.connected === true,
      }
    : null;

const normalizeComputerPlayer = (computerPlayer) =>
  computerPlayer && typeof computerPlayer.botId === "string" && computerPlayer.botId
    ? {
        mode: "computer-player",
        botId: computerPlayer.botId,
        botSchemaVersion:
          typeof computerPlayer.botSchemaVersion === "number" && Number.isFinite(computerPlayer.botSchemaVersion)
            ? computerPlayer.botSchemaVersion
            : 1,
        displayName: typeof computerPlayer.displayName === "string" ? computerPlayer.displayName : computerPlayer.botId,
        animal: typeof computerPlayer.animal === "string" ? computerPlayer.animal : "unknown",
        skillLabel: typeof computerPlayer.skillLabel === "string" ? computerPlayer.skillLabel : "Unknown",
        styleLabel: typeof computerPlayer.styleLabel === "string" ? computerPlayer.styleLabel : "Unknown",
        humanSeat: computerPlayer.humanSeat === "Player 1" || computerPlayer.humanSeat === "Player 2" ? computerPlayer.humanSeat : "Player 1",
        botSeat: computerPlayer.botSeat === "Player 1" || computerPlayer.botSeat === "Player 2" ? computerPlayer.botSeat : "Player 2",
        activeTurnKey: typeof computerPlayer.activeTurnKey === "string" ? computerPlayer.activeTurnKey : null,
      }
    : null;

export const normalizeStaticGameCard = (card) => ({
  id: String(card?.id || ""),
  createdAt: typeof card?.createdAt === "string" ? card.createdAt : "",
  lastMoveAt: typeof card?.lastMoveAt === "string" ? card.lastMoveAt : null,
  updatedAt: typeof card?.updatedAt === "string" ? card.updatedAt : "",
  moveCount:
    typeof card?.moveCount === "number" && Number.isFinite(card.moveCount)
      ? card.moveCount
      : Array.isArray(card?.moves)
        ? card.moves.length
        : 0,
  previewSnapshot: clone(card?.previewSnapshot ?? card?.currentSnapshot ?? card?.board?.state ?? null),
  previewSelection: clone(card?.previewSelection ?? null),
  myRole: typeof card?.myRole === "string" ? card.myRole : "Guest",
  canJoinAsPlayer: card?.canJoinAsPlayer === true,
  player1: normalizeParticipant(card?.player1),
  player2: normalizeParticipant(card?.player2),
  computerPlayer: normalizeComputerPlayer(card?.computerPlayer),
  syncStatus: typeof card?.syncStatus === "string" ? card.syncStatus : "ready",
});

export const buildStaticGameCardFromGame = (game) =>
  normalizeStaticGameCard({
    id: game?.id,
    createdAt: game?.createdAt,
    lastMoveAt: game?.lastMoveAt ?? null,
    updatedAt: game?.updatedAt,
    moveCount: Array.isArray(game?.moves) ? game.moves.length : 0,
    previewSnapshot: game?.liveCurrentSnapshot ?? game?.board?.state ?? game?.currentSnapshot ?? null,
    myRole: game?.myRole,
    canJoinAsPlayer: game?.canJoinAsPlayer === true,
    computerPlayer: normalizeComputerPlayer(game?.computerPlayer),
    player1: game?.player1 ?? null,
    player2: game?.player2 ?? null,
    syncStatus: game?.syncStatus,
  });

export const buildStaticGameCardFromScenario = (scenario) =>
  normalizeStaticGameCard({
    id: scenario?.id,
    createdAt: "",
    lastMoveAt: null,
    updatedAt: "",
    moveCount: Array.isArray(scenario?.moves) ? scenario.moves.length : 0,
    previewSnapshot: scenario?.resultingState ?? scenario?.initialState ?? null,
    previewSelection: scenario?.savedSelection ?? null,
    myRole: "Guest",
    canJoinAsPlayer: false,
    player1: null,
    player2: null,
    syncStatus: "ready",
  });
