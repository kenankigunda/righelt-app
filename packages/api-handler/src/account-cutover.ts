import {
  primaryAuthDatabase,
  DB_NOW,
  type AuthDatabase,
  type AuthStatement,
} from "./auth-db";
import { AuthProblem } from "./auth-controls";
import { randomToken } from "./auth-security";
export type CutoverPolicy = {
  activated_at: number | null;
  maintenance: number;
  canary_account_id: string | null;
};
export type CutoverEnv = {
  DB: unknown;
  AUTH_ENABLED?: string;
  AUTH_REQUIRED?: string;
  ACCOUNT_POLICY?: CutoverPolicy;
};
export async function cutoverPolicy(env: CutoverEnv): Promise<CutoverPolicy> {
  try {
    const row = await primaryAuthDatabase(env.DB as AuthDatabase)
      .prepare(
        "SELECT activated_at,maintenance,canary_account_id FROM account_cutover WHERE singleton=1",
      )
      .first<CutoverPolicy>();
    if (
      !row ||
      !(row.activated_at === null || Number.isSafeInteger(row.activated_at)) ||
      ![0, 1].includes(row.maintenance) ||
      !(
        row.canary_account_id === null ||
        typeof row.canary_account_id === "string"
      ) ||
      (row.activated_at !== null && !row.canary_account_id)
    )
      throw new Error("invalid_cutover_policy");
    return row;
  } catch {
    // Missing or unreadable policy must never restore guest authority.
    throw new AuthProblem("temporarily_unavailable", 503);
  }
}
export async function withCutoverPolicy<T extends CutoverEnv>(
  env: T,
): Promise<T> {
  const policy = await cutoverPolicy(env);
  return {
    ...env,
    ACCOUNT_POLICY: policy,
    AUTH_REQUIRED:
      policy.activated_at !== null ||
      policy.maintenance === 1 ||
      env.AUTH_ENABLED === "true"
        ? "true"
        : "false",
  };
}
export function maintenanceAllowed(
  env: CutoverEnv,
  accountId?: string,
): boolean {
  return (
    !env.ACCOUNT_POLICY?.maintenance ||
    Boolean(accountId && accountId === env.ACCOUNT_POLICY.canary_account_id)
  );
}
export function cutoverWritePermit(
  env: CutoverEnv,
  gameId: string,
  authority: { accountId: string; tokenHash: string; contextId: string } | null,
  systemPresence = false,
): { before: AuthStatement[]; after: AuthStatement[] } {
  if (env.ACCOUNT_POLICY?.activated_at == null)
    return { before: [], after: [] };
  const db = primaryAuthDatabase(env.DB as AuthDatabase),
    id = randomToken();
  const valid = authority
    ? `COALESCE((SELECT 1 FROM account_sessions s JOIN accounts a ON a.account_id=s.account_id JOIN account_cutover c ON c.singleton=1 WHERE s.token_hash=? AND s.context_id=? AND s.account_id=? AND s.revoked_at IS NULL AND s.expires_at>${DB_NOW} AND s.session_epoch=a.session_epoch AND a.recovery_acknowledged=1 AND (c.maintenance=0 OR c.canary_account_id=a.account_id)),0)`
    : systemPresence
      ? "(SELECT CASE WHEN maintenance=0 THEN 1 ELSE 0 END FROM account_cutover WHERE singleton=1)"
      : "0";
  return {
    before: [
      db
        .prepare(
          `INSERT INTO account_game_write_permits(permit_id,game_id,actor_id,valid) VALUES(?,?,?,${valid})`,
        )
        .bind(
          id,
          gameId,
          authority?.accountId ?? null,
          ...(authority
            ? [authority.tokenHash, authority.contextId, authority.accountId]
            : []),
        ),
    ],
    after: [
      db
        .prepare("DELETE FROM account_game_write_permits WHERE permit_id=?")
        .bind(id),
    ],
  };
}
