// Compare identical-budget results. A completed fallback decision is evidence of
// runtime agreement, not evidence that its interrupted safety/search work finished.
const FALLBACK_FIELDS = ['schemaVersion', 'reason', 'selectionBasis', 'selectedActionSafety',
  'valueSource', 'checkedEligibleCount', 'uncheckedCount', 'provenLosingCount'];
const numericalBound = (a, b) => 1e-5 + 1e-4 * Math.max(Math.abs(a), Math.abs(b));
const finiteClose = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= numericalBound(a, b);

function fallbackChoices(result, require, id) {
  const fallback = result.fallback;
  require(result.policyMask === false && result.reason === 'model-fallback' &&
    Array.isArray(result.policy) && result.policy.length === 0, `${id}: fallback policy contract differs`);
  require(fallback && Object.keys(fallback).sort().join() === [...FALLBACK_FIELDS].sort().join() &&
    [1,2].includes(fallback.schemaVersion) && fallback.selectionBasis === 'model-policy' && fallback.valueSource === 'root-model' &&
    ['search-incomplete', 'safety-incomplete', 'legality-incomplete'].includes(fallback.reason), `${id}: invalid fallback metadata`);
  const checked = result.actions.filter(action => action.immediate === 'eligible');
  const unknown = result.actions.filter(action => action.immediate === 'incomplete');
  const losing = result.actions.filter(action => action.immediate === 'losing');
  const wins = result.actions.filter(action => action.immediate === 'win');
  require(wins.length + checked.length + unknown.length + losing.length === result.actions.length &&
    fallback.checkedEligibleCount === checked.length && fallback.uncheckedCount === unknown.length &&
    fallback.provenLosingCount === losing.length, `${id}: fallback safety counts differ`);
  let choices;
  if (fallback.reason === 'legality-incomplete') {
    require(fallback.schemaVersion === 2 && result.legality?.complete === false, `${id}: missing partial legality`);
    choices = [wins, checked, unknown, losing].map(rows => rows.filter(action => action.executable !== false)).find(rows => rows.length) ?? [];
  } else if (fallback.schemaVersion === 2) {
    choices = [wins, checked, unknown, losing].map(rows => rows.filter(action => action.executable !== false)).find(rows => rows.length) ?? [];
    require(choices.some(action => action.immediate === fallback.selectedActionSafety), `${id}: unavailable fallback tier`);
  } else if (fallback.reason === 'search-incomplete') {
    require(checked.length > 0 && fallback.selectedActionSafety === 'eligible', `${id}: fallback safety reason differs`);
    const notProvenLost = checked.filter(action => action.tactical !== 'proven-loss');
    choices = notProvenLost.length ? notProvenLost : checked;
  } else {
    require(checked.length === 0 && unknown.length > 0 && fallback.selectedActionSafety === 'incomplete', `${id}: fallback safety reason differs`);
    choices = unknown;
  }
  require(result.actions.every(action => Number.isFinite(action.policyLogit)), `${id}: missing raw policy logits`);
  choices = choices.filter(action => action.executable !== false);
  const selected = choices.find(action => action.index === result.actionIndex);
  require(selected && selected.visits === 0 && selected.value === null, `${id}: invalid fallback selection evidence`);
  const maximum = Math.max(...choices.map(action => action.policyLogit));
  require(selected.policyLogit === maximum, `${id}: fallback did not select highest model logit`);
  return choices.filter(action => action.policyLogit === maximum).map(action => action.index).sort((a, b) => a - b);
}

export function compareSearchParity(reference, actual) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  require(reference.complete === true, 'Reference computation is incomplete');
  require(actual.modelVersion === reference.modelSha256, 'Model checksum differs');
  require(actual.results.length === reference.states.length, 'Search state count differs');
  let nearTies = 0, fallbackStates = 0;
  for (let i = 0; i < actual.results.length; i++) {
    const expected = reference.states[i], observed = actual.results[i], id = expected.id;
    require(observed.id === id && observed.seed === expected.seed, `${id}: state/seed differs`);
    const a = expected.result, b = observed.result;
    require(a.status === 'ready' && b.status === 'ready', `${id}: unfinished search`);
    require(a.stopped !== 'deadline' && b.stopped !== 'deadline', `${id}: deadline-censored search`);
    require(a.simulations === b.simulations && a.stopped === b.stopped, `${id}: completed work differs`);
    require(a.reason === b.reason && a.policyMask === b.policyMask, `${id}: result provenance differs`);
    const legality = result => result.legality === undefined ? undefined : {
      complete:result.legality.complete,checked:result.legality.checked,unknown:result.legality.unknown,indices:result.legality.indices,
    };
    require(JSON.stringify(legality(a)) === JSON.stringify(legality(b)), `${id}: legality evidence differs`);
    const guards = result => result.actions.map(({ index, immediate, tactical, executable }) => ({ index, immediate, tactical, executable }));
    require(JSON.stringify(guards(a)) === JSON.stringify(guards(b)), `${id}: tactical outcomes differ`);
    if (a.fallback !== null || b.fallback !== null) {
      const aTies = fallbackChoices(a, require, id), bTies = fallbackChoices(b, require, id);
      require(FALLBACK_FIELDS.every(field => a.fallback[field] === b.fallback[field]), `${id}: fallback metadata differs`);
      require(finiteClose(a.value, b.value), `${id}: root value differs beyond numerical bound`);
      require(a.actions.every((action, index) => finiteClose(action.policyLogit, b.actions[index].policyLogit)), `${id}: raw policy logits differ beyond numerical bound`);
      fallbackStates++;
      if (a.actionIndex !== b.actionIndex) {
        require(JSON.stringify(aTies) !== JSON.stringify(bTies), `${id}: seeded exact-tie selection differs`);
        // Both runtimes must independently rank their own choice first; a
        // cross-runtime switch is acceptable only inside the raw-logit bound.
        for (const result of [a, b]) {
          const left = result.actions.find(action => action.index === a.actionIndex);
          const right = result.actions.find(action => action.index === b.actionIndex);
          require(Math.abs(left.policyLogit - right.policyLogit) <= 2 * numericalBound(left.policyLogit, right.policyLogit), `${id}: fallback selection differs beyond numerical bound`);
        }
        nearTies++;
      }
    } else {
      require(a.policyMask === true && b.policyMask === true, `${id}: normal policy mask differs`);
      if (a.actionIndex !== b.actionIndex) {
        const left = a.actions.find(row => row.index === a.actionIndex);
        const right = a.actions.find(row => row.index === b.actionIndex);
        require(left?.visits > 0 && right?.visits > 0 && Number.isFinite(left.value) && Number.isFinite(right.value), `${id}: unvisited selection difference`);
        require(Math.abs(left.value - right.value) <= 2 * numericalBound(left.value, right.value), `${id}: selection differs beyond numerical bound`);
        nearTies++;
      }
    }
  }
  return { states: actual.results.length, referenceDevice: reference.referenceDevice,
    modelSha256: actual.modelVersion, tacticalOutcomesVerified: true, fallbackStates, nearTies,
    actualPhone: false, acceptancePassed: false };
}
