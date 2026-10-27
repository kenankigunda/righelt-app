// Route reads share one canonical route/authority epoch, including cached routes.
export const createRouteHydration = () => {
  let flight = null, authority = null, epoch = 0;
  const identity = key => key.routeKey ?? key.hash;
  const observe = key => {
    if (!authority || authority.generation !== key.generation || identity(authority) !== identity(key) || authority.owner !== key.owner) {
      authority = key;
      epoch++;
      flight = null;
    }
    return epoch;
  };
  const hydrate = (key, read) => {
    if (key.epoch !== undefined && key.epoch !== epoch) return Promise.reject(Object.assign(new Error("session_changed"), { code: "session_changed" }));
    const currentEpoch = observe(key);
    if (flight && flight.epoch === currentEpoch && flight.inputs === key.inputs) return flight.promise;
    const current = { ...key, epoch: currentEpoch };
    current.promise = Promise.resolve().then(() => read(() => flight === current && epoch === currentEpoch)).finally(() => {
      if (flight === current) flight = null;
    });
    flight = current;
    return current.promise;
  };
  hydrate.observe = observe;
  hydrate.currentEpoch = () => epoch;
  return hydrate;
};
