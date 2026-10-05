// A single field's latest value wins, with no overlapping writes or stale UI.
export function createAccountAutosave({ initial, validate, save, isCurrent, report, timers = globalThis }) {
  let value = initial, saved = initial, timer = null, flight = null, retired = false;
  const current = () => !retired && isCurrent();
  const cancelTimer = () => { timers.clearTimeout(timer); timer = null; };
  const dirty = () => value !== saved;
  const flush = () => {
    cancelTimer();
    if (!current()) return Promise.resolve(false);
    if (flight) return flight;
    if (!dirty()) return Promise.resolve(true);
    flight = (async () => {
      while (current() && dirty()) {
        const checked = validate(value);
        if (!checked.ok) { report("invalid"); return false; }
        const sent = value;
        report("saving");
        try { await save(checked.value); }
        catch (error) { if (current()) report("error", error); return false; }
        if (!current()) return false;
        saved = sent;
      }
      if (current()) report("saved");
      return current();
    })().finally(() => { flight = null; });
    return flight;
  };
  return {
    dirty: () => Boolean(flight) || dirty(),
    change(next) {
      if (!current() || next === value) return;
      value = next; cancelTimer();
      if (!validate(value).ok) { report("invalid"); return; }
      if (!dirty() && !flight) { report("saved"); return; }
      report("saving");
      timer = timers.setTimeout(() => { void flush(); }, 500);
    },
    flush,
    cancel() { retired = true; cancelTimer(); },
  };
}
