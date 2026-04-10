import { applyAction, listLegalActions, resolveToStability } from "../../game-engine/src/index";
import type { Action, GameState, PlayerId } from "../../shared-types/src/engine";
import { canonicalizeAction } from "./canonical";
import { selectMove } from "./search";
import { getBotPersona } from "./personas";
import type {
  BotId,
  PersonaProbeContext,
  PersonaProbeLaneId,
  PersonaProbeRun,
  PersonaProbeSuiteResult,
} from "./types";

function piece(id: string, owner: PlayerId, kind: "commander" | "unit", row: number, col: number) {
  return {
    id,
    owner,
    kind,
    position: { row, col },
    supplied: true,
    commanded: true,
    displaySupplied: true,
    displayCommanded: true,
  };
}

function buildState(pieces: GameState["pieces"], sideToMove: PlayerId): GameState {
  return resolveToStability(
    {
      boardSize: 10,
      sideToMove,
      turnIndex: 0,
      pieces,
      continuation: null,
      outcome: { status: "ongoing" },
    },
    { artifactMode: "minimal" },
  );
}

function candidateAfter(state: GameState, action: Action) {
  return resolveToStability(applyAction(state, action).state, { artifactMode: "minimal" });
}

function commanderDistanceToEnemy(state: GameState) {
  const own = state.pieces.find((piece) => piece.owner === state.sideToMove && piece.kind === "commander");
  const enemy = state.pieces.find((piece) => piece.owner !== state.sideToMove && piece.kind === "commander");
  if (!own || !enemy) {
    return 0;
  }
  return Math.abs(own.position.row - enemy.position.row) + Math.abs(own.position.col - enemy.position.col);
}

function laneScore(state: GameState, context: PersonaProbeContext) {
  const after = candidateAfter(state, context.response.action);
  const afterMobility = listLegalActions(after).length;
  const action = context.response.action;
  switch (context.laneId) {
    case "aggression":
      return (
        -commanderDistanceToEnemy(after) +
        context.response.diagnostics.selectedScore -
        afterMobility +
        (action.type === "push" ? 18 : action.type === "rush" ? 14 : action.type === "move" ? 4 : action.type === "project" ? 1 : 0)
      );
    case "defense":
      return commanderDistanceToEnemy(after) + afterMobility;
    case "conversion":
      return context.response.diagnostics.selectedScore;
    case "forgiveness":
      return afterMobility + context.response.diagnostics.legalActionCount;
  }
  return 0;
}

const PROBE_STATES: Record<PersonaProbeLaneId, GameState> = {
  aggression: buildState(
    [
      piece("C1", "P1", "commander", 3, 6),
      piece("U1", "P1", "unit", 3, 5),
      piece("U2", "P2", "unit", 3, 4),
      piece("C2", "P2", "commander", 6, 3),
    ],
    "P1",
  ),
  defense: buildState(
    [
      piece("C1", "P1", "commander", 4, 6),
      piece("U1", "P1", "unit", 4, 5),
      piece("C2", "P2", "commander", 6, 3),
      piece("U2", "P2", "unit", 5, 6),
    ],
    "P1",
  ),
  conversion: buildState(
    [
      piece("C1", "P1", "commander", 3, 6),
      piece("U1", "P1", "unit", 3, 5),
      piece("C2", "P2", "commander", 6, 3),
      piece("U2", "P2", "unit", 3, 4),
      piece("U3", "P2", "unit", 4, 5),
    ],
    "P1",
  ),
  forgiveness: buildState(
    [
      piece("C1", "P1", "commander", 3, 6),
      piece("U1", "P1", "unit", 4, 6),
      piece("C2", "P2", "commander", 6, 3),
      piece("U2", "P2", "unit", 5, 6),
      piece("U3", "P2", "unit", 5, 5),
    ],
    "P1",
  ),
};

const PROBE_SEEDS: Record<PersonaProbeLaneId, number> = {
  aggression: 11,
  defense: 13,
  conversion: 17,
  forgiveness: 19,
};

export const PERSONA_PROBE_SUITE_VERSION = "cp-probe-suite-v1" as const;

export function getPersonaProbeState(laneId: PersonaProbeLaneId) {
  return PROBE_STATES[laneId];
}

export function runPersonaProbeSuite(personaIds: BotId[] = ["babs", "tau", "sev", "horus"]): PersonaProbeSuiteResult {
  const runs: PersonaProbeRun[] = [];
  for (const laneId of Object.keys(PROBE_STATES) as PersonaProbeLaneId[]) {
    const state = PROBE_STATES[laneId];
    for (const personaId of personaIds) {
      const seed = PROBE_SEEDS[laneId];
      const started = Date.now();
      const response = selectMove({
        personaId,
        state,
        seed,
        trace: true,
      });
      const elapsedMs = Date.now() - started;
      const context: PersonaProbeContext = {
        laneId,
        personaId,
        response,
      };
      runs.push({
        laneId,
        personaId,
        seed,
        elapsedMs,
        response,
        laneScore: laneScore(state, context),
      });
    }
  }

  return {
    version: PERSONA_PROBE_SUITE_VERSION,
    runs,
  };
}

export function summarizeProbeRun(run: PersonaProbeRun) {
  return {
    laneId: run.laneId,
    personaId: run.personaId,
    actionKey: canonicalizeAction(run.response.action).key,
    laneScore: run.laneScore,
  };
}
