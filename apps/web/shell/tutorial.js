export const createTutorialController = ({ steps }) => {
  let index = 0;

  const current = () => ({
    index,
    total: steps.length,
    step: steps[index],
    hasNext: index < steps.length - 1,
  });

  const next = () => {
    if (index < steps.length - 1) {
      index += 1;
    }
    return current();
  };

  const reset = () => {
    index = 0;
    return current();
  };

  return {
    current,
    next,
    reset,
  };
};
