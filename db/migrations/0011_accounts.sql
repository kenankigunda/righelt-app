-- Additive account foundations. Existing games and guest authority are untouched.
CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL CHECK(length(username) BETWEEN 3 AND 24 AND username NOT GLOB '*[^A-Za-z0-9_]*'),
  username_canonical TEXT NOT NULL UNIQUE CHECK(username_canonical = lower(username)),
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL CHECK(length(recovery_hash) = 64),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version >= 1),
  recovery_version INTEGER NOT NULL DEFAULT 1 CHECK(recovery_version >= 1),
  session_epoch INTEGER NOT NULL DEFAULT 1 CHECK(session_epoch >= 1),
  recovery_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(recovery_acknowledged IN (0, 1)),
  tutorial_state TEXT NOT NULL DEFAULT 'new' CHECK(tutorial_state IN ('new', 'completed', 'skipped')),
  view_preference TEXT NOT NULL DEFAULT 'focused' CHECK(view_preference IN ('focused', 'explanatory'))
);
CREATE TRIGGER accounts_identity_immutable BEFORE UPDATE OF account_id, username, username_canonical ON accounts
WHEN NEW.account_id != OLD.account_id OR NEW.username != OLD.username OR NEW.username_canonical != OLD.username_canonical
BEGIN SELECT RAISE(ABORT, 'account_identity_immutable'); END;

CREATE TABLE account_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK(length(token_hash) = 64),
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  session_epoch INTEGER NOT NULL CHECK(session_epoch >= 1),
  context_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > last_activity_at),
  revoked_at INTEGER,
  CHECK(last_activity_at >= created_at)
);
CREATE INDEX account_sessions_account ON account_sessions(account_id, session_epoch);
CREATE INDEX account_sessions_expiry ON account_sessions(expires_at);

CREATE TABLE account_operations (
  flow_hash TEXT PRIMARY KEY NOT NULL CHECK(length(flow_hash) = 64),
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('recovery', 'recovery_code')),
  credential_version INTEGER NOT NULL,
  recovery_version INTEGER NOT NULL,
  session_epoch INTEGER NOT NULL,
  initiating_session_hash TEXT,
  password_hash TEXT,
  replacement_recovery_hash TEXT NOT NULL CHECK(length(replacement_recovery_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  completed_at INTEGER,
  issued_session_hash TEXT REFERENCES account_sessions(token_hash),
  CHECK(kind != 'recovery' OR password_hash IS NOT NULL)
);
CREATE INDEX account_operations_expiry ON account_operations(expires_at);

-- A guard insertion is part of the same D1 batch as its mutations and receipt.
-- A false/missing version match aborts the entire batch through this constraint.
CREATE TABLE account_transaction_guards (
  guard_id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK(valid = 1)
);
CREATE TABLE account_session_rooms (
  session_hash TEXT NOT NULL REFERENCES account_sessions(token_hash) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  PRIMARY KEY(session_hash, room_id)
);
CREATE TABLE account_revocation_outbox (
  notification_id TEXT PRIMARY KEY NOT NULL,
  session_hash TEXT NOT NULL,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX account_revocation_pending ON account_revocation_outbox(delivered_at, created_at);
CREATE TABLE account_rate_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts >= 0),
  failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_rate_limits_expiry ON account_rate_limits(expires_at);
