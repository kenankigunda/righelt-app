import type { Action, GameState, OutcomeStatus, PlayerId } from "../../shared-types/src/engine";

export type BotId = "babs" | "tau" | "sev" | "horus";

export type BotSkill = "beginner" | "medium" | "hard";

export type BotStyle = "balanced" | "defensive" | "aggressive";

export type BotPersona = {
  id: BotId;
  displayName: string;
  skill: BotSkill;
  style: BotStyle;
  theme: string;
  searchDepth: number;
  branchFactor: number;
  noiseScale: number;
  forgiveness: number;
  aggression: number;
  defense: number;
  conversion: number;
};

export type BotMoveRequest = {
  personaId: BotId;
  state: GameState;
  legalActions?: Action[];
  seed?: number;
  timeBudgetMs?: number;
  trace?: boolean;
};

export type CanonicalStateEncoding = {
  version: "cp-state-v1";
  hash: string;
  serialized: string;
  sideToMove: PlayerId;
  turnIndex: number;
  outcome: OutcomeStatus;
};

export type CanonicalActionEncoding = {
  version: "cp-action-v1";
  key: string;
};

export type SearchTraceEvent =
  | {
      type: "root";
      state: CanonicalStateEncoding;
      legalActionCount: number;
    }
  | {
      type: "candidate";
      action: CanonicalActionEncoding;
      score: number;
      depth: number;
      sequence: string[];
    }
  | {
      type: "leaf";
      depth: number;
      score: number;
      state: CanonicalStateEncoding;
    };

export type BotMoveDiagnostics = {
  persona: BotPersona;
  seed: number;
  legalActionCount: number;
  canonicalState: CanonicalStateEncoding;
  selectedAction: CanonicalActionEncoding;
  selectedActionIndex: number;
  selectedScore: number;
  principalVariation: string[];
  searchDepth: number;
  exploredNodes: number;
  evaluatedLeaves: number;
  searchTimeMs: number;
  candidateSummaries: {
    action: CanonicalActionEncoding;
    score: number;
    depth: number;
  }[];
  trace: SearchTraceEvent[];
};

export type BotMoveResponse = {
  action: Action;
  diagnostics: BotMoveDiagnostics;
};

export type PersonaProbeLaneId = "aggression" | "defense" | "conversion" | "forgiveness";

export type PersonaProbeRun = {
  laneId: PersonaProbeLaneId;
  personaId: BotId;
  seed: number;
  elapsedMs: number;
  response: BotMoveResponse;
  laneScore: number;
};

export type PersonaProbeSuiteResult = {
  version: "cp-probe-suite-v1";
  runs: PersonaProbeRun[];
};

export type PersonaProbeContext = {
  laneId: PersonaProbeLaneId;
  personaId: BotId;
  response: BotMoveResponse;
};
