CREATE TABLE IF NOT EXISTS quiz_results (
 submission_id UUID PRIMARY KEY,
 date TEXT NOT NULL,
 name TEXT NOT NULL,
 group_code TEXT NOT NULL,
 modules TEXT NOT NULL DEFAULT '1',
 status TEXT NOT NULL CHECK (status IN ('Пройден','СПИСЫВАНИЕ')),
 correct INT NOT NULL DEFAULT 0, total INT NOT NULL DEFAULT 0,
 pct NUMERIC(6,2) NOT NULL DEFAULT 0, xp INT NOT NULL DEFAULT 0,
 duration INT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_results_created_idx ON quiz_results(created_at DESC);
CREATE TABLE IF NOT EXISTS quiz_live (
 session_id UUID PRIMARY KEY, name TEXT NOT NULL, group_code TEXT NOT NULL,
 question INT NOT NULL DEFAULT 1, total INT NOT NULL DEFAULT 50,
 seconds_left INT NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'Проходит',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_live_updated_idx ON quiz_live(updated_at DESC);
