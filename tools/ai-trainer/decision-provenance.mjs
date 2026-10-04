import experimentConfig from '../../packages/computer-player/config/experiment-v1.json' with { type: 'json' };
// Search diagnostics are evidence, not a substitute for genuine policy targets.
export function validateDecisionProvenance(record) {
  const mask = record.policyMask ?? true;
  if (typeof mask !== 'boolean') throw new Error('Invalid policy mask');
  const fallback = record.fallback ?? null;
  if (Boolean(fallback) !== !mask) throw new Error('Fallback policy mask mismatch');
  if (fallback && (![1, 2].includes(fallback.schemaVersion) ||
      !['search-incomplete', 'safety-incomplete', 'legality-incomplete'].includes(fallback.reason) ||
      fallback.selectionBasis !== 'model-policy' || fallback.valueSource !== 'root-model' ||
      !['win', 'eligible', 'losing', 'incomplete'].includes(fallback.selectedActionSafety) ||
      record.policy.length !== 0)) throw new Error('Invalid fallback provenance');
  if (fallback && fallback.schemaVersion === 1 && ((fallback.reason !== 'legality-incomplete' && fallback.selectedActionSafety !== (fallback.reason === 'search-incomplete' ? 'eligible' : 'incomplete')) ||
      ['checkedEligibleCount','uncheckedCount','provenLosingCount'].some(key => !Number.isSafeInteger(fallback[key]) || fallback[key] < 0) ||
      (fallback.reason === 'safety-incomplete' && (fallback.checkedEligibleCount !== 0 || fallback.uncheckedCount < 1)) ||
      (fallback.reason === 'search-incomplete' && fallback.checkedEligibleCount < 1))) throw new Error('Contradictory fallback evidence');
  if (fallback && (['checkedEligibleCount','uncheckedCount','provenLosingCount'].some(key => !Number.isSafeInteger(fallback[key]) || fallback[key] < 0) ||
      (fallback.selectedActionSafety === 'eligible' && fallback.checkedEligibleCount < 1) ||
      (fallback.selectedActionSafety === 'incomplete' && fallback.uncheckedCount < 1) ||
      (fallback.selectedActionSafety === 'losing' && fallback.provenLosingCount < 1))) throw new Error('Contradictory fallback counts');
  if (record.legality) {
    const l = record.legality;
    if (typeof l.complete !== 'boolean' || !Array.isArray(l.indices) ||
        new Set(l.indices).size !== l.indices.length || l.indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= experimentConfig.actionCount) ||
        !Number.isSafeInteger(l.checked) || l.checked < 0 || !Number.isSafeInteger(l.unknown) || l.unknown < 0 ||
        (l.checked < l.indices.length) || (l.complete && l.unknown !== 0) || (record.legal && JSON.stringify(record.legal) !== JSON.stringify(l.indices))) throw new Error('Invalid legality evidence');
    if (!l.complete && (mask || fallback?.reason !== 'legality-incomplete' || fallback.schemaVersion !== 2)) throw new Error('Partial legality requires masked fallback');
  }
  if (fallback?.reason === 'legality-incomplete' && (record.legality?.complete !== false || fallback.schemaVersion !== 2)) throw new Error('Missing partial legality evidence');
  return true;
}

export function decisionProvenance(result, searchPolicyVersion) {
  const record = {
    legality: result.legality,
    policyMask: result.policyMask, fallback: result.fallback, policy: result.policy,
    searchPolicyVersion,
    search: { nodes: result.nodes, simulations: result.simulations, stopped: result.stopped,
      reason: result.reason, elapsedMs: result.elapsedMs, engineBudget: result.engineBudget,
      actions: result.actions, reportedValue: result.value },
  };
  validateDecisionProvenance(record);
  return record;
}
