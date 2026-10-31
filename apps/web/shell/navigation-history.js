// Each browser visit owns its reading position. Explicit Home is a new visit
// at the top; browser traversal restores the destination visit instead.
export function createNavigationHistory({ history, getHash, capture, id = () => globalThis.crypto.randomUUID() }) {
  const key = 'righeltVisit';
  let sequence = history.state?.[key]?.index ?? 0;
  let current = history.state?.[key] ?? { id: id(), index: sequence, hash: getHash(), view: null };
  let traversal = null;
  const visits = new Map([[current.id, current]]);
  const replace = () => history.replaceState({ ...history.state, [key]: current }, '');
  const remember = (overrides = {}) => {
    if (getHash() !== current.hash) return false;
    current = { ...current, view: { ...capture(), ...overrides } };
    visits.set(current.id, current);
    return true;
  };
  replace();
  return {
    remember,
    save(overrides) {
      if (remember(overrides)) replace();
    },
    replaceHash(hash) {
      current = { ...current, hash };
      visits.set(current.id, current);
      history.replaceState({ ...history.state, [key]: current }, '', hash);
    },
    observePop(state) {
      const visit = state?.[key];
      if (visit && visit.id !== current.id) {
        traversal = visits.get(visit.id) ?? visit;
        return visit.hash === current.hash;
      }
      return false;
    },
    arrive() {
      if (traversal?.hash === getHash()) {
        const destination = traversal;
        const direction = destination.index < current.index ? 'back' : 'forward';
        current = destination; sequence = Math.max(sequence, destination.index); traversal = null;
        return { restore: destination.view, direction, traversed: true };
      }
      traversal = null;
      current = { id: id(), index: ++sequence, hash: getHash(), view: null };
      visits.set(current.id, current);
      replace();
      return { restore: null, direction: null, traversed: false };
    },
  };
}
