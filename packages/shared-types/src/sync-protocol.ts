/** Shared online command contract. Unknown is never a terminal outcome. */
export const SYNC_PROTOCOL_VERSION = 2 as const;
export const SYNC_LIMITS = Object.freeze({ commandsPerRequest: 16, outstandingPerGame: 16, outstandingPerIdentity: 128, commandIdCharacters: 128, envelopeBytes: 64 * 1024, bodyBytes: 1024 * 1024 });
export const SYNC_TIMING = Object.freeze({ requestTimeoutMs: 5_000, confirmationBudgetMs: 15_000, heartbeatIntervalMs: 5_000, inboundTimeoutMs: 15_000, retryDelaysMs: Object.freeze([500, 1_000, 2_000, 4_000, 5_000]), retryJitter: 0.2 });
export type SyncCommand = {
  protocolVersion: 2;
  gameId: string;
  identityId: string;
  authContextId?: string;
  clientCommandId: string;
  kind: "move" | "action" | "end_turn";
  payload: Record<string, unknown>;
  expectedState: Record<string, unknown>;
  expectedGameplayRevision: number;
  expectedTurnIndex?: number;
  predecessor?: { clientCommandId: string; fingerprint: string };
  fingerprint: string;
};
export type CommandOutcome = {
  gameId: string; identityId: string; clientCommandId: string; fingerprint: string;
  outcome: "accepted" | "rejected" | "unknown";
  reason: string | null;
  eventSeq: number; gameplayRevision: number;
};
export type CommandReceipt = CommandOutcome & { outcome: "accepted" | "rejected" };
export type ReconcileRequest = { protocolVersion: 2; identityId: string; knownSnapshotEventSeq: number; commands: SyncCommand[] };
export type ReconcileResponse = { protocolVersion: 2; gameId: string; eventSeq: number; gameplayRevision: number; commandOutcomes: CommandOutcome[]; game?: Record<string, unknown> };
export type HeartbeatAck = { type: "heartbeat_ack"; protocolVersion: 2; gameId: string; eventSeq: number };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const isSyncRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const commandId = (value: unknown): value is string => nonempty(value) && value.startsWith("v2:") && value.length > 3 && value.length <= SYNC_LIMITS.commandIdCharacters;
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const encodedSyncBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Reject non-JSON values instead of silently changing immutable intent. */
export function canonicalCommandJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalCommandJson).join(",")}]`;
  if (record(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalCommandJson(value[key])}`).join(",")}}`;
  }
  throw new Error("Command contains a non-JSON value");
}
export async function commandFingerprint(command: Omit<SyncCommand, "fingerprint"> | SyncCommand): Promise<string> {
  const { protocolVersion, gameId, identityId, clientCommandId, kind, payload, expectedState, expectedGameplayRevision, expectedTurnIndex, predecessor, authContextId } = command;
  const intent = { protocolVersion, gameId, identityId, clientCommandId, kind, payload, expectedState, expectedGameplayRevision,
    ...(authContextId === undefined ? {} : { authContextId }),
    ...(expectedTurnIndex === undefined ? {} : { expectedTurnIndex }), ...(predecessor === undefined ? {} : { predecessor }) };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalCommandJson(intent)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Structural validation; the server must recompute commandFingerprint before accepting supplied content. */
export function isSyncCommand(value: unknown): value is SyncCommand {
  if (!record(value) || value.protocolVersion !== 2 || !nonempty(value.gameId) || !nonempty(value.identityId) || !commandId(value.clientCommandId) || !fingerprint(value.fingerprint)) return false;
  if (value.authContextId !== undefined && (typeof value.authContextId !== "string" || !/^[a-f0-9]{64}$/.test(value.authContextId))) return false;
  if (!["move", "action", "end_turn"].includes(String(value.kind)) || !record(value.payload) || !record(value.expectedState) || !isSyncRevision(value.expectedGameplayRevision)) return false;
  if ((value.kind === "end_turn" || value.expectedTurnIndex !== undefined) && !isSyncRevision(value.expectedTurnIndex)) return false;
  if (value.predecessor !== undefined && (!record(value.predecessor) || !commandId(value.predecessor.clientCommandId) || value.predecessor.clientCommandId === value.clientCommandId || !fingerprint(value.predecessor.fingerprint))) return false;
  try { canonicalCommandJson(value); return encodedSyncBytes(value) <= SYNC_LIMITS.envelopeBytes; } catch { return false; }
}
export function isReconcileRequest(value: unknown, gameId: string): value is ReconcileRequest {
  if (!record(value) || value.protocolVersion !== 2 || !nonempty(value.identityId) || !isSyncRevision(value.knownSnapshotEventSeq) || !Array.isArray(value.commands) || value.commands.length > SYNC_LIMITS.commandsPerRequest) return false;
  const seen = new Set<string>();
  for (const command of value.commands) {
    if (!isSyncCommand(command) || command.gameId !== gameId || command.identityId !== value.identityId || seen.has(command.clientCommandId)) return false;
    seen.add(command.clientCommandId);
  }
  const byId = new Map(value.commands.map((command) => [command.clientCommandId, command]));
  for (const command of value.commands) {
    const chain = new Set<string>();
    let current: SyncCommand | undefined = command;
    while (current) {
      if (chain.has(current.clientCommandId)) return false;
      chain.add(current.clientCommandId);
      const parent: SyncCommand | undefined = current.predecessor ? byId.get(current.predecessor.clientCommandId) : undefined;
      if (parent && current.predecessor?.fingerprint !== parent.fingerprint) return false;
      current = parent;
    }
  }
  try { return encodedSyncBytes(value) <= SYNC_LIMITS.bodyBytes; } catch { return false; }
}
/** Validate identity separately from snapshot freshness: old receipts can settle current work. */
export function isCommandOutcome(value: unknown, command: SyncCommand): value is CommandOutcome {
  return record(value) && value.gameId === command.gameId && value.identityId === command.identityId && value.clientCommandId === command.clientCommandId && value.fingerprint === command.fingerprint
    && ["accepted", "rejected", "unknown"].includes(String(value.outcome)) && (value.reason === null || nonempty(value.reason))
    && (value.outcome !== "rejected" || nonempty(value.reason)) && isSyncRevision(value.eventSeq) && isSyncRevision(value.gameplayRevision)
    && (value.outcome !== "accepted" || (value.gameplayRevision === command.expectedGameplayRevision + 1 && value.eventSeq > 0));
}
/** Validates metadata only. Consumers must validate optional game with the authoritative game parser before applying it. */
export function isReconcileResponse(value: unknown, gameId: string, commands: SyncCommand[]): value is ReconcileResponse {
  if (!record(value) || value.protocolVersion !== 2 || value.gameId !== gameId || !isSyncRevision(value.eventSeq) || !isSyncRevision(value.gameplayRevision) || !Array.isArray(value.commandOutcomes) || value.commandOutcomes.length > SYNC_LIMITS.commandsPerRequest || (value.game !== undefined && !record(value.game))) return false;
  const requested = new Map(commands.map((command) => [command.clientCommandId, command]));
  const seen = new Set<string>();
  for (const outcome of value.commandOutcomes) {
    if (!record(outcome) || typeof outcome.clientCommandId !== "string") return false;
    const command = requested.get(outcome.clientCommandId);
    if (!command || seen.has(command.clientCommandId) || !isCommandOutcome(outcome, command) || outcome.eventSeq > value.eventSeq || outcome.gameplayRevision > value.gameplayRevision) return false;
    seen.add(command.clientCommandId);
  }
  return true;
}
