import type { BotId, BotPersona } from "./types";

export const BOT_PERSONA_VERSION = "cp-persona-v1" as const;

export const BOT_PERSONAS: Record<BotId, BotPersona> = {
  babs: {
    id: "babs",
    displayName: "Babs the Beginner",
    skill: "beginner",
    style: "balanced",
    theme: "bunny",
    searchDepth: 1,
    branchFactor: 10,
    noiseScale: 0.16,
    forgiveness: 1.5,
    aggression: -0.4,
    defense: 0.9,
    conversion: 0.2,
  },
  tau: {
    id: "tau",
    displayName: "Tau the Tenacious",
    skill: "medium",
    style: "defensive",
    theme: "tortoise",
    searchDepth: 2,
    branchFactor: 16,
    noiseScale: 0.02,
    forgiveness: 0.6,
    aggression: -0.2,
    defense: 1.4,
    conversion: 0.75,
  },
  sev: {
    id: "sev",
    displayName: "Sev the Sneakster",
    skill: "medium",
    style: "aggressive",
    theme: "fox",
    searchDepth: 2,
    branchFactor: 12,
    noiseScale: 0.05,
    forgiveness: 0.2,
    aggression: 1.5,
    defense: 0.2,
    conversion: 0.7,
  },
  horus: {
    id: "horus",
    displayName: "Horus the Sage",
    skill: "hard",
    style: "balanced",
    theme: "owl",
    searchDepth: 3,
    branchFactor: 16,
    noiseScale: 0.01,
    forgiveness: 0.3,
    aggression: 0.6,
    defense: 0.7,
    conversion: 1.3,
  },
};

export function getBotPersona(personaId: BotId): BotPersona {
  return BOT_PERSONAS[personaId];
}

export function listBotPersonas(): BotPersona[] {
  return Object.values(BOT_PERSONAS);
}
