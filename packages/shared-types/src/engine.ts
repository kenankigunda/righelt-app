export type PlayerId = "P1" | "P2";

export type Coordinate = {
  row: number;
  col: number;
};

export type PieceKind = "commander" | "unit";

export type Piece = {
  id: string;
  owner: PlayerId;
  kind: PieceKind;
  position: Coordinate;
  supplied: boolean;
  commanded: boolean;
  pushed?: boolean;
  shifted?: boolean;
};

export type ContinuationType = "push" | "rush";

export type ContinuationContext = {
  type: ContinuationType;
  owner: PlayerId;
  followPoint?: Coordinate;
  pushedPieceId?: string;
  rushedPieceIds?: string[];
  chainLength: number;
};

export type OutcomeStatus = "ongoing" | "p1_win" | "p2_win" | "draw";

export type Outcome = {
  status: OutcomeStatus;
  reason?: string;
};

export type GameState = {
  boardSize: 10;
  sideToMove: PlayerId;
  turnIndex: number;
  pieces: Piece[];
  continuation: ContinuationContext | null;
  outcome: Outcome;
  artifacts?: ResolveArtifacts;
};

export type ActionType = "pass" | "move" | "project" | "rush" | "push" | "follow" | "retreat";

export type Action = {
  type: ActionType;
  actorId?: string;
  from?: Coordinate;
  to?: Coordinate;
  targetId?: string;
};

export type ArtifactMode = "minimal" | "full";

export type SupplyArtifact = {
  player: PlayerId;
  reachability: string[];
  shortestPathByPieceId: Record<string, Coordinate[]>;
  distanceByPieceId: Record<string, number>;
};

export type CommandArtifact = {
  candidateEdges: string[];
  cutEdges: string[];
  activeEdges: string[];
  shortestPathToCommanderByPieceId: Record<string, Coordinate[]>;
};

export type GroupArtifact = {
  componentByPieceId: Record<string, string>;
  membersByComponentId: Record<string, string[]>;
  strengthByComponentId: Record<string, number>;
};

export type ResolveArtifacts = {
  mode: ArtifactMode;
  supply: SupplyArtifact[];
  command: CommandArtifact;
  groups: GroupArtifact;
};
