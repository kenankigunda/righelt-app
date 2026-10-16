-- Holds conservative D1 headroom across interrupted restores.
CREATE TABLE storage_restore_reservations (game_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>=0));
ALTER TABLE storage_archive_chunks ADD COLUMN raw_bytes INTEGER NOT NULL DEFAULT 0;
