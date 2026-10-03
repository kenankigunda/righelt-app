/** Transitional handler-test adapter for old fixtures. No response rewriting.
 * Remove from client→handler tests when the actual v2 sender lands in T-114.04.
 */
import { handleApiRequest as handleActualRequest } from "../../src/index.ts";
import { commandFingerprint } from "../../../shared-types/src/sync-protocol.ts";
const journals = new WeakMap();
export async function upgradeTestRequest(request, env) {
  if (request.method !== "POST") return request;
  const body = await request.clone().json().catch(() => null);
  if (!body || body.protocolVersion === 2) return request;
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const route = parts.at(-1);
  const gameId = request.headers.get("x-game-id") || (parts.includes("games") ? parts[parts.indexOf("games") + 1] : null);
  let next = { ...body, protocolVersion: 2 };
  if (["apply", "moves", "end-turn"].includes(route)) {
    const game = gameId && env.DB.getGameState(gameId);
    if (!game) return request;
    const rawId = body.clientCommandId || crypto.randomUUID();
    const id = rawId.startsWith("v2:") ? rawId : `v2:${rawId}`;
    let journal = journals.get(env.DB); if (!journal) journals.set(env.DB, journal = new Map());
    const key = JSON.stringify([gameId, body.identityId, id]);
    next = journal.get(key);
    if (!next) {
      next = { protocolVersion: 2, gameId, identityId: body.identityId, clientCommandId: id, kind: route === "apply" ? "action" : route === "moves" ? "move" : "end_turn", payload: { ...(body.action ? { action: body.action } : {}), ...(body.notation ? { notation: body.notation } : {}) }, expectedState: body.state || game.board.state, expectedGameplayRevision: game.gameplayRevision || 0, ...(route === "end-turn" ? { expectedTurnIndex: game.board.state.turnIndex } : {}) };
      next.fingerprint = await commandFingerprint(next);
      journal.set(key, next);
    }
  }
  return new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(next) });
}
export const handleApiRequest = async (request, env) => handleActualRequest(await upgradeTestRequest(request, env), env);
