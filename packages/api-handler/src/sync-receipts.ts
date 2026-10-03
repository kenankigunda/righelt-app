import type { CommandReceipt } from "../../shared-types/src/sync-protocol";
import type { LiveGameEnv } from "./shell-live-db";

type ReceiptRow = { game_id: string; client_command_id: string; actor_identity_id: string; fingerprint: string; outcome: "accepted" | "rejected"; reason: string | null; event_seq: number; gameplay_revision: number; result_json?: string | null };
export const loadCommandReceipt = async (env: LiveGameEnv, gameId: string, commandId: string): Promise<(CommandReceipt & { result?: Record<string, unknown> }) | null> => {
  const row = await env.DB.prepare("SELECT * FROM live_command_receipts WHERE game_id = ?1 AND client_command_id = ?2").bind(gameId, commandId).first<ReceiptRow>();
  return row ? { gameId: row.game_id, clientCommandId: row.client_command_id, identityId: row.actor_identity_id, fingerprint: row.fingerprint, outcome: row.outcome, reason: row.reason, eventSeq: row.event_seq, gameplayRevision: row.gameplay_revision, ...(row.result_json ? { result: JSON.parse(row.result_json) as Record<string, unknown> } : {}) } : null;
};
export const commandReceiptStatement = (env: LiveGameEnv, receipt: CommandReceipt & { result?: Record<string, unknown> }) => env.DB.prepare(
  "INSERT INTO live_command_receipts (game_id, client_command_id, actor_identity_id, fingerprint, outcome, reason, event_seq, gameplay_revision, result_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
).bind(receipt.gameId, receipt.clientCommandId, receipt.identityId, receipt.fingerprint, receipt.outcome, receipt.reason, receipt.eventSeq, receipt.gameplayRevision, receipt.result ? JSON.stringify(receipt.result) : null);
export const hasLegacyCommandEvidence = async (env: LiveGameEnv, gameId: string, commandId: string) => Boolean(await env.DB.prepare(
  "SELECT * FROM live_legacy_command_tombstones WHERE game_id = ?1 AND client_command_id = ?2",
).bind(gameId, commandId).first());
