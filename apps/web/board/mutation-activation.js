// Prevent a press that spans an admission change from becoming a later command.
// This fence never grants authority; the ordinary host check still decides.
export function createMutationActivationFence() {
  let unavailable = false, generation = 0, press = null;
  return {
    update(nextUnavailable) {
      const next = Boolean(nextUnavailable);
      if (next !== unavailable) generation += 1;
      unavailable = next;
    },
    begin(target) {
      press = target ? { target, generation } : null;
    },
    allow(target) {
      if (unavailable) return false;
      if (!press) return true;
      const allowed = press.target === target && press.generation === generation;
      press = null;
      return allowed;
    },
    cancel() { press = null; },
    snapshot() { return { unavailable, generation, pressed: Boolean(press) }; },
  };
}
