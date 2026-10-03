ALTER TABLE accounts ADD COLUMN introduced_opponents INTEGER NOT NULL DEFAULT 0 CHECK(introduced_opponents BETWEEN 0 AND 7);
