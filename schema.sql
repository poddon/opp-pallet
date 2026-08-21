CREATE TABLE IF NOT EXISTS quiz_results (
  id            BIGSERIAL PRIMARY KEY,
  taken_at      TEXT NOT NULL,
  student_name  TEXT NOT NULL,
  group_code    TEXT NOT NULL,
  module_id     TEXT NOT NULL DEFAULT '1',
  status        TEXT NOT NULL CHECK (status IN ('Пройден', 'СПИСЫВАНИЕ')),
  correct       INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  pct           INTEGER NOT NULL DEFAULT 0,
  xp            INTEGER NOT NULL DEFAULT 0,
  duration_sec  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS quiz_results_created_idx ON quiz_results (created_at DESC);
