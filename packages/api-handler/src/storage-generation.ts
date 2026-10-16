import { STORAGE_GENERATION_HEADER, STORAGE_GENERATION_QUERY } from "../../shared-types/src/storage-policy";
import { AuthProblem } from "./auth-controls";

export type StorageGenerationEnv = { STORAGE_GENERATION?: string };
export const storageRoomName = (env: StorageGenerationEnv, gameId: string) =>
  env.STORAGE_GENERATION ? `${env.STORAGE_GENERATION}:${gameId}` : gameId;

export function assertStorageGeneration(request: Request, env: StorageGenerationEnv): void {
  if (!env.STORAGE_GENERATION) return; // Existing deployments/local fixtures until reset.
  const socket = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (request.method === "GET" && !socket) return;
  const supplied = socket
    ? new URL(request.url).searchParams.get(STORAGE_GENERATION_QUERY)
    : request.headers.get(STORAGE_GENERATION_HEADER);
  if (supplied !== env.STORAGE_GENERATION) throw new AuthProblem("storage_reset", 409);
}
