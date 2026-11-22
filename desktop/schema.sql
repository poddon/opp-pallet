CREATE TABLE IF NOT EXISTS quiz_results (
    id BIGSERIAL PRIMARY KEY,
    taken_at TEXT NOT NULL,
    student_name TEXT NOT NULL,
    group_code TEXT NOT NULL,
    module_id TEXT NOT NULL DEFAULT '1',
    status TEXT NOT NULL,
    correct INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    pct INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quiz_results_created_idx ON quiz_results(created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_groups (
    code TEXT PRIMARY KEY
);
INSERT INTO quiz_groups (code)
SELECT DISTINCT upper(regexp_replace(btrim(group_code), '[[:space:]]+', ' ', 'g'))
FROM quiz_results WHERE btrim(group_code) <> '' ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS quiz_assignments (
    id BIGSERIAL PRIMARY KEY,
    group_code TEXT NOT NULL REFERENCES quiz_groups(code),
    test_id TEXT NOT NULL,
    title TEXT NOT NULL,
    questions JSONB NOT NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    closes_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    CHECK (closes_at > opened_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS quiz_one_open_assignment
ON quiz_assignments (group_code, test_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS quiz_assignment_expiry
ON quiz_assignments (closes_at) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS quiz_live (
    session_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_code TEXT NOT NULL,
    question INTEGER NOT NULL DEFAULT 1,
    total INTEGER NOT NULL DEFAULT 50,
    seconds_left INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Проходит',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM pg_attribute WHERE attrelid='quiz_live'::regclass
        AND attname='session_id' AND atttypid='uuid'::regtype
    ) THEN
        ALTER TABLE quiz_live ALTER COLUMN session_id TYPE TEXT USING session_id::text;
    END IF;
END
$$;
ALTER TABLE quiz_live
    ADD COLUMN IF NOT EXISTS assignment_id BIGINT REFERENCES quiz_assignments(id),
    ADD COLUMN IF NOT EXISTS name_norm TEXT,
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS question_set JSONB,
    ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_text TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS quiz_attempt_per_assignment
ON quiz_live (assignment_id, name_norm) WHERE assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quiz_live_recent
ON quiz_live (updated_at DESC) WHERE assignment_id IS NOT NULL AND finished_at IS NULL;

CREATE TABLE IF NOT EXISTS quiz_answers (
    session_id TEXT NOT NULL REFERENCES quiz_live(session_id),
    question INTEGER NOT NULL CHECK (question > 0),
    choice INTEGER,
    correct BOOLEAN NOT NULL,
    answered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (session_id, question)
);
CREATE TABLE IF NOT EXISTS quiz_admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_consent (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
    body TEXT NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 65536)
);
