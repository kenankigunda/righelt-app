import catalog from "../config/training-recipes-v1.json";
import { experimentConfig } from "./representation";

export type TrainingRecipe = { id: string; sha256: string };
export type RootExplorationRequest = {
  purpose: "self-play" | "development-screen";
  recipe: TrainingRecipe;
};
export type ExplorationSkip = "disabled" | "path-bypassed" | "first-visit-incomplete" |
  "too-few-actions" | "too-few-simulations" | "deadline" | "zero-mass";
export type RootExplorationEvidence = {
  schema: 1; recipe: TrainingRecipe; requested: boolean; applied: boolean;
  seedDerivation: string | null; derivedSeed: number | null; skipReason: ExplorationSkip | null;
  eligibleIndices: number[]; rawPriors: number[]; effectivePriors: number[]; noiseSha256: string | null;
};

/** Stable JSON for recipe/noise digests across TypeScript and Python. */
export function recipeJson(value: unknown): string {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, sorted(v)])) : item;
  return JSON.stringify(sorted(value));
}
export async function explorationDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(recipeJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function trainingRecipe(id = "baseline-v1"): TrainingRecipe {
  const record = catalog.recipes.find(item => item.id === id);
  if (!record) throw new Error("Unknown training recipe");
  return { id: record.id, sha256: record.sha256 };
}
export function validateTrainingRecipe(value: unknown): TrainingRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "id,sha256") throw new Error("Invalid training recipe binding");
  const recipe = value as TrainingRecipe;
  if (typeof recipe.id !== "string" || typeof recipe.sha256 !== "string") throw new Error("Invalid training recipe identity");
  const known = trainingRecipe(recipe.id);
  if (recipe.sha256 !== known.sha256) throw new Error("Altered training recipe");
  return known;
}
const definition = (recipe: TrainingRecipe) => catalog.recipes.find(item => item.id === recipe.id)!.definition;
export async function verifyTrainingRecipe(recipe: TrainingRecipe): Promise<void> {
  validateTrainingRecipe(recipe);
  if (await explorationDigest(definition(recipe)) !== recipe.sha256) throw new Error("Training recipe catalog checksum mismatch");
}

export function explorationEvidence(request: RootExplorationRequest | undefined, seed: number): RootExplorationEvidence | undefined {
  if (request === undefined) return undefined;
  if (!request || !["self-play", "development-screen"].includes(request.purpose) ||
      Object.keys(request).sort().join(",") !== "purpose,recipe") throw new Error("Invalid exploration request");
  const recipe = validateTrainingRecipe(request.recipe);
  const settings = definition(recipe), requested = settings.rootExploration;
  return { schema: 1, recipe, requested, applied: false,
    seedDerivation: requested ? settings.seedDerivation! : null,
    derivedSeed: requested ? explorationSeed(seed, recipe) : null,
    skipReason: requested ? "path-bypassed" : "disabled",
    eligibleIndices: [], rawPriors: [], effectivePriors: [], noiseSha256: null };
}

/** A separate versioned stream. Never consume search's final-choice generator. */
export function explorationSeed(seed: number, recipe: TrainingRecipe): number {
  if (!Number.isSafeInteger(seed)) throw new Error("Invalid exploration seed");
  validateTrainingRecipe(recipe);
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(`righelt/root-exploration/fnv1a32-root-recipe-v1\0${seed >>> 0}\0${recipe.id}\0${recipe.sha256}`);
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

function noiseRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    // Open (0,1), including for a zero PRNG word. Logarithms remain finite.
    return (((value ^ value >>> 14) >>> 0) + .5) / 4294967296;
  };
}

/** At most K * maxGammaAttempts rejection rounds, no rule work or retries. */
export function dirichletNoise(count: number, seed: number, recipe = trainingRecipe("root-dirichlet-v1")): number[] {
  validateTrainingRecipe(recipe);
  const settings = definition(recipe);
  if (!settings.rootExploration || !Number.isInteger(count) || count < 2 || count > experimentConfig.actionCount ||
      !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid Dirichlet settings");
  const alpha = settings.totalConcentration! / count;
  const random = noiseRandom(seed);
  const gammaLog = (): number => {
    const shape = alpha < 1 ? alpha + 1 : alpha, d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (let attempt = 0; attempt < settings.maxGammaAttempts!; attempt++) {
      const normal = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
      const x = 1 + c * normal;
      if (x <= 0) continue;
      const v = x * x * x, u = random();
      if (u < 1 - .0331 * normal ** 4 || Math.log(u) < .5 * normal * normal + d * (1 - v + Math.log(v))) {
        // Log-space sampling prevents all-zero gamma samples at large K.
        const result = Math.log(d * v) + (alpha < 1 ? Math.log(random()) / alpha : 0);
        if (!Number.isFinite(result)) throw new Error("Non-finite Dirichlet sample");
        return result;
      }
    }
    throw new Error("Dirichlet sampling bound exhausted");
  };
  const samples = Array.from({ length: count }, gammaLog), max = Math.max(...samples);
  const weights = samples.map(value => Math.exp(value - max));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Invalid Dirichlet normalization");
  return weights.map(value => value / total);
}

export async function applyRootExploration(evidence: RootExplorationEvidence | undefined,
  actions: { index: number; prior: number }[], remainingSimulations: number, firstVisitCompleted: boolean,
  deadlineMs?: number): Promise<Map<number, number>> {
  const effective = new Map<number, number>();
  if (!evidence?.requested) return effective;
  const skip = (reason: ExplorationSkip) => { evidence.skipReason = reason; return effective; };
  if (!firstVisitCompleted) return skip("first-visit-incomplete");
  if (actions.length < 2) return skip("too-few-actions");
  if (remainingSimulations < 2) return skip("too-few-simulations");
  if (deadlineMs !== undefined && performance.now() >= deadlineMs) return skip("deadline");
  const sorted = [...actions].sort((a, b) => a.index - b.index);
  if (new Set(sorted.map(item => item.index)).size !== sorted.length || sorted.some(item =>
    !Number.isInteger(item.index) || item.index < 0 || item.index >= experimentConfig.actionCount ||
    !Number.isFinite(item.prior) || item.prior < 0)) throw new Error("Invalid root exploration priors");
  const mass = sorted.reduce((sum, item) => sum + item.prior, 0);
  if (!Number.isFinite(mass) || mass > 1 + 1e-12) throw new Error("Invalid root exploration mass");
  if (mass === 0) return skip("zero-mass");
  const settings = definition(validateTrainingRecipe(evidence.recipe));
  await verifyTrainingRecipe(evidence.recipe);
  const noise = dirichletNoise(sorted.length, evidence.derivedSeed!, evidence.recipe);
  const noiseSha256 = await explorationDigest(noise);
  if (deadlineMs !== undefined && performance.now() >= deadlineMs) return skip("deadline");
  const priors = sorted.map((item, i) => (1 - settings.noiseWeight!) * item.prior + settings.noiseWeight! * mass * noise[i]);
  if (priors.some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid effective root prior");
  Object.assign(evidence, { applied: true, skipReason: null, eligibleIndices: sorted.map(item => item.index),
    rawPriors: sorted.map(item => item.prior), effectivePriors: priors, noiseSha256 });
  sorted.forEach((item, i) => effective.set(item.index, priors[i]));
  return effective;
}
