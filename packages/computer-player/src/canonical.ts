import { deterministicStateHash, serializeState } from "../../game-engine/src/index";
import type { Action, GameState } from "../../shared-types/src/engine";
import type { CanonicalActionEncoding, CanonicalStateEncoding } from "./types";

function coordinateKey(value: { row: number; col: number } | undefined): string {
  if (!value) {
    return "-";
  }
  return `${value.row},${value.col}`;
}

export function canonicalizeState(state: GameState): CanonicalStateEncoding {
  return {
    version: "cp-state-v1",
    hash: deterministicStateHash(state),
    serialized: serializeState(state),
    sideToMove: state.sideToMove,
    turnIndex: state.turnIndex,
    outcome: state.outcome.status,
  };
}

export function canonicalizeAction(action: Action): CanonicalActionEncoding {
  const actorId = action.actorId ?? "-";
  const from = coordinateKey(action.from);
  const to = coordinateKey(action.to);
  const targetId = action.targetId ?? "-";
  return {
    version: "cp-action-v1",
    key: `${action.type}|${actorId}|${from}|${to}|${targetId}`,
  };
}

export function compareCanonicalActionKeys(left: Action, right: Action): number {
  return canonicalizeAction(left).key.localeCompare(canonicalizeAction(right).key);
}
