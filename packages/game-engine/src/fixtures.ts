import { GameState, Action, OutcomeStatus } from "./types";

export type EngineFixture = {
  id: string;
  matrixId: string;
  title: string;
  initial_state: GameState;
  action_sequence: Action[];
  expected_final_state_hash: string;
  expected_outcome: OutcomeStatus;
  expected_error?: {
    index: number;
    code: string;
  };
};

export function parseFixture(raw: string): EngineFixture {
  return JSON.parse(raw) as EngineFixture;
}

export async function loadFixture(
  readFixture: (path: string) => Promise<string>,
  path: string,
): Promise<EngineFixture> {
  return parseFixture(await readFixture(path));
}
