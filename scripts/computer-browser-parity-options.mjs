// Selection only: importing this module never reads assets or starts a browser.
const modelIdPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const forbiddenIds = new Set(['__proto__', 'prototype', 'constructor']);
export function selectBrowserParityModel(argv, {current, models}) {
  if (argv.some(value => value.startsWith('--model-id='))) throw Error('Use --model-id MODEL_ID');
  const indexes = argv.flatMap((value, index) => value === '--model-id' ? [index] : []);
  if (indexes.length > 1) throw Error('Duplicate --model-id');
  const id = indexes.length ? argv[indexes[0] + 1] : current?.id;
  if (typeof id !== 'string' || !modelIdPattern.test(id) || forbiddenIds.has(id)) throw Error('Invalid --model-id');
  if (!models || !Object.hasOwn(models, id)) throw Error(`Unknown published model: ${id}`);
  const model = models[id];
  const fields = ['id', 'sha256', 'bytes', 'checkpoint', 'url', 'experimental'];
  if (!model || typeof model !== 'object' || fields.some(key => !Object.hasOwn(model, key)) || model.id !== id ||
      !/^[a-f0-9]{64}$/.test(model.sha256) || !/^[a-f0-9]{64}$/.test(model.checkpoint) ||
      !Number.isSafeInteger(model.bytes) || model.bytes <= 0 || typeof model.experimental !== 'boolean' ||
      typeof model.url !== 'string' || !/^\/computer\/models\/[a-z0-9][a-z0-9._-]*\.onnx$/.test(model.url)) {
    throw Error(`Invalid published model descriptor: ${id}`);
  }
  return model;
}
