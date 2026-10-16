-- Account billing cycles need not align with calendar months. Preserve existing
-- reservations conservatively, then cap operations over a rolling window.
CREATE TABLE storage_operation_days (
  day TEXT PRIMARY KEY,
  class_a INTEGER NOT NULL DEFAULT 0 CHECK(class_a>=0),
  class_b INTEGER NOT NULL DEFAULT 0 CHECK(class_b>=0)
);
INSERT INTO storage_operation_days(day,class_a,class_b)
SELECT date('now'),class_a,class_b FROM storage_budget WHERE singleton=1;
