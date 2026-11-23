package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const passwordRounds = 120000

// Administrators of the earlier site version: login is the full name.
// Only salted PBKDF2-SHA256 hashes of their initial passwords are kept here.
var defaultAdmins = []struct{ name, salt, hash string }{
	{"Лукьянчиков Егор Игоревич", "70793961066bee1a44af5151ef035657", "a93ccd655c3bf9abc2d55fe836db2538ebeb897d0d32c71d0d6bdfdf2aad3028"},
	{"Пышненко Кирилл Валерьевич", "4fd26c12a1754f9ff831e38421cb60d2", "f5acb0a892409a54a8c295ca859e8298f5f1c49570723076f05152dc5ab6c84b"},
	{"Цурихин Дмитрий Сергеевич", "33249812f4ced278b6ebd1ae805dff9a", "a43b12395dba8cb693e2c88af5e752c9f9952ddf014e2d7110b4fc38ec57dcf3"},
	{"Ибатуллин Богдан Альбертович", "ff81571e262428304d7d5cd8e8bf3aed", "5ad00ac6bcf485a0278532b980105c6991c791894356ea13179663c2fd8546bd"},
}

// pbkdf2 implements PBKDF2-HMAC-SHA256 with a single output block (RFC 8018).
func pbkdf2(password, salt []byte, rounds int) []byte {
	mac := hmac.New(sha256.New, password)
	mac.Write(salt)
	var block [4]byte
	binary.BigEndian.PutUint32(block[:], 1)
	mac.Write(block[:])
	u := mac.Sum(nil)
	out := append([]byte(nil), u...)
	for i := 1; i < rounds; i++ {
		mac.Reset()
		mac.Write(u)
		u = mac.Sum(u[:0])
		for k := range out {
			out[k] ^= u[k]
		}
	}
	return out
}

func hashPassword(password, saltHex string) string {
	salt, _ := hex.DecodeString(saltHex)
	return hex.EncodeToString(pbkdf2([]byte(password), salt, passwordRounds))
}

// adminLogin normalises a full name: case, extra spaces and ё are ignored.
func adminLogin(name string) string {
	return strings.ReplaceAll(strings.ToLower(normalize(name)), "ё", "е")
}

func (a *app) seedAdmins(ctx context.Context) error {
	for _, admin := range defaultAdmins {
		if _, err := a.db.ExecContext(ctx, `INSERT INTO quiz_admins(login,name,salt,hash)
			VALUES ($1,$2,$3,$4) ON CONFLICT (login) DO NOTHING`,
			adminLogin(admin.name), admin.name, admin.salt, admin.hash); err != nil {
			return err
		}
	}
	return nil
}

// setAdminPassword stores a new password for an administrator, creating the account if needed.
func (a *app) setAdminPassword(ctx context.Context, name, password string) error {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	saltHex := hex.EncodeToString(salt)
	_, err := a.db.ExecContext(ctx, `INSERT INTO quiz_admins(login,name,salt,hash,changed_at)
		VALUES ($1,$2,$3,$4,clock_timestamp()) ON CONFLICT (login) DO UPDATE
		SET salt=EXCLUDED.salt, hash=EXCLUDED.hash, changed_at=EXCLUDED.changed_at`,
		adminLogin(name), normalize(name), saltHex, hashPassword(password, saltHex))
	return err
}

func (a *app) checkAdmin(ctx context.Context, name, password string) (string, bool, error) {
	var display, salt, hash string
	err := a.db.QueryRowContext(ctx, `SELECT name,salt,hash FROM quiz_admins WHERE login=$1`,
		adminLogin(name)).Scan(&display, &salt, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		hashPassword(password, "00") // same work for unknown logins
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	ok := subtle.ConstantTimeCompare([]byte(hashPassword(password, salt)), []byte(hash)) == 1
	return display, ok, nil
}

type adminKey struct{}

func currentAdmin(r *http.Request) string {
	name, _ := r.Context().Value(adminKey{}).(string)
	return name
}

func (a *app) changePassword(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Current string `json:"current"`
		Next    string `json:"next"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if n := utf8.RuneCountInString(req.Next); n < 6 || n > 200 {
		return problem{400, "Новый пароль — не короче 6 символов"}
	}
	name := currentAdmin(r)
	_, ok, err := a.checkAdmin(r.Context(), name, req.Current)
	if err != nil {
		return err
	}
	if !ok {
		time.Sleep(350 * time.Millisecond)
		return problem{403, "Текущий пароль указан неверно"}
	}
	if err := a.setAdminPassword(r.Context(), name, req.Next); err != nil {
		return err
	}
	w.WriteHeader(204)
	return nil
}

type adminAccount struct {
	Name      string     `json:"name"`
	CreatedBy string     `json:"createdBy,omitempty"`
	Created   *time.Time `json:"created,omitempty"`
}

func (a *app) listAdmins(w http.ResponseWriter, r *http.Request) error {
	rows, err := a.db.QueryContext(r.Context(), `SELECT name, coalesce(created_by,''), created_at FROM quiz_admins ORDER BY name`)
	if err != nil {
		return err
	}
	defer rows.Close()
	list := []adminAccount{}
	for rows.Next() {
		var item adminAccount
		if err := rows.Scan(&item.Name, &item.CreatedBy, &item.Created); err != nil {
			return err
		}
		list = append(list, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, list)
	return nil
}

// createAdmin adds a new administrator account; existing accounts are never overwritten here.
func (a *app) createAdmin(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	name := normalize(req.Name)
	if !validLength(name, 160) || len(strings.Fields(name)) < 2 {
		return problem{400, "Укажите ФИО администратора, например: Иванов Иван Иванович"}
	}
	if n := utf8.RuneCountInString(req.Password); n < 6 || n > 200 {
		return problem{400, "Пароль — не короче 6 символов"}
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	saltHex := hex.EncodeToString(salt)
	result, err := a.db.ExecContext(r.Context(), `INSERT INTO quiz_admins(login,name,salt,hash,created_at,created_by)
		VALUES ($1,$2,$3,$4,clock_timestamp(),$5) ON CONFLICT (login) DO NOTHING`,
		adminLogin(name), name, saltHex, hashPassword(req.Password, saltHex), currentAdmin(r))
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil {
		return err
	} else if n == 0 {
		return problem{409, "Администратор с таким ФИО уже есть"}
	}
	writeJSON(w, 201, adminAccount{Name: name, CreatedBy: currentAdmin(r)})
	return nil
}
