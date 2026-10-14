// Own asynchronous fault work so it cannot escape into the next test.
// Reporters may omit AggregateError.errors. Keep the cause's first line visible
// without copying request headers or bodies from multiline browser errors.
const failureSummary = (errors, label) => new AggregateError(errors,
  `${label}: ${errors.map(error => String(error?.message ?? error).split(/\r?\n/)[0]).join('; ')}`);
export function createFaultLifecycle({setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let disposed = false;
  const timers = new Map(), pending = new Set(), errors = [];
  const lifecycle = {
    get disposed() { return disposed; },
    schedule(callback, delay) {
      if (disposed) return;
      const timer = setTimer(() => {
        timers.delete(timer);
        if (!disposed) {
          try { callback(); } catch (error) { errors.push(error); }
        }
      }, delay);
      timers.set(timer, () => {});
    },
    wait(delay) {
      if (disposed) return Promise.resolve();
      return new Promise(resolve => {
        const timer = setTimer(() => { timers.delete(timer); resolve(); }, delay);
        timers.set(timer, resolve);
      });
    },
    async run(callback) {
      if (disposed) return;
      const task = Promise.resolve().then(() => { if (!disposed) return callback(); });
      pending.add(task);
      try { await task; } catch (error) { errors.push(error); }
      finally { pending.delete(task); }
    },
    stop() {
      disposed = true;
      for (const [timer, resolve] of timers) { clearTimer(timer); resolve(); }
      timers.clear();
    },
    async dispose() {
      lifecycle.stop();
      await Promise.allSettled([...pending]);
      if (errors.length) throw failureSummary(errors, "Fault helper asynchronous work failed");
    },
  };
  return lifecycle;
}

export async function disposeFaultContexts(resources, contexts) {
 const results = await Promise.allSettled(contexts.map(async context => {
  const faults = resources.faults.get(context) || [];
  faults.forEach(f => f.stop());
  try {
   const unroute = await Promise.allSettled([context.unrouteAll({behavior: "wait"})]);
   const results = await Promise.allSettled(faults.map(f => f.dispose()));
   const errors = [...unroute, ...results].filter(r => r.status === 'rejected').map(r => r.reason);
   if(errors.length) throw failureSummary(errors, 'Fault cleanup failed');
  } finally {
   resources.faults.delete(context);
   if(resources.contexts.delete(context)) await context.close();
  }
 }));
 const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
 if(errors.length) throw failureSummary(errors, 'Recovery test cleanup failed');
}
