-- Password changes now require a valid session; recovery codes were never launched.
DROP TRIGGER account_cutover_monotonic;
DROP TABLE account_operations;
ALTER TABLE accounts DROP COLUMN recovery_hash;
ALTER TABLE accounts DROP COLUMN recovery_version;
ALTER TABLE accounts DROP COLUMN recovery_acknowledged;
CREATE TRIGGER account_cutover_monotonic BEFORE UPDATE ON account_cutover
WHEN (OLD.activated_at IS NOT NULL AND NEW.activated_at IS NOT OLD.activated_at)
 OR (OLD.canary_account_id IS NOT NULL AND NEW.canary_account_id IS NOT OLD.canary_account_id)
 OR (NEW.activated_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts WHERE account_id=NEW.canary_account_id))
BEGIN SELECT RAISE(ABORT,'account_cutover_immutable'); END;
