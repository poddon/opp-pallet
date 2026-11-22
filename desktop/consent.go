package main

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
)

const maxConsentBytes = 64 << 10

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (a *app) consentText(ctx context.Context, db rowQueryer) (string, error) {
	var text string
	err := db.QueryRowContext(ctx, `SELECT coalesce((SELECT body FROM quiz_consent WHERE singleton), $1)`,
		a.fileConsent).Scan(&text)
	return text, err
}

func (a *app) saveConsent(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Text string `json:"text"`
	}
	if err := readJSONLimit(w, r, &req, 6*maxConsentBytes+64); err != nil {
		return err
	}
	text := strings.TrimSpace(strings.TrimPrefix(req.Text, "\uFEFF"))
	if text == "" || len(text) > maxConsentBytes || strings.ContainsRune(text, 0) {
		return problem{400, "Введите текст согласия длиной до 64 КБ"}
	}
	_, err := a.db.ExecContext(r.Context(), `INSERT INTO quiz_consent (singleton, body)
		VALUES (true, $1) ON CONFLICT (singleton) DO UPDATE SET body=EXCLUDED.body`, text)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"consent": text})
	return nil
}
