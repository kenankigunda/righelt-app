import {
  deterministicStateHash,
  resolveToStability,
} from "../generated/packages/game-engine/src/index.js";

export const computeScenarioStateHash = async (candidateState) =>
  deterministicStateHash(resolveToStability(candidateState, { artifactMode: "full" }));
