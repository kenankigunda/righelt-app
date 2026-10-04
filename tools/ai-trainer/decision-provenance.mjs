// Search diagnostics are evidence, not a substitute for genuine policy targets.
export function validateDecisionProvenance(record) {
  const mask = record.policyMask ?? true;
  if (typeof mask !== 'boolean') throw new Error('Invalid policy mask');
  const fallback = record.fallback ?? null;
  if (Boolean(fallback) !== !mask) throw new Error('Fallback policy mask mismatch');
  if (fallback && (fallback.schemaVersion !== 1 ||
      !['search-incomplete', 'safety-incomplete'].includes(fallback.reason) ||
      fallback.selectionBasis !== 'model-policy' || fallback.valueSource !== 'root-model' ||
      !['eligible', 'incomplete'].includes(fallback.selectedActionSafety) ||
      record.policy.length !== 0)) throw new Error('Invalid fallback provenance');
  if (fallback && (fallback.selectedActionSafety !== (fallback.reason === 'search-incomplete' ? 'eligible' : 'incomplete') ||
      ['checkedEligibleCount','uncheckedCount','provenLosingCount'].some(key => !Number.isSafeInteger(fallback[key]) || fallback[key] < 0) ||
      (fallback.reason === 'safety-incomplete' && (fallback.checkedEligibleCount !== 0 || fallback.uncheckedCount < 1)) ||
      (fallback.reason === 'search-incomplete' && fallback.checkedEligibleCount < 1))) throw new Error('Contradictory fallback evidence');
  return true;
}

export function decisionProvenance(result, searchPolicyVersion) {
  const record = {
    policyMask: result.policyMask, fallback: result.fallback, policy: result.policy,
    searchPolicyVersion,
    search: { nodes: result.nodes, simulations: result.simulations, stopped: result.stopped,
      reason: result.reason, elapsedMs: result.elapsedMs, engineBudget: result.engineBudget,
      actions: result.actions, reportedValue: result.value },
  };
  validateDecisionProvenance(record);
  return record;
}
