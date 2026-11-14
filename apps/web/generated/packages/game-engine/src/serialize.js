import { canonicalTerminalDisplacement } from './terminal-displacement.js';
import { normalizeState } from "./deterministic.js";
function stableSortObject(value) {
    if (Array.isArray(value)) {
        return value.map(stableSortObject);
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
        return Object.fromEntries(entries.map(([key, nestedValue]) => [key, stableSortObject(nestedValue)]));
    }
    return value;
}
function assertDeserializedStateShape(value) {
    if (value === null || typeof value !== "object") {
        throw new Error("Serialized engine state is not an object");
    }
    const state = value;
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
export function serializeState(state) {
    const metadata = canonicalTerminalDisplacement(state);
    const normalized = normalizeState(state);
    if (metadata !== undefined)
        normalized.terminalDisplacement = metadata;
    return JSON.stringify(stableSortObject(normalized));
}
export function deserializeState(serialized) {
    const parsed = JSON.parse(serialized);
    assertDeserializedStateShape(parsed);
    const metadata = canonicalTerminalDisplacement(parsed);
    const normalized = normalizeState(parsed);
    if (metadata !== undefined)
        normalized.terminalDisplacement = metadata;
    return normalized;
}
