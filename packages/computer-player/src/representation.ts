import config from "../config/experiment-v1.json";
import { SUPPLY_POINTS, listLegalActions } from "../../game-engine/src/index";
import type { Action, Coordinate, GameState } from "../../shared-types/src/engine";

export { config as experimentConfig };
const area = config.boardSize ** 2;
const channels = (config.actionCount - 1) / area;
const planeIndexes = new Map(config.planes.map((name, index) => [name, index]));

function square(point: Coordinate): number {
  if (!point || !Number.isInteger(point.row) || !Number.isInteger(point.col) ||
      point.row < 0 || point.col < 0 || point.row >= config.boardSize || point.col >= config.boardSize) {
    throw new Error("Invalid board coordinate");
  }
  return point.row * config.boardSize + point.col;
}

function counter(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid state counter");
  return Math.log1p(value) / Math.log(config.counterLogBase);
}

/** NCHW without the batch dimension. IDs remain in the original replay state. */
export function encodeState(state: GameState): Float32Array {
  if (state.boardSize !== config.boardSize || !["P1", "P2"].includes(state.sideToMove)) {
    throw new Error("Invalid board/controller");
  }
  const encoded = new Float32Array(config.inputPlanes * area);
  function set(name: string, position?: Coordinate, value = 1) {
    const plane = planeIndexes.get(name);
    if (plane === undefined) throw new Error(`Unknown encoding plane: ${name}`);
    if (position) encoded[plane * area + square(position)] = value;
    else encoded.fill(value, plane * area, (plane + 1) * area);
  }
  const continuation = state.continuation;
  if (continuation && !["push", "rush"].includes(continuation.type)) throw new Error("Invalid continuation type");
  const ids = new Set<string>();
  const occupied = new Set<string>();
  for (const piece of state.pieces) {
    if (!piece.id || ids.has(piece.id) || !["P1", "P2"].includes(piece.owner) ||
        !["commander", "unit"].includes(piece.kind)) throw new Error("Invalid or duplicate piece");
    ids.add(piece.id);
    const location = `${piece.owner}:${square(piece.position)}`;
    if (occupied.has(location)) throw new Error("Same-owner occupancy cannot be encoded losslessly");
    occupied.add(location);
    set(`${piece.owner}.${piece.kind}`, piece.position);
    for (const field of ["supplied", "commanded", "pushed", "shifted"] as const) {
      const value = piece[field];
      if (typeof value !== "boolean" && !(value === undefined && (field === "pushed" || field === "shifted"))) {
        throw new Error(`Invalid piece ${field}`);
      }
      if (value) set(`${piece.owner}.${field}`, piece.position);
    }
    const frozen = continuation?.frozenPieceStatesById?.[piece.id];
    if (frozen) {
      if (typeof frozen.supplied !== "boolean" || typeof frozen.commanded !== "boolean") throw new Error("Invalid frozen entry");
      set(`${piece.owner}.frozenPresent`, piece.position);
      if (frozen.supplied) set(`${piece.owner}.frozenSupplied`, piece.position);
      if (frozen.commanded) set(`${piece.owner}.frozenCommanded`, piece.position);
    }
    if (continuation?.followGroupPieceIds?.includes(piece.id)) set(`${piece.owner}.followGroup`, piece.position);
    if (continuation?.rushedPieceIds?.includes(piece.id)) set(`${piece.owner}.rushed`, piece.position);
    if (continuation?.rushChainPieceIds?.includes(piece.id)) set(`${piece.owner}.rushChain`, piece.position);
    if (continuation?.pushedPieceId === piece.id) set(`${piece.owner}.pushedPiece`, piece.position);
  }
  if (continuation?.followPoint) set("followPoint", continuation.followPoint);
  set("supply.P1", SUPPLY_POINTS.P1);
  set("supply.P2", SUPPLY_POINTS.P2);
  set(`controller.${state.sideToMove}`);
  const phase = !continuation ? "none" : continuation.type === "rush" ? "rush" : continuation.phase;
  if (!phase || !["none", "rush", "retreat", "follow"].includes(phase)) throw new Error("Invalid continuation phase");
  set(`phase.${phase}`);
  for (const field of ["owner", "attackerOwner", "frozenOwner"] as const) {
    set(`${field}.${continuation?.[field] ?? "none"}`);
  }
  set("chainLength", undefined, counter(continuation?.chainLength ?? 0));
  set("turnIndex", undefined, counter(state.turnIndex));
  return encoded;
}

/** Geometry is a key, never an action constructor. Decode with legalActionMap. */
export function encodeAction(action: Action): number {
  if (action.type === "pass") return config.passIndex;
  if (!action.from || !action.to || !(action.type in config.actionChannels)) throw new Error("Action geometry missing");
  const source = square(action.from);
  square(action.to);
  const distance = action.type === "project" ? 2 : 1;
  const dc = (action.to.col - action.from.col) / distance;
  const dr = (action.to.row - action.from.row) / distance;
  const directions = action.type === "rush" ? config.directions.rush : config.directions.orthogonal;
  const direction = directions.findIndex(([col, row]) => col === dc && row === dr);
  if (direction < 0) throw new Error("Action geometry has no policy channel");
  return source * channels + config.actionChannels[action.type] + direction;
}

export function legalActionMap(state: GameState): Map<number, Action> {
  const result = new Map<number, Action>();
  for (const action of listLegalActions(state)) {
    const key = encodeAction(action);
    if (result.has(key)) throw new Error(`Legal action encoding collision: ${key}`);
    result.set(key, action);
  }
  return result;
}
