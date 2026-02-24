export const ENGINE_FIXTURE_SCHEMA_VERSION = "1.0.0";

export const ENGINE_TRACK_SCOPES = {
  A: {
    matrixIds: ["A", "C", "D", "E", "F", "G", "L"],
    scenarioIds: ["P-006", "P-007", "P-008"],
  },
  B: {
    matrixIds: ["B", "H", "I", "J", "K", "O", "P", "Q"],
    scenarioIds: ["P-001", "P-002", "P-003", "P-004"],
  },
  C: {
    matrixIds: ["M"],
    scenarioIds: ["M-001", "M-002", "M-003", "M-004", "P-005"],
  },
};

export const BANNED_AUTHORITATIVE_IMPORTS = [
  "graphlib",
  "pathfinding",
  "@dagrejs/graphlib",
  "dijkstrajs",
  "ngraph.graph",
  "ngraph.path",
];

export const AUTHORITATIVE_MODULES = [
  "packages/game-engine/src/state.ts",
  "packages/game-engine/src/legal.ts",
  "packages/game-engine/src/apply.ts",
  "packages/game-engine/src/resolve.ts",
  "packages/game-engine/src/replay.ts",
];
