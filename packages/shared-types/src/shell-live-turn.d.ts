import type { RemovalCollector } from "../../game-engine/src/removals";
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

export function getTurnOwnerSideForState(state: Pick<GameState, "continuation" | "sideToMove">): GameState["sideToMove"];

export function getControlSeatForTurn(state: Pick<GameState, "continuation"> | null | undefined, turnOwnerSeat: PlayerSeat): PlayerSeat;

export function clearTransientTurnFlags(pieces: GameState["pieces"] | null | undefined): GameState["pieces"];

export function buildNextTurn(activeTurn: TurnLike, endedAt: string): TurnLike;

export function finalizeResolvedTurn(args: {
  state: GameState;
  activeTurn: TurnLike;
  endedAt: string;
  onRemoval?: RemovalCollector;
  resolveToStability: (state: GameState, options: { artifactMode: "full"; onRemoval?: RemovalCollector }) => GameState;
}): {
  nextState: GameState;
  nextTurn: TurnLike;
};
