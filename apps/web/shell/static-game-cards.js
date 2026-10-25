import { COMPUTER_PROFILES, isComputerProfile } from '../generated/packages/shared-types/src/computer-play.js';
const clone = (value) => (value == null ? value : structuredClone(value));

// Card identity survives temporary manual control. It conveys no turn authority.
export const computerProfileForCard = (game, side) => {
  const person = game?.[side === 'p1' ? 'player1' : 'player2'];
  const seats = game?.computer?.seats;
  if (seats && Object.hasOwn(seats, side)) return isComputerProfile(seats[side]) ? seats[side] : null;
  return isComputerProfile(person?.computerProfile) ? person.computerProfile : null;
};

const normalizeParticipant = (participant) =>
  participant && typeof participant.identityId === "string"
    ? {
        identityId: participant.identityId,
        connected: participant.connected === true,
        computerProfile: isComputerProfile(participant.computerProfile) ? participant.computerProfile : null,
        ...(participant.profile ? { profile: clone(participant.profile) } : {}),
      }
    : null;

export const computerOpponentLabel = game => {
  const first = COMPUTER_PROFILES[computerProfileForCard(game, 'p1')]?.name;
  const second = COMPUTER_PROFILES[computerProfileForCard(game, 'p2')]?.name;
  if (first && second) return `${first} vs ${second}`;
  const name = first || second;
  if (!name) return null;
  return game.myRole === 'Player 1' || game.myRole === 'Player 2' ? `You vs ${name}` : `${name} · Computer`;
};

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
  player1: normalizeParticipant(card?.player1 ? {...card.player1, computerProfile:computerProfileForCard(card, 'p1')} : null),
  player2: normalizeParticipant(card?.player2 ? {...card.player2, computerProfile:computerProfileForCard(card, 'p2')} : null),
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
    player1: game?.player1 ?? null,
    player2: game?.player2 ?? null,
    computer: game?.computer,
    syncStatus: game?.sharedMutationsBlocked ? "confirming" : game?.syncStatus,
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
