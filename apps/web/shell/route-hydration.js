// Route reads can be requested by both an authority transition and its dialog.
// Share only the active authority/route's read; never reuse a settled result.
export const createRouteHydration = () => {
  let flight = null;
  return (key, read) => {
    if (flight && flight.generation === key.generation && flight.hash === key.hash && flight.owner === key.owner && flight.inputs === key.inputs) return flight.promise;
    const current = { ...key };
    current.promise = Promise.resolve().then(read).finally(() => {
      if (flight === current) flight = null;
    });
    flight = current;
    return current.promise;
  };
};
