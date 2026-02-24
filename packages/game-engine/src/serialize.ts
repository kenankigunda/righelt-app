import type { GameState } from "./types";
import { normalizeState } from "./deterministic";

function stableSortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, nestedValue]) => [key, stableSortObject(nestedValue)]));
  }

  return value;
}

function assertDeserializedStateShape(value: unknown): asserts value is GameState {
  if (value === null || typeof value !== "object") {
    throw new Error("Serialized engine state is not an object");
  }

  const state = value as Partial<GameState>;
  if (!Array.isArray(state.pieces)) {
    throw new Error("Serialized engine state is missing pieces array");
  }
  if (!state.outcome || typeof state.outcome.status !== "string") {
    throw new Error("Serialized engine state is missing outcome");
  }
  if (!("sideToMove" in state)) {
    throw new Error("Serialized engine state is missing sideToMove");
  }
}

export function serializeState(state: GameState): string {
  return JSON.stringify(stableSortObject(normalizeState(state)));
}

export function deserializeState(serialized: string): GameState {
  const parsed = JSON.parse(serialized) as unknown;
  assertDeserializedStateShape(parsed);
  return normalizeState(parsed);
}
