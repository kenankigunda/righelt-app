import { getControlSeatForTurn } from "../generated/packages/shared-types/src/shell-live-turn.js";

export const PERSONAL_OPPONENTS = Object.freeze([
  { id: "babs", name: "Babs", detail: "Easy · Curious and eager" },
  { id: "tau", name: "Tau", detail: "Medium · Patient and thoughtful" },
  { id: "horus", name: "Horus", detail: "Hard · Precise and confident" },
  { id: "friend", name: "Friend", detail: "Invite someone to play" },
]);
export const PERSONAL_OPPONENT_IDS = Object.freeze([...PERSONAL_OPPONENTS.map((opponent) => opponent.id), "self"]);
export const isPersonalSide = (side) => side === "p1" || side === "p2";
export const isComputerOpponent = (opponent) => ["babs", "tau", "horus"].includes(opponent);
export const isUnfinishedGame = (game) => (game?.previewSnapshot ?? game?.board?.state)?.outcome?.status === "ongoing";
export const isAwaitingPlayer = (game, identityId) => {
  const state = game?.previewSnapshot ?? game?.board?.state;
  if (!state || !isUnfinishedGame(game) || !identityId) return false;
  const seat = getControlSeatForTurn(state, state.sideToMove === "P2" ? "Player 2" : "Player 1");
  return (seat === "Player 2" ? game.player2 : game.player1)?.identityId === identityId;
};
export const compareResumeGames = (identityId) => (a, b) =>
  Number(isAwaitingPlayer(b, identityId)) - Number(isAwaitingPlayer(a, identityId)) ||
  String(b.lastMoveAt || b.updatedAt || b.createdAt || "").localeCompare(String(a.lastMoveAt || a.updatedAt || a.createdAt || "")) ||
  String(a.id).localeCompare(String(b.id));
export const selectResumeGames = (games, identityId) => games.filter(isUnfinishedGame).sort(compareResumeGames(identityId));

// Until T-107 supplies a production adapter, the UI must report unavailable.
// This seam cannot fall back to the old search-only computer player.
export const getComputerReadiness = () => ({ state: "unavailable", message: "Computer play is being prepared. Choose Friend or self-play for now." });
