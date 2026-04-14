export const BOT_PERSONA_VERSION = "cp-persona-v1";
export const BOT_MOVE_SELECTION_TIMEOUT_MS_BY_SKILL = Object.freeze({
    beginner: 12000,
    medium: 21000,
    hard: 27000,
});
export const BOT_PERSONAS = {
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
    branchFactor: 12,
    noiseScale: 0.01,
    forgiveness: 0.3,
    aggression: 0.6,
    defense: 0.7,
        conversion: 1.3,
    },
};
export function getBotPersona(personaId) {
    return BOT_PERSONAS[personaId];
}
export function listBotPersonas() {
    return Object.values(BOT_PERSONAS);
}
export function getBotMoveSelectionTimeoutMs(personaId) {
    const skill = personaId ? BOT_PERSONAS[personaId]?.skill : null;
    return BOT_MOVE_SELECTION_TIMEOUT_MS_BY_SKILL[skill ?? "beginner"] ?? BOT_MOVE_SELECTION_TIMEOUT_MS_BY_SKILL.beginner;
}
