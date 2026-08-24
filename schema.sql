-- База ОПП для PostgreSQL на Synology
-- Выполните один раз от пользователя opp (или postgres).

CREATE TABLE IF NOT EXISTS quiz_results (
  id            SERIAL PRIMARY KEY,
  taken_at      TEXT NOT NULL,
  student_name  TEXT NOT NULL,
  group_code    TEXT NOT NULL,
  module_id     TEXT NOT NULL DEFAULT '1',
  status        TEXT NOT NULL,
  correct       INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  pct           INTEGER NOT NULL DEFAULT 0,
  xp            INTEGER NOT NULL DEFAULT 0,
  duration_sec  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_results_created_idx ON quiz_results (created_at DESC);
CREATE INDEX IF NOT EXISTS quiz_results_name_idx ON quiz_results (student_name);

CREATE TABLE IF NOT EXISTS module_access (
  module_id  TEXT PRIMARY KEY,
  is_open    BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO module_access (module_id, is_open) VALUES ('1', TRUE)
  ON CONFLICT (module_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS fio_done (
  name_norm     TEXT PRIMARY KEY,
  name_display  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fio_grants (
  id            SERIAL PRIMARY KEY,
  name_norm     TEXT NOT NULL,
  name_display  TEXT,
  granted_by    TEXT,
  used          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
