import { createInitialState } from "../../src/index.ts";

export function commander(id, owner, row, col, overrides = {}) {
  return {
    id,
    owner,
    kind: "commander",
    position: { row, col },
    supplied: true,
    commanded: true,
    ...overrides,
  };
}

export function unit(id, owner, row, col, overrides = {}) {
  return {
    id,
    owner,
    kind: "unit",
    position: { row, col },
    supplied: true,
    commanded: true,
    ...overrides,
  };
}

export function makeState({
  sideToMove = "P1",
  pieces = [],
  continuation = null,
  outcome = { status: "ongoing" },
  turnIndex = 0,
} = {}) {
  const base = createInitialState();
  return {
    ...base,
    sideToMove,
    pieces,
    continuation,
    outcome,
    turnIndex,
  };
}
