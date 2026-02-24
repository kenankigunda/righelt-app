import type {
  Action,
  ArtifactMode,
  CommandArtifact,
  ContinuationContext,
  Coordinate,
  GameState,
  GroupArtifact,
  Outcome,
  OutcomeStatus,
  ResolveArtifacts,
  SupplyArtifact,
} from "../../shared-types/src/engine";

export type {
  Action,
  ArtifactMode,
  CommandArtifact,
  ContinuationContext,
  Coordinate,
  GameState,
  GroupArtifact,
  Outcome,
  OutcomeStatus,
  ResolveArtifacts,
  SupplyArtifact,
};

export type ValidationErrorCode =
  | "INVALID_SHAPE"
  | "OUT_OF_BOUNDS"
  | "NOT_SIDE_TO_MOVE"
  | "SOURCE_EMPTY"
  | "CONTINUATION_REQUIRED"
  | "TERMINAL_GAME"
  | "RULE_VIOLATION";

export type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      code: ValidationErrorCode;
      message: string;
    };

export type ApplyResult = {
  state: GameState;
  outcome: Outcome;
};

export type ReplayOptions = {
  includeTrace?: boolean;
  artifactMode?: ArtifactMode;
};

export type ReplayResult = {
  finalState: GameState;
  outcome: Outcome;
  trace?: GameState[];
  failure?: {
    index: number;
    validation: ValidationResult;
  };
};

export type ArtifactContractV1 = {
  supply: SupplyArtifact[];
  command: CommandArtifact;
  groups: GroupArtifact;
  status: OutcomeStatus;
};

export const SUPPLY_PATH_TIE_BREAK_ORDER: readonly (keyof Coordinate)[] = ["row", "col"] as const;

export const COMMAND_EDGE_TIE_BREAK_POLICY = {
  primary: "lexicographic-node-order",
  secondary: "shortest-path-row-col",
} as const;

export const ARTIFACT_CONTRACT_VERSION = "1.0.0" as const;

export const TIE_BREAK_POLICY_VERSION = "1.0.0" as const;

export type EngineContractFreeze = {
  apiVersion: "1.0.0";
  artifactContractVersion: typeof ARTIFACT_CONTRACT_VERSION;
  tieBreakPolicyVersion: typeof TIE_BREAK_POLICY_VERSION;
  resolveArtifacts: ResolveArtifacts;
  continuation: ContinuationContext | null;
};
