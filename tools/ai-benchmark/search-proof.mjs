// Compare completed, identical-budget searches; censored work is never parity proof.
export function compareSearchParity(reference, actual) {
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  require(reference.complete === true, 'Reference computation is incomplete');
  require(actual.modelVersion === reference.modelSha256, 'Model checksum differs');
  require(actual.results.length === reference.states.length, 'Search state count differs');
  let nearTies = 0;
  for (let i = 0; i < actual.results.length; i++) {
    const expected = reference.states[i], observed = actual.results[i], id = expected.id;
    require(observed.id === id && observed.seed === expected.seed, `${id}: state/seed differs`);
    const a = expected.result, b = observed.result;
    require(a.status === 'ready' && b.status === 'ready', `${id}: unfinished search`);
    require(a.stopped !== 'deadline' && b.stopped !== 'deadline', `${id}: deadline-censored search`);
    require(a.simulations === b.simulations && a.stopped === b.stopped, `${id}: completed work differs`);
    const guards = result => result.actions.map(({ index, immediate, tactical }) => ({ index, immediate, tactical }));
    require(JSON.stringify(guards(a)) === JSON.stringify(guards(b)), `${id}: tactical outcomes differ`);
    if (a.actionIndex !== b.actionIndex) {
      const left = a.actions.find(row => row.index === a.actionIndex);
      const right = a.actions.find(row => row.index === b.actionIndex);
      require(left?.visits > 0 && right?.visits > 0 && Number.isFinite(left.value) && Number.isFinite(right.value), `${id}: unvisited selection difference`);
      require(Math.abs(left.value - right.value) <= 2 * (1e-5 + 1e-4 * Math.max(Math.abs(left.value), Math.abs(right.value))), `${id}: selection differs beyond numerical bound`);
      nearTies++;
    }
  }
  return { states: actual.results.length, referenceDevice: reference.referenceDevice,
    modelSha256: actual.modelVersion, tacticalOutcomesVerified: true, nearTies,
    actualPhone: false, acceptancePassed: false };
}
