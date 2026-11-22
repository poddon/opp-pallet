package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
)

const adminSetting = "admin_password_hash"

// Without ambiguous characters (I, O, 0, 1). The length is a power of two, so the choice is unbiased.
const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newPassword() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	out := make([]byte, len(raw))
	for i, b := range raw {
		out[i] = passwordAlphabet[int(b)%len(passwordAlphabet)]
	}
	return string(out), nil
}

// resolveAdminPassword selects the administrator password.
// An explicit password (parameter or OPP_ADMIN_PASSWORD) is used and saved in PostgreSQL as a hash.
// Without one the saved hash is reused. On the very first start a password is generated and returned
// so that it can be shown once.
func (a *app) resolveAdminPassword(ctx context.Context, explicit string) (string, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(80048005)"); err != nil {
		return "", err
	}
	const save = `INSERT INTO quiz_app_settings(key,value) VALUES ($1,$2)
		ON CONFLICT (key) DO UPDATE SET value=excluded.value`
	generated := ""
	hash := ""
	if explicit != "" {
		hash = digest(explicit)
	} else {
		err := tx.QueryRowContext(ctx, "SELECT value FROM quiz_app_settings WHERE key=$1", adminSetting).Scan(&hash)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if errors.Is(err, sql.ErrNoRows) {
			if generated, err = newPassword(); err != nil {
				return "", err
			}
			hash = digest(generated)
		}
	}
	if explicit != "" || generated != "" {
		if _, err := tx.ExecContext(ctx, save, adminSetting, hash); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	a.passwordHash = hash
	return generated, nil
}
