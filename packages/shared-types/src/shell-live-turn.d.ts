import type { GameState } from "../../game-engine/src/types";

export type PlayerSeat = "Player 1" | "Player 2";

export type TurnLike = {
  index: number;
  startedAt: string;
  endedAt: string | null;
  playerSeat: PlayerSeat;
  status: "active" | "complete";
  moveIndexes: number[];
  lastMoveAt: string | null;
};

export function getNextSeat(seat: PlayerSeat): PlayerSeat;

export function getSideForSeat(seat: PlayerSeat): GameState["sideToMove"];

export function getControlSeatForTurn(state: Pick<GameState, "continuation"> | null | undefined, turnOwnerSeat: PlayerSeat): PlayerSeat;

export function clearTransientTurnFlags(pieces: GameState["pieces"] | null | undefined): GameState["pieces"];

export function buildNextTurn(activeTurn: TurnLike, endedAt: string): TurnLike;

export function finalizeResolvedTurn(args: {
  state: GameState;
  activeTurn: TurnLike;
  endedAt: string;
  resolveToStability: (state: GameState, options: { artifactMode: "full" }) => GameState;
}): {
  nextState: GameState;
  nextTurn: TurnLike;
};
