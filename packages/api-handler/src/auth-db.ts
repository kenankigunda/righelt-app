export const DB_NOW = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
export type AuthStatement = {
  bind(...values: unknown[]): AuthStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
};
export type AuthDatabase = {
  prepare(sql: string): AuthStatement;
  batch(statements: AuthStatement[]): Promise<unknown[]>;
  withSession?(constraint: "first-primary"): AuthDatabase;
};
export type AccountVersions = {
  accountId: string;
  credentialVersion: number;
  recoveryVersion: number;
  sessionEpoch: number;
};
export type AccountRow = {
  account_id: string;
  username: string;
  username_canonical: string;
  display_name: string;
  created_at: number;
  password_hash: string;
  recovery_hash: string;
  credential_version: number;
  recovery_version: number;
  session_epoch: number;
  recovery_acknowledged: number;
  tutorial_state: "new" | "completed" | "skipped";
  view_preference: "focused" | "explanatory";
};
export type SessionRow = {
  token_hash: string;
  account_id: string;
  session_epoch: number;
  context_id: string;
  created_at: number;
  last_activity_at: number;
  expires_at: number;
  revoked_at: number | null;
};

export function primaryAuthDatabase(db: AuthDatabase): AuthDatabase {
  return db.withSession ? db.withSession("first-primary") : db;
}
// Callers must keep the guard, writes and cleanup in one batch. Never replace
// this insertion with a zero-row conditional UPDATE: that does not roll back.
export function credentialGuard(
  db: AuthDatabase,
  guardId: string,
  expected: AccountVersions,
): AuthStatement {
  return db
    .prepare(
      `INSERT INTO account_transaction_guards (guard_id, valid) VALUES (?, COALESCE((SELECT 1 FROM accounts WHERE account_id = ? AND credential_version = ? AND recovery_version = ? AND session_epoch = ?), 0))`,
    )
    .bind(
      guardId,
      expected.accountId,
      expected.credentialVersion,
      expected.recoveryVersion,
      expected.sessionEpoch,
    );
}
export function sessionGuard(
  db: AuthDatabase,
  guardId: string,
  tokenHash: string,
  contextId: string,
  requireAcknowledgment = true,
): AuthStatement {
  return db
    .prepare(
      `INSERT INTO account_transaction_guards (guard_id, valid) VALUES (?, COALESCE((SELECT 1 FROM account_sessions s JOIN accounts a ON a.account_id = s.account_id WHERE s.token_hash = ? AND s.context_id = ? AND s.revoked_at IS NULL AND s.expires_at > ${DB_NOW} AND s.session_epoch = a.session_epoch AND (? = 0 OR a.recovery_acknowledged = 1)), 0))`,
    )
    .bind(guardId, tokenHash, contextId, requireAcknowledgment ? 1 : 0);
}
export function clearTransactionGuard(
  db: AuthDatabase,
  guardId: string,
): AuthStatement {
  return db
    .prepare("DELETE FROM account_transaction_guards WHERE guard_id = ?")
    .bind(guardId);
}
