import { createHash } from 'node:crypto';
import catalog from '../../packages/computer-player/config/training-recipes-v1.json' with { type: 'json' };
import { trainingRecipe, validateTrainingRecipe, explorationSeed, dirichletNoise, recipeJson } from '../../packages/computer-player/src/exploration.ts';

export function validateExplorationProvenance(record) {
  const recipe = validateTrainingRecipe(record.trainingRecipe ?? trainingRecipe());
  if ('trainingRecipe' in record) validateTrainingRecipe(record.trainingRecipe);
  const settings = catalog.recipes.find(item => item.id === recipe.id).definition;
  if (createHash('sha256').update(recipeJson(settings)).digest('hex') !== recipe.sha256) throw new Error('Training recipe catalog checksum mismatch');
  const evidence = record.rootExploration;
  if (evidence === undefined) {
    if (recipe.id !== 'baseline-v1') throw new Error('Missing exploration provenance');
    return recipe;
  }
  if (!evidence || typeof evidence !== 'object') throw new Error('Invalid exploration evidence');
  if (record.trainingRecipe === undefined || evidence.schema !== 1 ||
      recipeJson(validateTrainingRecipe(evidence.recipe)) !== recipeJson(recipe) ||
      evidence.requested !== settings.rootExploration || typeof evidence.applied !== 'boolean' ||
      !Number.isSafeInteger(record.seed) || evidence.seedDerivation !== (settings.seedDerivation ?? null) ||
      evidence.derivedSeed !== (evidence.requested ? explorationSeed(record.seed, recipe) : null)) {
    throw new Error('Invalid exploration identity or seed');
  }
  const arrays = ['eligibleIndices', 'rawPriors', 'effectivePriors'];
  if (arrays.some(key => !Array.isArray(evidence[key]))) throw new Error('Invalid exploration arrays');
  if (!evidence.applied) {
    if (!['disabled', 'path-bypassed', 'first-visit-incomplete', 'too-few-actions', 'too-few-simulations', 'deadline', 'zero-mass'].includes(evidence.skipReason) ||
        (evidence.requested === (evidence.skipReason === 'disabled')) || evidence.noiseSha256 !== null ||
        arrays.some(key => evidence[key].length)) throw new Error('Invalid skipped exploration');
    return recipe;
  }
  if (!evidence.requested || evidence.skipReason !== null || record.policyMask !== true || record.fallback ||
      record.legality?.complete !== true || record.search?.reason !== 'search') throw new Error('Exploration applied to bypassed path');
  const indices = evidence.eligibleIndices;
  if (indices.length < 2 || arrays.some(key => evidence[key].length !== indices.length) ||
      indices.some((index, i) => !Number.isInteger(index) || !record.legality.indices.includes(index) || (i > 0 && indices[i - 1] >= index))) {
    throw new Error('Invalid exploration eligibility');
  }
  const noise = dirichletNoise(indices.length, evidence.derivedSeed, recipe);
  if (createHash('sha256').update(recipeJson(noise)).digest('hex') !== evidence.noiseSha256) throw new Error('Exploration noise digest mismatch');
  const mass = evidence.rawPriors.reduce((sum, prior) => sum + prior, 0);
  if (!Number.isFinite(mass) || mass <= 0 || mass > 1 + 1e-12) throw new Error('Invalid exploration prior mass');
  for (const [i, index] of indices.entries()) {
    const action = record.search.actions.find(item => item.index === index);
    const raw = evidence.rawPriors[i], effective = evidence.effectivePriors[i];
    if (!action || action.immediate !== 'eligible' || action.executable !== true || !Number.isFinite(raw) || raw < 0 || action.prior !== raw ||
        !Number.isFinite(effective) || effective !== (1 - settings.noiseWeight) * raw + settings.noiseWeight * mass * noise[i]) {
      throw new Error('Exploration prior evidence mismatch');
    }
  }
  return recipe;
}

/** The worker accepts exploration only on explicit training/development jobs. */
export function trainingExplorationOptions(job) {
  if (job.rootExploration === undefined) return {};
  const request = job.rootExploration;
  const allowed = (job.command === 'generate' && job.partition === 'train' && request?.purpose === 'self-play') ||
    (job.command === 'search' && job.partition === 'development' && job.kind === 'exploration-screen' && request?.purpose === 'development-screen');
  if (!allowed) throw new Error('Exploration is restricted to training self-play and the development screen');
  validateTrainingRecipe(request.recipe);
  return { rootExploration: request };
}
