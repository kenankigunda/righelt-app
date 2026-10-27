/** Retreat semantics are provenance, not a board-state or model-shape change. */
export const LEGACY_RETREAT_SEMANTICS = "geometric-retreat-v1" as const;
export const CURRENT_RETREAT_SEMANTICS = "completion-preserving-retreat-v2" as const;
export type RetreatSemantics = typeof LEGACY_RETREAT_SEMANTICS | typeof CURRENT_RETREAT_SEMANTICS;
export type RetreatRuleOptions = { retreatSemantics?: RetreatSemantics };

export function liveRetreatSemantics(options?: RetreatRuleOptions): RetreatSemantics {
  const value = options?.retreatSemantics === undefined ? CURRENT_RETREAT_SEMANTICS : options.retreatSemantics;
  if (value !== CURRENT_RETREAT_SEMANTICS && value !== LEGACY_RETREAT_SEMANTICS) throw new Error("Unknown retreat semantics");
  return value;
}

/** Only retained replay/import adapters may interpret missing historical provenance. */
export function archivedRetreatSemantics(value: unknown): RetreatSemantics {
  if (value === undefined) return LEGACY_RETREAT_SEMANTICS;
  if (value !== CURRENT_RETREAT_SEMANTICS && value !== LEGACY_RETREAT_SEMANTICS) throw new Error("Unknown archived retreat semantics");
  return value;
}
